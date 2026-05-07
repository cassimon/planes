import json
import logging
import uuid as _uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from sqlalchemy.orm.attributes import flag_modified
from sqlmodel import select

from app.api.deps import CurrentUser, SessionDep
from app.models import (
    UserState,
    UserStatePublic,
    BulkStateResponse,
    Material,
    Solution,
    SolutionComponent,
    Process,
    ProcessStep,
    Experiment,
    Substrate,
    ExperimentResults,
    MeasurementFile,
    DeviceGroup,
    Plane,
    CanvasElement,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/state", tags=["state"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _uuid_or_gen(raw: str | None) -> _uuid.UUID:
    """Parse a UUID string, or generate a new one if invalid/missing."""
    if raw:
        try:
            return _uuid.UUID(raw)
        except (ValueError, AttributeError):
            pass
    return _uuid.uuid4()


def _safe_float(val: Any, default: float = 0.0) -> float:
    try:
        return float(val)
    except (TypeError, ValueError):
        return default


def _safe_datetime(val: Any) -> datetime | None:
    if not val:
        return None
    if isinstance(val, datetime):
        return val
    if isinstance(val, str):
        raw = val.strip()
        if not raw:
            return None
        # Accept common ISO input with trailing Z.
        if raw.endswith("Z"):
            raw = f"{raw[:-1]}+00:00"
        try:
            return datetime.fromisoformat(raw)
        except ValueError:
            return None
    return None


def _extract_overflow(payload: dict[str, Any], known_keys: set[str]) -> dict[str, Any] | None:
    overflow = {k: v for k, v in payload.items() if k not in known_keys}
    return overflow or None


# ---------------------------------------------------------------------------
# GET /state/ — read state from normalised tables
# ---------------------------------------------------------------------------

@router.get("/", response_model=UserStatePublic)
def read_state(session: SessionDep, current_user: CurrentUser) -> Any:
    """Reconstruct the full AppSnapshot from normalised tables."""
    uid = current_user.id

    # --- Materials ---
    materials_db = session.exec(select(Material).where(Material.owner_id == uid)).all()
    materials_out = []
    for m in materials_db:
        if m.frontend_data:
            materials_out.append(m.frontend_data)
        else:
            materials_out.append({
                "id": str(m.id), "type": "", "name": m.name,
                "supplier": m.supplier or "", "supplierNumber": "",
                "casNumber": m.cas_number or "", "pubchemCid": "",
                "inventoryLabel": "", "purity": "",
            })

    # --- Solutions ---
    solutions_db = session.exec(select(Solution).where(Solution.owner_id == uid)).all()
    solutions_out = []
    for s in solutions_db:
        if s.frontend_data:
            payload = dict(s.frontend_data)
            if "handling" not in payload:
                payload["handling"] = s.handling or ""
            if "creationTime" not in payload:
                payload["creationTime"] = (
                    s.creation_time or s.created_at or datetime.now(timezone.utc)
                ).isoformat()
            solutions_out.append(payload)
        else:
            solutions_out.append({
                "id": str(s.id), "name": s.name, "components": [],
                "handling": s.handling or "",
                "creationTime": (s.creation_time or s.created_at or datetime.now(timezone.utc)).isoformat(),
            })

    # --- Experiments ---
    experiments_db = session.exec(select(Experiment).where(Experiment.owner_id == uid)).all()
    experiments_out = []
    for e in experiments_db:
        if e.frontend_data:
            experiments_out.append(e.frontend_data)
        else:
            experiments_out.append({
                "id": str(e.id), "name": e.name, "description": e.description or "",
                "date": (e.created_at or datetime.now(timezone.utc)).strftime("%Y-%m-%d"),
                "architecture": "n-i-p", "substrateMaterial": "",
                "substrateWidth": 2.5, "substrateLength": 2.5,
                "numSubstrates": 1, "devicesPerSubstrate": 4,
                "deviceArea": e.active_area_cm2 or 0.09,
                "deviceType": e.device_type or "film",
                "processId": str(e.process_id) if e.process_id else "",
                "substrates": [], "hasResults": False,
            })

    # --- Processes ---
    processes_db = session.exec(select(Process).where(Process.owner_id == uid)).all()
    processes_out = []
    for p in processes_db:
        if p.frontend_data:
            processes_out.append(p.frontend_data)
            continue

        steps_db = session.exec(
            select(ProcessStep)
            .where(ProcessStep.process_id == p.id)
            .order_by(ProcessStep.level.asc(), ProcessStep.name.asc())
        ).all()

        stages_map: dict[int, list[dict[str, Any]]] = {}
        for step in steps_db:
            step_payload = (
                dict(step.frontend_data)
                if step.frontend_data
                else {
                    "id": str(step.id),
                    "name": step.name,
                    "stepCategory": step.step_category or "wet_deposition",
                    "color": step.color or "#6f7cc3",
                    "materialId": str(step.material_id) if step.material_id else None,
                    "solutionId": str(step.solution_id) if step.solution_id else None,
                    "notes": step.notes,
                }
            )
            stages_map.setdefault(step.level, []).append(step_payload)

        stages = [
            {"index": level, "alternatives": alternatives}
            for level, alternatives in sorted(stages_map.items(), key=lambda kv: kv[0])
        ]

        processes_out.append(
            {
                "id": str(p.id),
                "name": p.name,
                "description": p.description or "",
                "stages": stages,
            }
        )

    # --- Results ---
    results_db = session.exec(select(ExperimentResults).where(ExperimentResults.owner_id == uid)).all()
    results_out = []
    for r in results_db:
        if r.frontend_data:
            results_out.append(r.frontend_data)
        else:
            results_out.append({
                "id": str(r.id), "experimentId": str(r.experiment_id),
                "files": [], "deviceGroups": [],
                "groupingStrategy": "search", "matchingStrategy": "fuzzy",
                "updatedAt": (r.created_at or datetime.now(timezone.utc)).isoformat(),
            })

    # --- Planes + Elements ---
    planes_db = session.exec(select(Plane).where(Plane.owner_id == uid)).all()
    planes_out = []
    for p in planes_db:
        if p.frontend_data:
            planes_out.append(p.frontend_data)
        else:
            elems = []
            for el in p.elements:
                if el.frontend_data:
                    elems.append(el.frontend_data)
                else:
                    elems.append({
                        "id": str(el.id), "type": el.element_type or "text",
                        "position": {"x": el.x, "y": el.y},
                        "size": {"x": el.width, "y": el.height},
                        "content": el.content or "", "color": el.color,
                    })
            planes_out.append({"id": str(p.id), "name": p.name, "elements": elems})

    data = {
        "materials": materials_out,
        "solutions": solutions_out,
        "processes": processes_out,
        "experiments": experiments_out,
        "results": results_out,
        "planes": planes_out,
    }

    logger.info(
        "GET /state/ user=%s — materials=%d solutions=%d processes=%d experiments=%d "
        "results=%d planes=%d",
        uid,
        len(materials_out),
        len(solutions_out),
        len(processes_out),
        len(experiments_out),
        len(results_out), len(planes_out),
    )

    # Also fetch updated_at from the UserState row (if any)
    us = session.exec(select(UserState).where(UserState.owner_id == uid)).first()
    updated_at = us.updated_at if us else None

    return UserStatePublic(data=data, updated_at=updated_at)


# ---------------------------------------------------------------------------
# PUT /state/ — sync AppSnapshot into normalised tables
# ---------------------------------------------------------------------------

@router.put("/", response_model=UserStatePublic)
def update_state(
    session: SessionDep, current_user: CurrentUser, *, body: UserStatePublic
) -> Any:
    """
    Persist the full AppSnapshot into normalised tables.

    Strategy per entity type: upsert (insert or update) every item in the
    incoming snapshot, then delete any DB rows whose IDs are no longer present.
    """
    uid = current_user.id
    data = body.data or {}

    logger.info(
        "PUT /state/ user=%s — materials=%d solutions=%d processes=%d experiments=%d "
        "results=%d planes=%d",
        uid,
        len(data.get("materials", [])),
        len(data.get("solutions", [])),
        len(data.get("processes", [])),
        len(data.get("experiments", [])),
        len(data.get("results", [])),
        len(data.get("planes", [])),
    )

    try:
        return _do_sync(session, uid, data)
    except Exception:
        logger.exception("PUT /state/ user=%s — sync failed", uid)
        session.rollback()
        return JSONResponse(
            status_code=500,
            content={"detail": "State sync failed. Check server logs."},
        )


def _do_sync(session: SessionDep, uid: _uuid.UUID, data: dict) -> UserStatePublic:
    # ------------------------------------------------------------------
    # 1. Materials
    # ------------------------------------------------------------------
    incoming_materials = data.get("materials", [])
    incoming_mat_ids: set[_uuid.UUID] = set()

    existing_mats = {
        m.id: m
        for m in session.exec(select(Material).where(Material.owner_id == uid)).all()
    }

    for m_data in incoming_materials:
        mid = _uuid_or_gen(m_data.get("id"))
        incoming_mat_ids.add(mid)
        if mid in existing_mats:
            mat = existing_mats[mid]
            mat.name = m_data.get("name") or mat.name
            mat.cas_number = m_data.get("casNumber") or m_data.get("cas_number")
            mat.supplier = m_data.get("supplier")
            mat.frontend_data = m_data
            flag_modified(mat, "frontend_data")
            session.add(mat)
        else:
            mat = Material(
                id=mid,
                owner_id=uid,
                name=m_data.get("name", ""),
                cas_number=m_data.get("casNumber") or m_data.get("cas_number"),
                supplier=m_data.get("supplier"),
                frontend_data=m_data,
            )
            session.add(mat)

    # Delete materials no longer in the snapshot
    for old_id in set(existing_mats) - incoming_mat_ids:
        session.delete(existing_mats[old_id])

    # Flush so material rows exist for FK references from solution components
    session.flush()

    # ------------------------------------------------------------------
    # 2. Solutions (with components)
    # ------------------------------------------------------------------
    incoming_solutions = data.get("solutions", [])
    incoming_sol_ids: set[_uuid.UUID] = set()

    existing_sols = {
        s.id: s
        for s in session.exec(select(Solution).where(Solution.owner_id == uid)).all()
    }

    for s_data in incoming_solutions:
        sid = _uuid_or_gen(s_data.get("id"))
        has_creation_time = (
            "creationTime" in s_data or "creation_time" in s_data
        )
        creation_time = _safe_datetime(
            s_data.get("creationTime") or s_data.get("creation_time")
        )
        incoming_sol_ids.add(sid)
        if sid in existing_sols:
            sol = existing_sols[sid]
            sol.name = s_data.get("name") or sol.name
            if "handling" in s_data:
                sol.handling = s_data.get("handling")
            if has_creation_time and creation_time is not None:
                sol.creation_time = creation_time
            sol.frontend_data = s_data
            flag_modified(sol, "frontend_data")
            session.add(sol)
        else:
            sol = Solution(
                id=sid,
                owner_id=uid,
                name=s_data.get("name", ""),
                handling=s_data.get("handling"),
                creation_time=creation_time or datetime.now(timezone.utc),
                frontend_data=s_data,
            )
            session.add(sol)
        session.flush()  # ensure solution row exists for FK
        _sync_solution_components(session, sid, s_data.get("components", []))

    for old_id in set(existing_sols) - incoming_sol_ids:
        session.delete(existing_sols[old_id])

    # ------------------------------------------------------------------
    # 3. Processes (with steps)
    # ------------------------------------------------------------------
    incoming_processes = data.get("processes", [])
    incoming_proc_ids: set[_uuid.UUID] = set()

    existing_procs = {
        p.id: p
        for p in session.exec(select(Process).where(Process.owner_id == uid)).all()
    }

    for p_data in incoming_processes:
        pid = _uuid_or_gen(p_data.get("id"))
        incoming_proc_ids.add(pid)
        overflow_data = _extract_overflow(
            p_data,
            {"id", "name", "description", "stages"},
        )
        if pid in existing_procs:
            proc = existing_procs[pid]
            proc.name = p_data.get("name") or proc.name
            proc.description = p_data.get("description")
            proc.frontend_data = p_data
            proc.overflow_data = overflow_data
            flag_modified(proc, "frontend_data")
            session.add(proc)
        else:
            proc = Process(
                id=pid,
                owner_id=uid,
                name=p_data.get("name", ""),
                description=p_data.get("description"),
                frontend_data=p_data,
                overflow_data=overflow_data,
            )
            session.add(proc)
        session.flush()  # ensure process exists for FK
        _sync_process_steps(session, pid, p_data.get("stages", []))

    for old_id in set(existing_procs) - incoming_proc_ids:
        session.delete(existing_procs[old_id])

    # ------------------------------------------------------------------
    # 4. Experiments (with substrates, linked to process)
    # ------------------------------------------------------------------
    incoming_experiments = data.get("experiments", [])
    incoming_exp_ids: set[_uuid.UUID] = set()

    existing_exps = {
        e.id: e
        for e in session.exec(select(Experiment).where(Experiment.owner_id == uid)).all()
    }

    for e_data in incoming_experiments:
        eid = _uuid_or_gen(e_data.get("id"))
        process_id_str = e_data.get("processId") or e_data.get("process_id")
        process_id: _uuid.UUID | None = None
        if process_id_str:
            try:
                parsed_process_id = _uuid.UUID(process_id_str)
                if parsed_process_id in incoming_proc_ids:
                    process_id = parsed_process_id
            except (ValueError, AttributeError):
                process_id = None

        overflow_data = _extract_overflow(
            e_data,
            {
                "id", "name", "description", "date", "endDate", "architecture",
                "substrateMaterial", "substrateWidth", "substrateLength", "numSubstrates",
                "devicesPerSubstrate", "deviceArea", "deviceType", "deviceLayoutImage",
                "processId", "process_id", "substrates", "processingTimes", "hasResults",
                "notes",
            },
        )

        incoming_exp_ids.add(eid)
        if eid in existing_exps:
            exp = existing_exps[eid]
            exp.name = e_data.get("name") or exp.name
            exp.description = e_data.get("description")
            exp.device_type = e_data.get("deviceType") or e_data.get("device_type")
            exp.active_area_cm2 = _safe_float(e_data.get("deviceArea") or e_data.get("active_area_cm2"))
            exp.process_id = process_id
            exp.frontend_data = e_data
            exp.overflow_data = overflow_data
            flag_modified(exp, "frontend_data")
            session.add(exp)
        else:
            exp = Experiment(
                id=eid,
                owner_id=uid,
                name=e_data.get("name", ""),
                description=e_data.get("description"),
                device_type=e_data.get("deviceType") or e_data.get("device_type"),
                active_area_cm2=_safe_float(e_data.get("deviceArea") or e_data.get("active_area_cm2")),
                process_id=process_id,
                frontend_data=e_data,
                overflow_data=overflow_data,
            )
            session.add(exp)
        session.flush()  # ensure eid exists for FK
        _sync_experiment_substrates(session, eid, e_data.get("substrates", []))

    for old_id in set(existing_exps) - incoming_exp_ids:
        session.delete(existing_exps[old_id])

    # ------------------------------------------------------------------
    # 5. Results
    # ------------------------------------------------------------------
    incoming_results = data.get("results", [])
    incoming_res_ids: set[_uuid.UUID] = set()

    existing_res = {
        r.id: r
        for r in session.exec(select(ExperimentResults).where(ExperimentResults.owner_id == uid)).all()
    }

    for r_data in incoming_results:
        rid = _uuid_or_gen(r_data.get("id"))
        exp_id_str = r_data.get("experimentId") or r_data.get("experiment_id")
        if not exp_id_str:
            logger.warning("Skipping result with no experiment_id")
            continue
        try:
            exp_id = _uuid.UUID(exp_id_str)
        except (ValueError, AttributeError):
            logger.warning(f"Skipping result with invalid experiment_id: {exp_id_str}")
            continue
        
        # Only create result if the experiment exists in the incoming data
        if exp_id not in incoming_exp_ids:
            logger.warning(f"Skipping result for non-existent experiment: {exp_id}")
            continue

        overflow_data = _extract_overflow(
            r_data,
            {
                "id", "experimentId", "experiment_id", "notes", "files",
                "deviceGroups", "groupingStrategy", "matchingStrategy", "updatedAt",
            },
        )
            
        incoming_res_ids.add(rid)
        if rid in existing_res:
            res = existing_res[rid]
            res.experiment_id = exp_id
            res.frontend_data = r_data
            res.overflow_data = overflow_data
            flag_modified(res, "frontend_data")
            session.add(res)
        else:
            res = ExperimentResults(
                id=rid,
                owner_id=uid,
                experiment_id=exp_id,
                frontend_data=r_data,
                overflow_data=overflow_data,
            )
            session.add(res)

    for old_id in set(existing_res) - incoming_res_ids:
        session.delete(existing_res[old_id])

    # ------------------------------------------------------------------
    # 6. Planes + CanvasElements
    # ------------------------------------------------------------------
    incoming_planes = data.get("planes", [])
    incoming_plane_ids: set[_uuid.UUID] = set()

    existing_planes = {
        p.id: p
        for p in session.exec(select(Plane).where(Plane.owner_id == uid)).all()
    }

    for p_data in incoming_planes:
        pid = _uuid_or_gen(p_data.get("id"))
        incoming_plane_ids.add(pid)
        if pid in existing_planes:
            plane = existing_planes[pid]
            plane.name = p_data.get("name") or plane.name
            plane.frontend_data = p_data
            flag_modified(plane, "frontend_data")
            session.add(plane)
        else:
            plane = Plane(
                id=pid,
                owner_id=uid,
                name=p_data.get("name", "Plane"),
                frontend_data=p_data,
            )
            session.add(plane)
        session.flush()  # ensure pid exists for FK
        _sync_canvas_elements(session, pid, p_data.get("elements", []))

    for old_id in set(existing_planes) - incoming_plane_ids:
        session.delete(existing_planes[old_id])

    # ------------------------------------------------------------------
    # 7. Persist the JSON blob too (backwards-compat + timestamp)
    # ------------------------------------------------------------------
    us = session.exec(select(UserState).where(UserState.owner_id == uid)).first()
    now = datetime.now(timezone.utc)
    if us:
        us.data = data
        us.updated_at = now
        flag_modified(us, "data")
        session.add(us)
    else:
        us = UserState(owner_id=uid, data=data)
        session.add(us)

    session.commit()

    logger.info("PUT /state/ user=%s — sync complete", uid)

    return UserStatePublic(data=data, updated_at=now)


# ---------------------------------------------------------------------------
# Sync helpers for child tables
# ---------------------------------------------------------------------------

def _sync_solution_components(
    session: SessionDep, solution_id: _uuid.UUID, components: list[dict],
) -> None:
    existing = {
        c.id: c
        for c in session.exec(
            select(SolutionComponent).where(SolutionComponent.solution_id == solution_id)
        ).all()
    }
    incoming_ids: set[_uuid.UUID] = set()
    for c_data in components:
        cid = _uuid_or_gen(c_data.get("id"))
        incoming_ids.add(cid)
        mat_id_str = c_data.get("materialId") or c_data.get("material_id")
        if not mat_id_str:
            # No material selected yet — skip normalised row
            continue
        try:
            mat_id = _uuid.UUID(mat_id_str)
        except (ValueError, AttributeError):
            continue
        if cid in existing:
            comp = existing[cid]
            comp.amount = _safe_float(c_data.get("amount"))
            comp.unit = c_data.get("unit", "mg")
            comp.material_id = mat_id
            session.add(comp)
        else:
            comp = SolutionComponent(
                id=cid,
                solution_id=solution_id,
                amount=_safe_float(c_data.get("amount")),
                unit=c_data.get("unit", "mg"),
                material_id=mat_id,
            )
            session.add(comp)
    for old_id in set(existing) - incoming_ids:
        session.delete(existing[old_id])


def _sync_process_steps(
    session: SessionDep, process_id: _uuid.UUID, stages: list[dict],
) -> None:
    existing = {
        s.id: s
        for s in session.exec(
            select(ProcessStep).where(ProcessStep.process_id == process_id)
        ).all()
    }
    incoming_ids: set[_uuid.UUID] = set()
    for stage in stages:
        level = int(stage.get("index", 0) or 0)
        for step_data in stage.get("alternatives", []):
            sid = _uuid_or_gen(step_data.get("id"))
            incoming_ids.add(sid)

            material_id = None
            material_id_raw = step_data.get("materialId") or step_data.get("material_id")
            if material_id_raw:
                try:
                    material_id = _uuid.UUID(material_id_raw)
                except (ValueError, AttributeError):
                    material_id = None

            solution_id = None
            solution_id_raw = step_data.get("solutionId") or step_data.get("solution_id")
            if solution_id_raw:
                try:
                    solution_id = _uuid.UUID(solution_id_raw)
                except (ValueError, AttributeError):
                    solution_id = None

            overflow_data = _extract_overflow(
                step_data,
                {
                    "id", "name", "stepCategory", "step_category", "color",
                    "materialId", "material_id", "solutionId", "solution_id",
                    "notes", "depositionMethod", "depositionStartTime", "substrateTemp",
                    "depositionAtmosphere", "depositionParameters", "solutionVolume",
                    "dryingMethod", "annealingStartTime", "annealingTime",
                    "annealingTemp", "annealingAtmosphere",
                },
            )

            param_keys = [
                "depositionMethod", "depositionStartTime", "substrateTemp",
                "depositionAtmosphere", "depositionParameters", "solutionVolume",
                "dryingMethod", "annealingStartTime", "annealingTime",
                "annealingTemp", "annealingAtmosphere",
            ]
            params = {
                k: step_data.get(k)
                for k in param_keys
                if step_data.get(k) is not None
            }

            if sid in existing:
                step = existing[sid]
                step.name = step_data.get("name") or step.name
                step.level = level
                step.step_category = step_data.get("stepCategory") or step_data.get("step_category")
                step.color = step_data.get("color")
                step.material_id = material_id
                step.solution_id = solution_id
                step.notes = step_data.get("notes")
                step.parameters = params or None
                step.overflow_data = overflow_data
                step.frontend_data = step_data
                flag_modified(step, "frontend_data")
                session.add(step)
            else:
                step = ProcessStep(
                    id=sid,
                    process_id=process_id,
                    name=step_data.get("name", "Step"),
                    level=level,
                    step_category=step_data.get("stepCategory") or step_data.get("step_category"),
                    color=step_data.get("color"),
                    material_id=material_id,
                    solution_id=solution_id,
                    notes=step_data.get("notes"),
                    parameters=params or None,
                    overflow_data=overflow_data,
                    frontend_data=step_data,
                )
                session.add(step)

    for old_id in set(existing) - incoming_ids:
        session.delete(existing[old_id])


def _sync_experiment_substrates(
    session: SessionDep, experiment_id: _uuid.UUID, substrates: list[dict],
) -> None:
    existing = {
        s.id: s
        for s in session.exec(
            select(Substrate).where(Substrate.experiment_id == experiment_id)
        ).all()
    }
    incoming_ids: set[_uuid.UUID] = set()
    for s_data in substrates:
        sid = _uuid_or_gen(s_data.get("id"))
        incoming_ids.add(sid)
        overflow_data = _extract_overflow(
            s_data,
            {"id", "name", "notes", "thicknessNm", "thickness_nm", "parameterValues"},
        )
        if sid in existing:
            sub = existing[sid]
            sub.name = s_data.get("name") or sub.name
            if "thicknessNm" in s_data or "thickness_nm" in s_data:
                sub.thickness_nm = _safe_float(
                    s_data.get("thicknessNm") or s_data.get("thickness_nm"),
                )
            sub.overflow_data = overflow_data
            session.add(sub)
        else:
            sub = Substrate(
                id=sid,
                experiment_id=experiment_id,
                name=s_data.get("name", ""),
                thickness_nm=_safe_float(
                    s_data.get("thicknessNm") or s_data.get("thickness_nm"),
                    default=0.0,
                ) if ("thicknessNm" in s_data or "thickness_nm" in s_data) else None,
                overflow_data=overflow_data,
            )
            session.add(sub)
    for old_id in set(existing) - incoming_ids:
        session.delete(existing[old_id])


def _sync_canvas_elements(
    session: SessionDep, plane_id: _uuid.UUID, elements: list[dict],
) -> None:
    existing = {
        e.id: e
        for e in session.exec(
            select(CanvasElement).where(CanvasElement.plane_id == plane_id)
        ).all()
    }
    incoming_ids: set[_uuid.UUID] = set()
    for el_data in elements:
        eid = _uuid_or_gen(el_data.get("id"))
        incoming_ids.add(eid)

        # Extract normalised columns
        etype = el_data.get("type", "text")
        pos = el_data.get("position", {})
        size = el_data.get("size", {})
        x = _safe_float(pos.get("x"))
        y = _safe_float(pos.get("y"))
        w = _safe_float(size.get("x", 100))
        h = _safe_float(size.get("y", 50))
        content = el_data.get("content") or el_data.get("name") or ""
        color = el_data.get("color")

        # For lines, store points JSON in content
        if etype == "line":
            content = json.dumps(el_data.get("points", []))

        # For collections, store refs + name as JSON in content
        if etype == "collection":
            content = json.dumps({
                "name": el_data.get("name", ""),
                "refs": el_data.get("refs", []),
            })

        if eid in existing:
            elem = existing[eid]
            elem.element_type = etype
            elem.x = x
            elem.y = y
            elem.width = w
            elem.height = h
            elem.content = content
            elem.color = color
            elem.frontend_data = el_data
            flag_modified(elem, "frontend_data")
            session.add(elem)
        else:
            elem = CanvasElement(
                id=eid,
                plane_id=plane_id,
                element_type=etype,
                x=x, y=y, width=w, height=h,
                content=content,
                color=color,
                frontend_data=el_data,
            )
            session.add(elem)

    for old_id in set(existing) - incoming_ids:
        session.delete(existing[old_id])


# ---------------------------------------------------------------------------
# GET /state/bulk — (legacy) load from normalised tables
# ---------------------------------------------------------------------------

@router.get("/bulk", response_model=BulkStateResponse)
def get_bulk_state(session: SessionDep, current_user: CurrentUser) -> Any:
    """Load all user entities in a single request (legacy format)."""
    uid = current_user.id
    return BulkStateResponse(
        materials=session.exec(select(Material).where(Material.owner_id == uid)).all(),
        solutions=session.exec(select(Solution).where(Solution.owner_id == uid)).all(),
        processes=session.exec(select(Process).where(Process.owner_id == uid)).all(),
        experiments=session.exec(select(Experiment).where(Experiment.owner_id == uid)).all(),
        results=session.exec(select(ExperimentResults).where(ExperimentResults.owner_id == uid)).all(),
        planes=session.exec(select(Plane).where(Plane.owner_id == uid)).all(),
    )
