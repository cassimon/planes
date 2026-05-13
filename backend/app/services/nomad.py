"""
NOMAD Upload Service

Handles secure file compression and upload to NOMAD (Novel Materials Discovery).

This service provides:
- Secure zip file creation for uploads
- NOMAD metadata YAML generation
- Upload to NOMAD with authentication
- Cleanup of temporary files

Uses the nomad_utility_workflows package for NOMAD API interaction.
"""

import logging
import os
import shutil
import tempfile
import uuid
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx
import yaml
import copy

from app.core.config import settings

logger = logging.getLogger(__name__)

# Temporary directory for zip files (will be cleaned up after upload)
TEMP_UPLOAD_DIR = Path(tempfile.gettempdir()) / "plains_nomad_uploads"


class NomadUploadError(Exception):
    """Raised when NOMAD upload fails."""
    pass


class NomadAuthError(Exception):
    """Raised when NOMAD authentication fails."""
    pass


def ensure_temp_dir() -> Path:
    """Ensure the temporary upload directory exists."""
    TEMP_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    return TEMP_UPLOAD_DIR


def get_nomad_token(username: str | None = None, password: str | None = None) -> str:
    """
    Get NOMAD authentication token.
    
    Args:
        username: NOMAD username (uses global config if not provided)
        password: NOMAD password (uses global config if not provided)
    
    Returns:
        Authentication token string
    
    Raises:
        NomadAuthError: If authentication fails
    """
    use_username = username or settings.NOMAD_USERNAME
    use_password = password or settings.NOMAD_PASSWORD
    
    if not use_username or not use_password:
        raise NomadAuthError("NOMAD credentials not configured. Add username/password to the NOMAD auth file (../sensitive config/.nomad_auth)")
    
    # NOMAD uses OAuth2 password grant
    auth_url = settings.NOMAD_URL.replace("/api/v1", "/api/v1/auth/token")
    
    # ── MOCK MODE ──────────────────────────────────────────────────────
    if settings.NOMAD_MOCK_MODE:
        logger.info(
            "[MOCK MODE] get_nomad_token — would POST %s for user=%s. "
            "Returning fake token instead.",
            auth_url,
            use_username,
        )
        return "MOCK_TOKEN_no_real_request_was_made"
    # ───────────────────────────────────────────────────────────────────
    
    try:
        with httpx.Client(timeout=30.0) as client:
            response = client.post(
                auth_url,
                data={
                    "grant_type": "password",
                    "username": use_username,
                    "password": use_password,
                },
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
            
            if response.status_code != 200:
                logger.error(f"NOMAD auth failed: {response.status_code} - {response.text}")
                raise NomadAuthError(f"NOMAD authentication failed: {response.status_code}")
            
            token_data = response.json()
            return token_data.get("access_token", "")
            
    except httpx.RequestError as e:
        logger.error(f"NOMAD auth request error: {e}")
        raise NomadAuthError(f"Failed to connect to NOMAD: {e}")


def create_secure_zip(
    files: list[tuple[str, bytes]],
    metadata_files: list[tuple[str, str]] | None = None,
    archive_name: str | None = None,
) -> Path:
    """
    Create a secure zip archive from uploaded files.
    
    Security measures:
    - Files are placed in a flat structure (no path traversal)
    - Filenames are sanitized
    - Archive is created in a secure temp directory
    
    Args:
        files: List of (filename, file_content_bytes) tuples
        metadata_files: Optional list of (filename, yaml_content) for NOMAD metadata
        archive_name: Optional custom archive name (auto-generated if not provided)
    
    Returns:
        Path to the created zip file
    """
    ensure_temp_dir()
    
    if not archive_name:
        archive_name = f"upload_{uuid.uuid4().hex[:8]}_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}.zip"
    
    zip_path = TEMP_UPLOAD_DIR / archive_name
    
    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
        # Add data files
        for filename, content in files:
            # Sanitize filename - remove path components
            safe_filename = Path(filename).name
            # Remove any potentially dangerous characters
            safe_filename = "".join(c for c in safe_filename if c.isalnum() or c in "._- ")
            if safe_filename:
                zipf.writestr(safe_filename, content)
        
        # Add metadata YAML files
        if metadata_files:
            for meta_filename, yaml_content in metadata_files:
                safe_meta = Path(meta_filename).name
                zipf.writestr(safe_meta, yaml_content)
    
    logger.info(f"Created secure zip archive: {zip_path} ({zip_path.stat().st_size} bytes)")
    return zip_path


def create_nomad_metadata_yaml(
    experiment_id: str,
    user_name: str,
    session: Any,
    experiment_snapshot: dict[str, Any] | None = None,
    process_snapshot: dict[str, Any] | None = None,
) -> dict[tuple[str, str], dict[str, Any]]:
    """
    Create NOMAD perovskite solar cell metadata JSON structure from experiment data.

    Uses the Process's generatedStacks to populate layer types, perovskite
    composition and deposition parameters per the perovskite_solar_cell_database
    schema conventions:
      - layers separated by ' | '
      - sub-steps separated by ' >> '
      - multiple ions/compounds within one layer separated by '; '

    Args:
        experiment_id: UUID of the experiment
        user_name: Name of user entering the data
        session: Database session for querying
        experiment_snapshot: Frontend Experiment object (preferred, reflects live
            UI state)
        process_snapshot: Frontend Process object linked to the experiment
            (optional; fetched from UserState if not provided)

    Returns:
        dict keyed by (substrate_id, device_id) → NOMAD archive dict
    """
    from sqlmodel import select
    from app.models import Experiment, UserState
    import uuid as uuid_module

    # ── 1. Load experiment ────────────────────────────────────────────────────
    try:
        exp_uuid = uuid_module.UUID(experiment_id) if isinstance(experiment_id, str) else experiment_id
    except (ValueError, AttributeError):
        exp_uuid = experiment_id

    experiment = session.exec(select(Experiment).where(Experiment.id == exp_uuid)).first()
    if not experiment:
        raise ValueError(f"Experiment {experiment_id} not found")

    exp_data: dict[str, Any] = {}

    # Prefer request-provided experiment data so metadata preview reflects
    # unsaved/live edits from the UI.
    if experiment_snapshot and isinstance(experiment_snapshot, dict):
        exp_data = experiment_snapshot
    else:
        # Extract frontend data which contains full experiment definition
        frontend_data = experiment.frontend_data or {}

        # Try to get experiment data using both string and UUID representations
        exp_id_str = str(experiment_id)
        exp_data = frontend_data.get("experiments", {}).get(exp_id_str) or {}

        if not exp_data:
            # Also try with the database experiment ID
            exp_data = frontend_data.get("experiments", {}).get(str(experiment.id)) or {}

    if not exp_data:
        exp_data = {
            "name": experiment.name,
            "description": experiment.description or "",
            "architecture": experiment.device_type or "n-i-p",
            "substrateMaterial": "Unknown",
            "substrates": [],
            "devicesPerSubstrate": 1,
            "deviceArea": 0.09,
        }

    # ── 2. Load process ───────────────────────────────────────────────────────
    process_data: dict[str, Any] | None = None

    if process_snapshot and isinstance(process_snapshot, dict):
        process_data = process_snapshot
    else:
        process_id = exp_data.get("processId")
        if process_id:
            us = session.exec(
                select(UserState).where(UserState.owner_id == experiment.owner_id)
            ).first()
            if us and isinstance(us.data, dict):
                processes = us.data.get("processes", [])
                process_data = next(
                    (p for p in processes if p.get("id") == process_id), None
                )

    if not process_data:
        logger.warning(
            f"No process data found for experiment {experiment_id}; "
            "generated stacks unavailable – layer sections will be empty"
        )

    # ── 3. Build step map: step_id → ProcessStep dict ─────────────────────────
    step_map: dict[str, dict[str, Any]] = {}
    if process_data:
        for stage in (process_data.get("stages") or []):
            for step in (stage.get("alternatives") or []):
                sid = step.get("id", "")
                if sid:
                    step_map[sid] = step

    # ── 4. Collect active generated stacks (not in deletedStackCombinations) ──
    active_stacks: list[dict[str, Any]] = []
    if process_data:
        deleted_combinations: set[int] = set(
            process_data.get("deletedStackCombinations") or []
        )
        for stack in (process_data.get("generatedStacks") or []):
            if not isinstance(stack, dict):
                continue
            if stack.get("combination") not in deleted_combinations:
                active_stacks.append(stack)

    # ── 5. Experiment-level metadata ──────────────────────────────────────────
    substrate_material = exp_data.get("substrateMaterial", "Unknown")
    architecture_raw = exp_data.get("architecture", "n-i-p")
    # Normalise: "n-i-p" → "nip", "p-i-n" → "pin", etc.
    architecture_nomad = architecture_raw.replace("-", "")
    comment = exp_data.get("description", "") or exp_data.get("name", "")

    device_area = exp_data.get("deviceArea", 0.09)
    try:
        device_area = float(device_area)
    except (ValueError, TypeError):
        device_area = 0.09

    devices_per_substrate = (
        exp_data.get("devicesPerSubstrate")
        or exp_data.get("devices_per_substrate")
        or 1
    )
    try:
        devices_per_substrate = int(devices_per_substrate)
    except (ValueError, TypeError):
        devices_per_substrate = 1

    substrates_list: list[dict[str, Any]] = list(exp_data.get("substrates") or [])
    if not substrates_list:
        substrates_list = [{"id": "substrate_0", "name": "substrate_0"}]

    # ── Helper functions ──────────────────────────────────────────────────────

    def _get_step_param(
        step: dict[str, Any],
        param_key: str,
        substrate: dict[str, Any] | None,
        default: str = "Unknown",
    ) -> str:
        """Return the effective value of a ProcessParam, honouring variation mode."""
        param = step.get(param_key)
        if not param or not isinstance(param, dict):
            return default
        val = str(param.get("value", "") or "")
        if param.get("mode") == "variation" and substrate:
            step_id = step.get("id", "")
            lookup_key = f"{step_id}:{param_key}"
            sub_vals: dict = substrate.get("parameterValues") or {}
            val = str(sub_vals.get(lookup_key, val) or val)
        return val if val else default

    def _join_params(
        entries: list[tuple[dict[str, Any], str]],
        param_key: str,
        substrate: dict[str, Any] | None,
        default: str = "Unknown",
    ) -> str:
        vals = [_get_step_param(e[0], param_key, substrate, default) for e in entries]
        return " | ".join(vals) if vals else default

    def _layer_thickness(entries: list[tuple[dict[str, Any], str]]) -> str:
        thicknesses = [
            (e[0].get("_layer") or {}).get("thicknessNm") or "nan" for e in entries
        ]
        return " | ".join(thicknesses)

    def _ions_coefficients(ions_str: str) -> str:
        """Return '1' for a single ion, 'x; x; ...' for multiple ions."""
        ions = [i.strip() for i in ions_str.split(";") if i.strip()]
        return "1" if len(ions) <= 1 else "; ".join("x" for _ in ions)

    def _short_form(a_ions: str, b_ions: str, x_ions: str) -> str:
        squish = lambda s: "".join(i.strip() for i in s.split(";") if i.strip())
        return squish(a_ions) + squish(b_ions) + squish(x_ions)

    def _build_section(
        entries: list[tuple[dict[str, Any], str]],
        substrate: dict[str, Any] | None,
        thickness_key: str = "thickness",
    ) -> dict[str, Any]:
        """Build a generic deposition section dict (etl/htl/backcontact/add)."""
        return {
            "stack_sequence": " | ".join(name for _, name in entries),
            thickness_key: _layer_thickness(entries),
            "deposition_procedure": _join_params(entries, "depositionMethod", substrate),
            "deposition_synthesis_atmosphere": _join_params(entries, "depositionAtmosphere", substrate),
            "deposition_solvents": "Unknown",
            "deposition_reaction_solutions_compounds": "Unknown",
            "deposition_reaction_solutions_concentrations": "Unknown",
            "deposition_reaction_solutions_volumes": _join_params(entries, "solutionVolume", substrate),
            "deposition_reaction_solutions_temperature": "Unknown",
            "deposition_substrate_temperature": _join_params(entries, "substrateTemp", substrate),
            "deposition_thermal_annealing_temperature": _join_params(entries, "annealingTemp", substrate),
            "deposition_thermal_annealing_time": _join_params(entries, "annealingTime", substrate),
            "deposition_thermal_annealing_atmosphere": _join_params(entries, "annealingAtmosphere", substrate),
            "surface_treatment_before_next_deposition_step": "Unknown",
        }
    
    # ── 6. Per (substrate, device) metadata ──────────────────────────────────
    nomad_map: dict[tuple[str, str], dict[str, Any]] = {}
    n_stacks = len(active_stacks)

    for sub_idx, substrate in enumerate(substrates_list):
        if isinstance(substrate, dict):
            substrate_id = str(
                substrate.get("id") or substrate.get("name") or f"substrate_{sub_idx}"
            )
        else:
            substrate_id = str(getattr(substrate, "id", f"substrate_{sub_idx}"))
            substrate = {"id": substrate_id, "name": substrate_id}

        # Select generated stack: cycle if there are multiple stacks
        stack: dict[str, Any] | None = active_stacks[sub_idx % n_stacks] if n_stacks > 0 else None

        # Separate substrate layer from device layers in the generated stack
        substrate_layer_name: str = substrate_material
        stack_layers: list[dict[str, Any]] = []
        if stack:
            for layer in (stack.get("layers") or []):
                if layer.get("isSubstrate"):
                    substrate_layer_name = layer.get("name") or substrate_material
                else:
                    stack_layers.append(layer)

        # Group layers by type; each entry carries the matching ProcessStep + metadata
        etl_entries: list[tuple[dict[str, Any], str]] = []
        htl_entries: list[tuple[dict[str, Any], str]] = []
        absorber_entries: list[tuple[dict[str, Any], str]] = []
        backcontact_entries: list[tuple[dict[str, Any], str]] = []
        add_entries: list[tuple[dict[str, Any], str]] = []
        ordered_layer_names: list[str] = []

        for layer in stack_layers:
            layer_id = layer.get("id", "")
            layer_name = layer.get("name", "Unknown")
            ordered_layer_names.append(layer_name)
            step = dict(step_map.get(layer_id, {}))  # copy so we can attach metadata
            step["_layer"] = layer
            entry: tuple[dict[str, Any], str] = (step, layer_name)
            layer_type = layer.get("layerType", "")
            if layer_type == "ETL":
                etl_entries.append(entry)
            elif layer_type == "HTL":
                htl_entries.append(entry)
            elif layer_type == "absorber":
                absorber_entries.append(entry)
            elif layer_type == "contact":
                backcontact_entries.append(entry)
            elif layer_type == "interlayer":
                add_entries.append(entry)

        # Cell stack sequence: substrate | layer1 | layer2 | ...
        cell_stack_sequence = substrate_layer_name
        if ordered_layer_names:
            cell_stack_sequence += " | " + " | ".join(ordered_layer_names)

        for dev_idx in range(devices_per_substrate):
            device_id = f"device_{dev_idx}"

            data: dict[str, Any] = {
                "m_def": "perovskite_solar_cell_database.schema.PerovskiteSolarCell",
                "ref": {
                    "free_text_comment": comment or "",
                    "name_of_person_entering_the_data": user_name,
                },
                "cell": {
                    "stack_sequence": cell_stack_sequence,
                    "architecture": architecture_nomad,
                    "area_total": device_area,
                },
                "substrate": {
                    "stack_sequence": substrate_layer_name,
                    "thickness": "nan",
                },
            }

            # ETL section
            if etl_entries:
                data["etl"] = _build_section(etl_entries, substrate, thickness_key="thickness")

            # Perovskite (absorber) section
            if absorber_entries:
                abs_layer = (absorber_entries[0][0].get("_layer") or {})
                a_ions = abs_layer.get("perovskiteA") or "MA"
                b_ions = abs_layer.get("perovskiteB") or "Pb"
                x_ions = abs_layer.get("perovskiteX") or "I"
                band_gap = str(abs_layer.get("bandgapEv") or "nan")
                thickness = str(abs_layer.get("thicknessNm") or "nan")

                data["perovskite"] = {
                    "dimension_3D": True,
                    "dimension_list_of_layers": "3D",
                    "composition_a_ions": a_ions,
                    "composition_a_ions_coefficients": _ions_coefficients(a_ions),
                    "composition_b_ions": b_ions,
                    "composition_b_ions_coefficients": _ions_coefficients(b_ions),
                    "composition_c_ions": x_ions,
                    "composition_c_ions_coefficients": _ions_coefficients(x_ions),
                    "composition_short_form": _short_form(a_ions, b_ions, x_ions),
                    "composition_long_form": _short_form(a_ions, b_ions, x_ions),
                    "thickness": thickness,
                    "band_gap": band_gap,
                }

                data["perovskite_deposition"] = {
                    "number_of_deposition_steps": len(absorber_entries),
                    "procedure": _join_params(absorber_entries, "depositionMethod", substrate),
                    "aggregation_state_of_reactants": "Unknown",
                    "synthesis_atmosphere": _join_params(absorber_entries, "depositionAtmosphere", substrate),
                    "synthesis_atmosphere_pressure_total": "Unknown",
                    "synthesis_atmosphere_pressure_partial": "Unknown",
                    "synthesis_atmosphere_relative_humidity": "Unknown",
                    "solvents": "Unknown",
                    "solvents_mixing_ratios": "Unknown",
                    "solvents_supplier": "Unknown",
                    "solvents_purity": "Unknown",
                    "reaction_solutions_compounds": "Unknown",
                    "reaction_solutions_compounds_supplier": "Unknown",
                    "reaction_solutions_compounds_purity": "Unknown",
                    "reaction_solutions_concentrations": "Unknown",
                    "reaction_solutions_volumes": _join_params(absorber_entries, "solutionVolume", substrate),
                    "reaction_solutions_age": "Unknown",
                    "reaction_solutions_temperature": "Unknown",
                    "substrate_temperature": _join_params(absorber_entries, "substrateTemp", substrate),
                    "quenching_induced_crystallisation": False,
                    "quenching_media": _join_params(absorber_entries, "dryingMethod", substrate),
                    "quenching_media_mixing_ratios": "Unknown",
                    "quenching_media_volume": "Unknown",
                    "quenching_media_additives_compounds": "Unknown",
                    "quenching_media_additives_concentrations": "Unknown",
                    "thermal_annealing_temperature": _join_params(absorber_entries, "annealingTemp", substrate),
                    "thermal_annealing_time": _join_params(absorber_entries, "annealingTime", substrate),
                    "thermal_annealing_atmosphere": _join_params(absorber_entries, "annealingAtmosphere", substrate),
                    "thermal_annealing_relative_humidity": "Unknown",
                    "thermal_annealing_pressure": "Unknown",
                    "solvent_annealing": False,
                    "solvent_annealing_timing": "Unknown",
                    "solvent_annealing_solvent_atmosphere": "Unknown",
                    "solvent_annealing_time": "Unknown",
                    "solvent_annealing_temperature": "Unknown",
                    "after_treatment_of_formed_perovskite": "false",
                    "after_treatment_of_formed_perovskite_method": "Unknown",
                }
            else:
                # No absorber layer found: include minimal placeholder
                data["perovskite"] = {
                    "dimension_3D": True,
                    "dimension_list_of_layers": "3D",
                    "composition_a_ions": "Unknown",
                    "composition_a_ions_coefficients": "x",
                    "composition_b_ions": "Unknown",
                    "composition_b_ions_coefficients": "x",
                    "composition_c_ions": "Unknown",
                    "composition_c_ions_coefficients": "x",
                    "composition_short_form": "Unknown",
                    "composition_long_form": "Unknown",
                    "thickness": "nan",
                    "band_gap": "nan",
                }

            # HTL section
            if htl_entries:
                data["htl"] = _build_section(htl_entries, substrate, thickness_key="thickness_list")

            # Back contact section
            if backcontact_entries:
                data["backcontact"] = _build_section(backcontact_entries, substrate, thickness_key="thickness_list")

            # Additional / interlayer section
            if add_entries:
                data["add"] = _build_section(add_entries, substrate, thickness_key="thickness_list")

            # JV section (always present)
            data["jv"] = {"light_spectra": "AM 1.5G"}

            nomad_map[(substrate_id, device_id)] = {"data": data}

    logger.info(f"Generated NOMAD metadata for {len(nomad_map)} device entries (experiment {experiment_id})")
    return nomad_map


def upload_to_nomad(
    zip_path: Path,
    token: str | None = None,
    upload_name: str | None = None,
) -> dict[str, Any]:
    """
    Upload a zip file to NOMAD.

    Args:
        zip_path: Path to the zip file to upload
        token: NOMAD auth token (fetches new one if not provided)
        upload_name: Optional name for the upload

    Returns:
        Dict with upload_id, entry_ids, and other metadata from NOMAD

    Raises:
        NomadUploadError: If upload fails
    """
    if not token:
        token = get_nomad_token()
    
    if not zip_path.exists():
        raise NomadUploadError(f"Zip file not found: {zip_path}")
    
    upload_url = f"{settings.NOMAD_URL}/uploads"
    
    # ── MOCK MODE ──────────────────────────────────────────────────────
    if settings.NOMAD_MOCK_MODE:
        mock_id = f"MOCK_{uuid.uuid4().hex[:12]}"
        logger.info(
            "[MOCK MODE] upload_to_nomad — would POST %s with file=%s (%d bytes), "
            "upload_name=%s. Returning fake upload_id=%s instead.",
            upload_url,
            zip_path.name,
            zip_path.stat().st_size,
            upload_name,
            mock_id,
        )
        return {
            "upload_id": mock_id,
            "upload_create_time": datetime.now(timezone.utc).isoformat(),
            "processing_status": "mock",
            "entries": [],
            "entry_ids": [],
        }
    # ───────────────────────────────────────────────────────────────────
    
    try:
        with httpx.Client(timeout=120.0) as client:
            with open(zip_path, "rb") as f:
                # Prepare multipart form data
                files = {"file": (zip_path.name, f, "application/zip")}
                params = {}
                if upload_name:
                    params["upload_name"] = upload_name
                
                response = client.post(
                    upload_url,
                    files=files,
                    params=params,
                    headers={"Authorization": f"Bearer {token}"},
                )
            
            if response.status_code not in (200, 201):
                logger.error(f"NOMAD upload failed: {response.status_code} - {response.text}")
                raise NomadUploadError(f"NOMAD upload failed: {response.status_code}")
            
            upload_data = response.json()
            logger.info(f"NOMAD upload successful: {upload_data.get('upload_id')}")
            
            return {
                "upload_id": upload_data.get("upload_id"),
                "upload_create_time": upload_data.get("upload_create_time"),
                "processing_status": upload_data.get("process_status"),
                "entries": upload_data.get("entries", []),
                # Extract entry_ids if available
                "entry_ids": [e.get("entry_id") for e in upload_data.get("entries", []) if e.get("entry_id")],
            }
            
    except httpx.RequestError as e:
        logger.error(f"NOMAD upload request error: {e}")
        raise NomadUploadError(f"Failed to connect to NOMAD: {e}")


def get_upload_status(upload_id: str, token: str | None = None) -> dict[str, Any]:
    """
    Get the status of a NOMAD upload.
    
    Args:
        upload_id: The NOMAD upload ID
        token: NOMAD auth token (fetches new one if not provided)
    
    Returns:
        Dict with upload status information
    """
    if not token:
        token = get_nomad_token()
    
    status_url = f"{settings.NOMAD_URL}/uploads/{upload_id}"
    
    # ── MOCK MODE ──────────────────────────────────────────────────────
    if settings.NOMAD_MOCK_MODE:
        logger.info(
            "[MOCK MODE] get_upload_status — would GET %s. "
            "Returning fake 'success' status instead.",
            status_url,
        )
        return {
            "upload_id": upload_id,
            "process_status": "mock_success",
            "entries": [],
        }
    # ───────────────────────────────────────────────────────────────────
    
    try:
        with httpx.Client(timeout=30.0) as client:
            response = client.get(
                status_url,
                headers={"Authorization": f"Bearer {token}"},
            )
            
            if response.status_code != 200:
                logger.error(f"NOMAD status check failed: {response.status_code}")
                return {"error": f"Status check failed: {response.status_code}"}
            
            return response.json()
            
    except httpx.RequestError as e:
        logger.error(f"NOMAD status request error: {e}")
        return {"error": str(e)}


def delete_upload(upload_id: str, token: str | None = None) -> bool:
    """
    Delete a NOMAD upload.
    
    Args:
        upload_id: The NOMAD upload ID to delete
        token: NOMAD auth token (fetches new one if not provided)
    
    Returns:
        True if deletion was successful
    """
    if not token:
        token = get_nomad_token()
    
    delete_url = f"{settings.NOMAD_URL}/uploads/{upload_id}"
    
    # ── MOCK MODE ──────────────────────────────────────────────────────
    if settings.NOMAD_MOCK_MODE:
        logger.info(
            "[MOCK MODE] delete_upload — would DELETE %s. "
            "Returning True (no-op) instead.",
            delete_url,
        )
        return True
    # ───────────────────────────────────────────────────────────────────
    
    try:
        with httpx.Client(timeout=30.0) as client:
            response = client.delete(
                delete_url,
                headers={"Authorization": f"Bearer {token}"},
            )
            
            return response.status_code in (200, 204)
            
    except httpx.RequestError as e:
        logger.error(f"NOMAD delete request error: {e}")
        return False


def cleanup_temp_archive(zip_path: Path) -> bool:
    """
    Delete a temporary archive file.
    
    Args:
        zip_path: Path to the zip file to delete
    
    Returns:
        True if deletion was successful
    """
    try:
        if zip_path.exists() and zip_path.is_file():
            zip_path.unlink()
            logger.info(f"Cleaned up temporary archive: {zip_path}")
            return True
        return False
    except OSError as e:
        logger.error(f"Failed to cleanup temporary archive {zip_path}: {e}")
        return False


def cleanup_all_temp_archives() -> int:
    """
    Clean up all temporary archive files.
    
    Returns:
        Number of files deleted
    """
    if not TEMP_UPLOAD_DIR.exists():
        return 0
    
    count = 0
    for zip_file in TEMP_UPLOAD_DIR.glob("*.zip"):
        try:
            zip_file.unlink()
            count += 1
        except OSError:
            pass
    
    logger.info(f"Cleaned up {count} temporary archives")
    return count
