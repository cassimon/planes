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
import re
import shutil
import tempfile
import uuid
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx
import yaml

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


def add_metadata_to_zip(
    zip_path: Path,
    metadata_files: list[tuple[str, str]],
) -> Path:
    """
    Add metadata YAML files to an existing zip archive.
    
    This function modifies the zip archive in place by:
    1. Reading all existing files
    2. Creating a new zip with existing files + new metadata files
    3. Replacing the original zip
    
    Args:
        zip_path: Path to the existing zip file
        metadata_files: List of (filename, yaml_content) tuples to add
    
    Returns:
        Path to the updated zip file (same as input)
    
    Raises:
        FileNotFoundError: If zip_path doesn't exist
    """
    if not zip_path.exists():
        raise FileNotFoundError(f"Zip archive not found: {zip_path}")
    
    # Create temporary zip file
    temp_zip = zip_path.with_suffix('.tmp.zip')
    
    try:
        # Read existing files and add new metadata
        with zipfile.ZipFile(zip_path, 'r') as old_zip:
            with zipfile.ZipFile(temp_zip, 'w', zipfile.ZIP_DEFLATED) as new_zip:
                # Copy existing files (skip any existing .yaml files to avoid conflicts)
                for item in old_zip.namelist():
                    if not item.endswith('.yaml'):
                        new_zip.writestr(item, old_zip.read(item))
                
                # Add new metadata YAML files
                for meta_filename, yaml_content in metadata_files:
                    safe_meta = Path(meta_filename).name
                    new_zip.writestr(safe_meta, yaml_content)
        
        # Replace original with updated version
        temp_zip.replace(zip_path)
        logger.info(f"Added {len(metadata_files)} metadata files to archive: {zip_path} ({zip_path.stat().st_size} bytes)")
        
    except Exception as e:
        # Clean up temp file on error
        if temp_zip.exists():
            temp_zip.unlink()
        raise e
    
    return zip_path


def read_yaml_files_from_zip(zip_path: Path) -> dict[str, str]:
    """
    Read all YAML files from a zip archive.
    
    Args:
        zip_path: Path to the zip file
    
    Returns:
        Dict mapping filename to YAML content (as string)
    
    Raises:
        FileNotFoundError: If zip_path doesn't exist
    """
    if not zip_path.exists():
        raise FileNotFoundError(f"Zip archive not found: {zip_path}")
    
    yaml_files: dict[str, str] = {}
    
    with zipfile.ZipFile(zip_path, 'r') as zipf:
        for filename in zipf.namelist():
            if filename.endswith('.yaml') or filename.endswith('.yml'):
                content = zipf.read(filename).decode('utf-8')
                yaml_files[filename] = content
    
    return yaml_files


def create_nomad_metadata_yaml(
    experiment_id: str,
    user_name: str,
    session: Any,
    experiment_snapshot: dict[str, Any] | None = None,
    process_snapshot: dict[str, Any] | None = None,
    measurement_files: list[dict[str, Any]] | None = None,
    device_groups: list[dict[str, Any]] | None = None,
) -> dict[str, dict[str, Any]]:
    """
    Create NOMAD archive YAML structures from experiment and measurement data.

    Generates one sample archive per pixel (via device groups if provided, otherwise
    per substrate × devicesPerSubstrate) using the perovskite_solar_cell_database
    schema, plus one measurement archive per measurement file using the nomad_chose
    LabJVMeasurement / LabEQEMeasurement / LabStabilityMeasurement schemas.

    Conventions (perovskite_solar_cell_database):
      - Layers separated by ' | '
      - Sub-steps separated by ' >> '
      - Multiple ions/compounds: '; '-separated
      - Unknown/missing values: 'Unknown' (strings) or 'nan' (numeric fields)

    Args:
        experiment_id: UUID of the experiment
        user_name: Default operator / person entering data
        session: DB session for querying
        experiment_snapshot: Frontend Experiment object (live UI state preferred)
        process_snapshot: Frontend Process linked to the experiment
        measurement_files: Flat list of MeasurementFileInfo dicts (optional)
        device_groups: DeviceGroupInfo dicts with assignedSubstrateId (optional)

    Returns:
        dict[filename, yaml_content_dict] — one entry per .archive.yaml file
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
    us = session.exec(
        select(UserState).where(UserState.owner_id == experiment.owner_id)
    ).first()
    user_state_data = us.data if us and isinstance(us.data, dict) else {}

    process_data: dict[str, Any] | None = None

    if process_snapshot and isinstance(process_snapshot, dict):
        process_data = process_snapshot
    else:
        process_id = exp_data.get("processId")
        if process_id:
            if user_state_data:
                processes = user_state_data.get("processes", [])
                process_data = next(
                    (p for p in processes if p.get("id") == process_id), None
                )

    if not process_data:
        logger.warning(
            f"No process data found for experiment {experiment_id}; "
            "generated stacks unavailable – layer sections will be empty"
        )

    materials_by_id: dict[str, dict[str, Any]] = {
        str(material.get("id")): material
        for material in (user_state_data.get("materials") or [])
        if isinstance(material, dict) and material.get("id")
    }
    solutions_by_id: dict[str, dict[str, Any]] = {
        str(solution.get("id")): solution
        for solution in (user_state_data.get("solutions") or [])
        if isinstance(solution, dict) and solution.get("id")
    }

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

    def _clean_value(value: Any, default: str = "Unknown") -> str:
        text = str(value or "").strip()
        return text if text else default

    def _material_name(material: dict[str, Any] | None, fallback: str = "Unknown") -> str:
        if not isinstance(material, dict):
            return fallback
        for key in ("name", "inventoryLabel", "casNumber", "id"):
            value = str(material.get(key) or "").strip()
            if value:
                return value
        return fallback

    def _material_supplier(material: dict[str, Any] | None) -> str:
        if not isinstance(material, dict):
            return "Unknown"
        return _clean_value(material.get("supplier"))

    def _material_purity(material: dict[str, Any] | None) -> str:
        if not isinstance(material, dict):
            return "Unknown"
        return _clean_value(material.get("purity"))

    def _is_solvent_material(material: dict[str, Any] | None) -> bool:
        if not isinstance(material, dict):
            return False
        material_type = str(material.get("type") or "").lower()
        state_at_rt = str(material.get("stateAtRt") or "").lower()
        return "solvent" in material_type or state_at_rt in {"liquid", "gas"}

    def _format_layer_token_list(values: list[str], empty: str = "Unknown") -> str:
        cleaned = sorted({value.strip() for value in values if value and value.strip()})
        return "; ".join(cleaned) if cleaned else empty

    def _format_substrate_stack_sequence(raw_value: Any) -> str:
        text = str(raw_value or "").strip()
        if not text:
            return "Unknown"
        text = re.sub(r"^substrate\s*:\s*", "", text, flags=re.IGNORECASE)
        parts = [part.strip() for part in re.split(r"\s*[/\\|,;]+\s*", text) if part.strip()]
        if len(parts) <= 1:
            parts = [text] if text else []
        return " | ".join(parts) if parts else "Unknown"

    def _flatten_solution_components(
        solution_id: str,
        visited: set[str] | None = None,
    ) -> list[dict[str, str | bool]]:
        if not solution_id:
            return []
        if visited is None:
            visited = set()
        if solution_id in visited:
            return []
        visited = {solution_id, *visited}

        solution = solutions_by_id.get(solution_id)
        if not isinstance(solution, dict):
            return []

        flattened: list[dict[str, str | bool]] = []
        for component in (solution.get("components") or []):
            if not isinstance(component, dict):
                continue
            material_id = str(component.get("materialId") or "").strip()
            nested_solution_id = str(component.get("solutionId") or "").strip()

            if material_id:
                material = materials_by_id.get(material_id)
                amount = str(component.get("amount") or "").strip()
                unit = str(component.get("unit") or "").strip()
                flattened.append(
                    {
                        "name": _material_name(material, material_id),
                        "supplier": _material_supplier(material),
                        "purity": _material_purity(material),
                        "amount": f"{amount} {unit}".strip() if amount else "Unknown",
                        "is_solvent": _is_solvent_material(material),
                    }
                )
                continue

            if nested_solution_id:
                flattened.extend(_flatten_solution_components(nested_solution_id, visited))

        return flattened

    def _step_reaction_components(step: dict[str, Any]) -> list[dict[str, str | bool]]:
        components: list[dict[str, str | bool]] = []

        material_id = str(step.get("materialId") or "").strip()
        if material_id:
            material = materials_by_id.get(material_id)
            components.append(
                {
                    "name": _material_name(material, material_id),
                    "supplier": _material_supplier(material),
                    "purity": _material_purity(material),
                    "amount": "Unknown",
                    "is_solvent": _is_solvent_material(material),
                }
            )

        solution_id = str(step.get("solutionId") or "").strip()
        if solution_id:
            components.extend(_flatten_solution_components(solution_id))

        return components

    def _is_liquid_deposition(step: dict[str, Any]) -> bool:
        step_category = str(step.get("stepCategory") or "").strip().lower()
        if step_category == "wet_deposition":
            return True
        for component in _step_reaction_components(step):
            if bool(component.get("is_solvent")):
                return True
        return False

    def _aggregate_components_by_name(
        components: list[dict[str, str | bool]],
        *,
        solvents: bool,
    ) -> list[dict[str, str]]:
        grouped: dict[str, dict[str, set[str] | list[str]]] = {}

        for component in components:
            if bool(component.get("is_solvent")) != solvents:
                continue
            name = _clean_value(component.get("name"), default="")
            if not name:
                continue
            bucket = grouped.setdefault(
                name,
                {"supplier": set(), "purity": set(), "amounts": []},
            )
            supplier = _clean_value(component.get("supplier"))
            purity = _clean_value(component.get("purity"))
            amount = _clean_value(component.get("amount"))
            if supplier != "Unknown":
                bucket["supplier"].add(supplier)
            if purity != "Unknown":
                bucket["purity"].add(purity)
            if amount != "Unknown":
                bucket["amounts"].append(amount)

        aggregated: list[dict[str, str]] = []
        for name in sorted(grouped):
            bucket = grouped[name]
            suppliers = sorted(bucket["supplier"])
            purities = sorted(bucket["purity"])
            amounts = sorted(set(bucket["amounts"]))
            aggregated.append(
                {
                    "name": name,
                    "supplier": "; ".join(suppliers) if suppliers else "Unknown",
                    "purity": "; ".join(purities) if purities else "Unknown",
                    "amount": ", ".join(amounts) if amounts else "Unknown",
                }
            )
        return aggregated

    def _layer_solution_metadata(step: dict[str, Any]) -> dict[str, str]:
        if not _is_liquid_deposition(step):
            return {
                "solvents": "Unknown",
                "solvents_supplier": "Unknown",
                "solvents_purity": "Unknown",
                "compounds": "Unknown",
                "compounds_supplier": "Unknown",
                "compounds_purity": "Unknown",
                "concentrations": "Unknown",
            }

        components = _step_reaction_components(step)
        solvent_components = _aggregate_components_by_name(components, solvents=True)
        compound_components = _aggregate_components_by_name(components, solvents=False)

        return {
            "solvents": _format_layer_token_list([item["name"] for item in solvent_components]),
            "solvents_supplier": _format_layer_token_list(
                [item["supplier"] for item in solvent_components],
            ),
            "solvents_purity": _format_layer_token_list(
                [item["purity"] for item in solvent_components],
            ),
            "compounds": _format_layer_token_list([item["name"] for item in compound_components]),
            "compounds_supplier": _format_layer_token_list(
                [item["supplier"] for item in compound_components],
            ),
            "compounds_purity": _format_layer_token_list(
                [item["purity"] for item in compound_components],
            ),
            "concentrations": _format_layer_token_list(
                [item["amount"] for item in compound_components],
            ),
        }

    def _join_layer_solution_field(
        entries: list[tuple[dict[str, Any], str]],
        field: str,
    ) -> str:
        values = [_layer_solution_metadata(step).get(field, "Unknown") for step, _ in entries]
        return " | ".join(values) if values else "Unknown"

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

    def _format_coeff_value(raw: str) -> str:
        value = raw.strip()
        if not value:
            return "x"
        try:
            numeric = float(value)
            if numeric.is_integer():
                return str(int(numeric))
            return (f"{numeric:.6f}").rstrip("0").rstrip(".")
        except ValueError:
            return value

    def _parse_perovskite_ion_layers(raw_ions: Any) -> tuple[str, str, int]:
        """
        Parse perovskite ions into aligned `ions` and `coefficients` strings.

        Supports compact notation like `Cs0.1FA0.9` and explicit notation like
        `Cs; FA; MA` (with optional coefficients in tokens).
        """
        raw_text = str(raw_ions or "").strip()
        if not raw_text:
            return "Unknown", "x", 1

        layer_chunks = [chunk.strip() for chunk in raw_text.split("|") if chunk.strip()]
        if not layer_chunks:
            return "Unknown", "x", 1

        ion_layers: list[str] = []
        coeff_layers: list[str] = []

        compact_pattern = re.compile(
            r"(\([^)]+\)|[A-Za-z][A-Za-z@+\-]*?)(\d+(?:\.\d+)?)"
        )

        for layer in layer_chunks:
            tokens = [token.strip() for token in layer.split(";") if token.strip()]
            parsed_pairs: list[tuple[str, str]] = []

            for token in tokens or [layer]:
                compact_matches = list(compact_pattern.finditer(token))
                joined = "".join(match.group(0) for match in compact_matches)
                if compact_matches and joined == token:
                    for match in compact_matches:
                        ion_name = (match.group(1) or "").strip()
                        coeff = (match.group(2) or "").strip()
                        if ion_name:
                            parsed_pairs.append((ion_name, coeff))
                    continue

                explicit_match = re.match(r"^(.+?)(\d+(?:\.\d+)?)$", token)
                if explicit_match:
                    ion_name = (explicit_match.group(1) or "").strip()
                    coeff = (explicit_match.group(2) or "").strip()
                    if ion_name:
                        parsed_pairs.append((ion_name, coeff))
                        continue

                parsed_pairs.append((token, ""))

            ion_names = [ion for ion, _ in parsed_pairs if ion]
            if not ion_names:
                ion_layers.append("Unknown")
                coeff_layers.append("x")
                continue

            raw_coeffs = [coeff for _, coeff in parsed_pairs]
            if len(ion_names) == 1 and not raw_coeffs[0]:
                coeff_values = ["1"]
            else:
                coeff_values = [
                    _format_coeff_value(coeff) if coeff else "x"
                    for coeff in raw_coeffs
                ]

            ion_layers.append("; ".join(ion_names))
            coeff_layers.append("; ".join(coeff_values))

        return " | ".join(ion_layers), " | ".join(coeff_layers), len(ion_layers)

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
            "deposition_solvents": _join_layer_solution_field(entries, "solvents"),
            "deposition_reaction_solutions_compounds": _join_layer_solution_field(entries, "compounds"),
            "deposition_reaction_solutions_concentrations": _join_layer_solution_field(entries, "concentrations"),
            "deposition_reaction_solutions_volumes": _join_params(entries, "solutionVolume", substrate),
            "deposition_reaction_solutions_temperature": "Unknown",
            "deposition_substrate_temperature": _join_params(entries, "substrateTemp", substrate),
            "deposition_thermal_annealing_temperature": _join_params(entries, "annealingTemp", substrate),
            "deposition_thermal_annealing_time": _join_params(entries, "annealingTime", substrate),
            "deposition_thermal_annealing_atmosphere": _join_params(entries, "annealingAtmosphere", substrate),
            "surface_treatment_before_next_deposition_step": "Unknown",
        }
    
    # ── 6. Measurement-data helpers ───────────────────────────────────────────

    JV_TYPES: set[str] = {"JV", "Dark JV", "Stability (JV)"}
    IPCE_TYPES: set[str] = {"IPCE"}
    STABILITY_TYPES: set[str] = {"Stability (Tracking)", "Stability (Parameters)"}

    def _slug(name: str) -> str:
        """Filesystem-safe lowercase slug."""
        s = str(name).replace(" ", "_").replace("/", "-")
        s = re.sub(r"[^\w\-]", "", s)
        return s.strip("_") or "unknown"

    def _best_jv(files: list[dict[str, Any]]) -> dict[str, Any] | None:
        jv = [f for f in files if f.get("fileType") in JV_TYPES]
        return max(jv, key=lambda f: float(f.get("value") or 0), default=None)

    def _best_ipce(files: list[dict[str, Any]]) -> dict[str, Any] | None:
        ipce = [f for f in files if f.get("fileType") in IPCE_TYPES]
        return max(ipce, key=lambda f: float(f.get("jsc") or f.get("value") or 0), default=None)

    def _jv_section(
        jv_file: dict[str, Any] | None,
        ipce_file: dict[str, Any] | None,
    ) -> dict[str, Any]:
        sec: dict[str, Any] = {"light_spectra": "AM 1.5G"}
        if jv_file:
            if jv_file.get("value") is not None:
                sec["default_PCE"] = round(float(jv_file["value"]), 4)
            if jv_file.get("voc") is not None:
                sec["default_Voc"] = round(float(jv_file["voc"]), 4)
            jsc_val = jv_file.get("jsc")
            if jsc_val is None and ipce_file:
                jsc_val = ipce_file.get("jsc") or ipce_file.get("value")
            if jsc_val is not None:
                sec["default_Jsc"] = round(float(jsc_val), 4)
            if jv_file.get("ff") is not None:
                sec["default_FF"] = round(float(jv_file["ff"]), 4)
        elif ipce_file:
            jsc_val = ipce_file.get("jsc") or ipce_file.get("value")
            if jsc_val is not None:
                sec["default_Jsc"] = round(float(jsc_val), 4)
        return sec

    def _measurement_archive(
        meas_file: dict[str, Any],
        sample_filename: str,
        operator: str,
    ) -> dict[str, Any] | None:
        """Build a LabXxx measurement data dict, or None for non-measurement types."""
        file_type = meas_file.get("fileType", "Unknown")
        file_name = meas_file.get("fileName", "")
        op = str(meas_file.get("user") or operator)

        if file_type in JV_TYPES:
            return {
                "m_def": "nomad_chose.schema_packages.schema_package.LabJVMeasurement",
                "name": file_name,
                "operator": op,
                "jv_file": file_name,
                "pvk_sample": f"..../upload/raw/{sample_filename}#/data",
            }
        if file_type in IPCE_TYPES:
            return {
                "m_def": "nomad_chose.schema_packages.schema_package.LabEQEMeasurement",
                "name": file_name,
                "operator": op,
                "eqe_file": file_name,
                "pvk_sample": f"../upload/raw/{sample_filename}#/data",
            }
        if file_type in STABILITY_TYPES:
            entry: dict[str, Any] = {
                "m_def": "nomad_chose.schema_packages.schema_package.LabStabilityMeasurement",
                "name": file_name,
                "operator": op,
                "pvk_sample": f"..../upload/raw/{sample_filename}#/data",
            }
            if file_type == "Stability (Tracking)":
                entry["stability_tracking_file"] = file_name
            else:
                entry["stability_parameters_file"] = file_name
            return entry
        # Document / Image / Archive / Unknown → skip
        return None

    def _build_sample_data(
        substrate_layer_name: str,
        cell_stack_sequence: str,
        etl_e: list,
        absorber_e: list,
        htl_e: list,
        backcontact_e: list,
        add_e: list,
        substrate: dict[str, Any] | None,
        jv_sec: dict[str, Any],
    ) -> dict[str, Any]:
        """Assemble the PerovskiteSolarCell data dict."""
        d: dict[str, Any] = {
            "m_def": "nomad_perovskite_solar_cell_sample_plains.schema_packages.sample.PerovskiteSolarCellSample",
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

        if etl_e:
            d["etl"] = _build_section(etl_e, substrate, thickness_key="thickness")

        if absorber_e:
            abs_layer = (absorber_e[0][0].get("_layer") or {})
            a_ions = abs_layer.get("perovskiteA") or "MA"
            b_ions = abs_layer.get("perovskiteB") or "Pb"
            x_ions = abs_layer.get("perovskiteX") or "I"
            parsed_a_ions, parsed_a_coeffs, a_layers = _parse_perovskite_ion_layers(a_ions)
            parsed_b_ions, parsed_b_coeffs, b_layers = _parse_perovskite_ion_layers(b_ions)
            parsed_c_ions, parsed_c_coeffs, c_layers = _parse_perovskite_ion_layers(x_ions)
            max_layers = max(a_layers, b_layers, c_layers, 1)
            dimension_list = " | ".join(["3.0"] * max_layers)
            band_gap = str(abs_layer.get("bandgapEv") or "nan")
            thickness = str(abs_layer.get("thicknessNm") or "nan")
            absorber_solution_meta = {
                "solvents": _join_layer_solution_field(absorber_e, "solvents"),
                "solvents_supplier": _join_layer_solution_field(absorber_e, "solvents_supplier"),
                "solvents_purity": _join_layer_solution_field(absorber_e, "solvents_purity"),
                "compounds": _join_layer_solution_field(absorber_e, "compounds"),
                "compounds_supplier": _join_layer_solution_field(absorber_e, "compounds_supplier"),
                "compounds_purity": _join_layer_solution_field(absorber_e, "compounds_purity"),
                "concentrations": _join_layer_solution_field(absorber_e, "concentrations"),
            }

            d["perovskite"] = {
                "dimension_3D": True,
                "dimension_list_of_layers": dimension_list,
                "composition_perovskite_ABC3_structure": True,
                "composition_a_ions": parsed_a_ions,
                "composition_a_ions_coefficients": parsed_a_coeffs,
                "composition_b_ions": parsed_b_ions,
                "composition_b_ions_coefficients": parsed_b_coeffs,
                "composition_c_ions": parsed_c_ions,
                "composition_c_ions_coefficients": parsed_c_coeffs,
                "composition_short_form": _short_form(a_ions, b_ions, x_ions),
                "composition_long_form": _short_form(a_ions, b_ions, x_ions),
                "thickness": thickness,
                "band_gap": band_gap,
            }
            d["perovskite_deposition"] = {
                "number_of_deposition_steps": len(absorber_e),
                "procedure": _join_params(absorber_e, "depositionMethod", substrate),
                "aggregation_state_of_reactants": "Unknown",
                "synthesis_atmosphere": _join_params(absorber_e, "depositionAtmosphere", substrate),
                "synthesis_atmosphere_pressure_total": "Unknown",
                "synthesis_atmosphere_pressure_partial": "Unknown",
                "synthesis_atmosphere_relative_humidity": "Unknown",
                "solvents": absorber_solution_meta["solvents"],
                "solvents_mixing_ratios": "Unknown",
                "solvents_supplier": absorber_solution_meta["solvents_supplier"],
                "solvents_purity": absorber_solution_meta["solvents_purity"],
                "reaction_solutions_compounds": absorber_solution_meta["compounds"],
                "reaction_solutions_compounds_supplier": absorber_solution_meta["compounds_supplier"],
                "reaction_solutions_compounds_purity": absorber_solution_meta["compounds_purity"],
                "reaction_solutions_concentrations": absorber_solution_meta["concentrations"],
                "reaction_solutions_volumes": _join_params(absorber_e, "solutionVolume", substrate),
                "reaction_solutions_age": "Unknown",
                "reaction_solutions_temperature": "Unknown",
                "substrate_temperature": _join_params(absorber_e, "substrateTemp", substrate),
                "quenching_induced_crystallisation": False,
                "quenching_media": _join_params(absorber_e, "dryingMethod", substrate),
                "quenching_media_mixing_ratios": "Unknown",
                "quenching_media_volume": "Unknown",
                "quenching_media_additives_compounds": "Unknown",
                "quenching_media_additives_concentrations": "Unknown",
                "thermal_annealing_temperature": _join_params(absorber_e, "annealingTemp", substrate),
                "thermal_annealing_time": _join_params(absorber_e, "annealingTime", substrate),
                "thermal_annealing_atmosphere": _join_params(absorber_e, "annealingAtmosphere", substrate),
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
            d["perovskite"] = {
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

        if htl_e:
            d["htl"] = _build_section(htl_e, substrate, thickness_key="thickness_list")
        if backcontact_e:
            d["backcontact"] = _build_section(backcontact_e, substrate, thickness_key="thickness_list")
        if add_e:
            d["add"] = _build_section(add_e, substrate, thickness_key="thickness_list")

        d["jv"] = jv_sec
        return d

    # ── 7. Per-substrate layer grouping (shared logic) ────────────────────────

    def _layers_for_substrate(
        sub_idx: int,
        substrate: dict[str, Any],
    ) -> tuple[str, str, list, list, list, list, list]:
        """
        Return (substrate_layer_name, cell_stack_sequence,
                etl_entries, absorber_entries, htl_entries,
                backcontact_entries, add_entries)
        for the given substrate index using the cyclically-assigned stack.
        """
        n = len(active_stacks)
        stack: dict[str, Any] | None = active_stacks[sub_idx % n] if n > 0 else None

        sub_layer_name: str = substrate_material
        stack_layers: list[dict[str, Any]] = []
        if stack:
            for layer in (stack.get("layers") or []):
                if not isinstance(layer, dict):
                    continue
                if layer.get("isSubstrate"):
                    sub_layer_name = layer.get("name") or substrate_material
                else:
                    stack_layers.append(layer)

        sub_layer_name = _format_substrate_stack_sequence(sub_layer_name)

        etl_e: list[tuple[dict[str, Any], str]] = []
        htl_e: list[tuple[dict[str, Any], str]] = []
        absorber_e: list[tuple[dict[str, Any], str]] = []
        bc_e: list[tuple[dict[str, Any], str]] = []
        add_e: list[tuple[dict[str, Any], str]] = []
        ordered_names: list[str] = []

        for layer in stack_layers:
            layer_id = layer.get("id", "")
            layer_name = layer.get("name", "Unknown")
            ordered_names.append(layer_name)
            step = dict(step_map.get(layer_id, {}))
            step["_layer"] = layer
            entry: tuple[dict[str, Any], str] = (step, layer_name)
            lt = layer.get("layerType", "")
            if lt == "ETL":
                etl_e.append(entry)
            elif lt == "HTL":
                htl_e.append(entry)
            elif lt == "absorber":
                absorber_e.append(entry)
            elif lt == "contact":
                bc_e.append(entry)
            elif lt == "interlayer":
                add_e.append(entry)

        stack_seq = sub_layer_name
        if ordered_names:
            stack_seq += " | " + " | ".join(ordered_names)

        return sub_layer_name, stack_seq, etl_e, absorber_e, htl_e, bc_e, add_e

    # ── 8. Build device-group lookup by substrate ─────────────────────────────
    groups_by_substrate: dict[str, list[dict[str, Any]]] = {}
    unassigned_groups: list[dict[str, Any]] = []
    if device_groups:
        for group in device_groups:
            sub_id = str(group.get("assignedSubstrateId") or "")
            if sub_id:
                groups_by_substrate.setdefault(sub_id, []).append(group)
            else:
                unassigned_groups.append(group)

    # ── 9. Generate archives ──────────────────────────────────────────────────
    archives: dict[str, dict[str, Any]] = {}

    for sub_idx, substrate in enumerate(substrates_list):
        if isinstance(substrate, dict):
            substrate_id = str(
                substrate.get("id") or substrate.get("name") or f"substrate_{sub_idx}"
            )
        else:
            substrate_id = str(getattr(substrate, "id", f"substrate_{sub_idx}"))
            substrate = {"id": substrate_id, "name": substrate_id}

        sub_name_slug = _slug(str(substrate.get("name") or substrate_id))

        sub_layer, stack_seq, etl_e, absorber_e, htl_e, bc_e, add_e = (
            _layers_for_substrate(sub_idx, substrate)
        )

        substrate_groups = groups_by_substrate.get(substrate_id, [])

        if substrate_groups:
            # ── One sample + measurement YAMLs per device group ────────────────
            for group in substrate_groups:
                device_name = str(group.get("deviceName") or "device")
                dev_slug = _slug(device_name)
                sample_fname = f"{sub_name_slug}_{dev_slug}_sample.archive.yaml"

                group_files: list[dict[str, Any]] = list(group.get("files") or [])
                best_jv = _best_jv(group_files)
                best_ipce = _best_ipce(group_files)
                jv_sec = _jv_section(best_jv, best_ipce)

                sample_data = _build_sample_data(
                    sub_layer, stack_seq, etl_e, absorber_e, htl_e, bc_e, add_e,
                    substrate, jv_sec,
                )
                archives[sample_fname] = {"data": sample_data}

                # ── Measurement YAMLs ──────────────────────────────────────────
                for meas_file in group_files:
                    meas_data = _measurement_archive(meas_file, sample_fname, user_name)
                    if meas_data is None:
                        continue
                    meas_stem = _slug(Path(meas_file.get("fileName", "unknown")).stem)
                    # Avoid filename collisions
                    meas_fname = f"{meas_stem}.archive.yaml"
                    counter = 1
                    while meas_fname in archives:
                        meas_fname = f"{meas_stem}_{counter}.archive.yaml"
                        counter += 1
                    archives[meas_fname] = {"data": meas_data}
        else:
            # ── Fallback: one sample YAML per device index, no measurements ────
            for dev_idx in range(devices_per_substrate):
                sample_fname = f"{sub_name_slug}_dev{dev_idx + 1}_sample.archive.yaml"
                jv_sec = {"light_spectra": "AM 1.5G"}
                sample_data = _build_sample_data(
                    sub_layer, stack_seq, etl_e, absorber_e, htl_e, bc_e, add_e,
                    substrate, jv_sec,
                )
                archives[sample_fname] = {"data": sample_data}

    # ── 10. Unassigned device groups (no substrate match) ─────────────────────
    for group in unassigned_groups:
        device_name = str(group.get("deviceName") or "unassigned")
        dev_slug = _slug(device_name)
        # No sample YAML — just measurement YAMLs with a placeholder reference
        sample_placeholder = f"sample_{dev_slug}_sample.archive.yaml"
        group_files = list(group.get("files") or [])
        for meas_file in group_files:
            meas_data = _measurement_archive(meas_file, sample_placeholder, user_name)
            if meas_data is None:
                continue
            meas_stem = _slug(Path(meas_file.get("fileName", "unknown")).stem)
            meas_fname = f"{meas_stem}.archive.yaml"
            counter = 1
            while meas_fname in archives:
                meas_fname = f"{meas_stem}_{counter}.archive.yaml"
                counter += 1
            archives[meas_fname] = {"data": meas_data}

    logger.info(
        f"Generated {len(archives)} NOMAD archive files for experiment {experiment_id}"
    )
    return archives


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
