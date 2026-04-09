import uuid
from typing import Any

from fastapi import APIRouter, HTTPException
from sqlmodel import col, func, select

from app.api.deps import CurrentUser, SessionDep
from app.crud import create_plane, update_plane
from app.models import Plane, PlaneCreate, PlanePublic, PlanesPublic, PlaneUpdate, CanvasElement, CanvasElementCreate, CanvasElementPublic, CanvasElementUpdate

router = APIRouter(prefix="/planes", tags=["planes"])


@router.get("/", response_model=PlanesPublic)
def read_planes(
    session: SessionDep, current_user: CurrentUser, skip: int = 0, limit: int = 100
) -> Any:
    """Retrieve planes."""
    if current_user.is_superuser:
        count_statement = select(func.count()).select_from(Plane)
        count = session.exec(count_statement).one()
        statement = (
            select(Plane).order_by(col(Plane.created_at).desc()).offset(skip).limit(limit)
        )
        items = session.exec(statement).all()
    else:
        count_statement = (
            select(func.count())
            .select_from(Plane)
            .where(Plane.owner_id == current_user.id)
        )
        count = session.exec(count_statement).one()
        statement = (
            select(Plane)
            .where(Plane.owner_id == current_user.id)
            .order_by(col(Plane.created_at).desc())
            .offset(skip)
            .limit(limit)
        )
        items = session.exec(statement).all()
    return PlanesPublic(data=items, count=count)


@router.get("/{id}", response_model=PlanePublic)
def read_plane(session: SessionDep, current_user: CurrentUser, id: uuid.UUID) -> Any:
    """Get plane by ID."""
    plane = session.get(Plane, id)
    if not plane:
        raise HTTPException(status_code=404, detail="Plane not found")
    if not current_user.is_superuser and (plane.owner_id != current_user.id):
        raise HTTPException(status_code=403, detail="Not enough permissions")
    return plane


@router.post("/", response_model=PlanePublic)
def create_item(
    *, session: SessionDep, current_user: CurrentUser, plane_in: PlaneCreate
) -> Any:
    """Create new plane."""
    plane = create_plane(session=session, plane_in=plane_in, owner_id=current_user.id)
    return plane


@router.put("/{id}", response_model=PlanePublic)
def update_item(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    id: uuid.UUID,
    plane_in: PlaneUpdate,
) -> Any:
    """Update plane."""
    plane = session.get(Plane, id)
    if not plane:
        raise HTTPException(status_code=404, detail="Plane not found")
    if not current_user.is_superuser and (plane.owner_id != current_user.id):
        raise HTTPException(status_code=403, detail="Not enough permissions")
    plane = update_plane(session=session, db_plane=plane, plane_in=plane_in)
    return plane


@router.delete("/{id}")
def delete_plane(
    session: SessionDep, current_user: CurrentUser, id: uuid.UUID
) -> Any:
    """Delete plane."""
    plane = session.get(Plane, id)
    if not plane:
        raise HTTPException(status_code=404, detail="Plane not found")
    if not current_user.is_superuser and (plane.owner_id != current_user.id):
        raise HTTPException(status_code=403, detail="Not enough permissions")
    session.delete(plane)
    session.commit()
    return {"ok": True}


@router.get("/{plane_id}/elements", response_model=list[CanvasElementPublic])
def read_plane_elements(
    session: SessionDep, current_user: CurrentUser, plane_id: uuid.UUID
) -> Any:
    """Get all elements in a plane."""
    plane = session.get(Plane, plane_id)
    if not plane:
        raise HTTPException(status_code=404, detail="Plane not found")
    if not current_user.is_superuser and (plane.owner_id != current_user.id):
        raise HTTPException(status_code=403, detail="Not enough permissions")
    return plane.elements


@router.post("/{plane_id}/elements", response_model=CanvasElementPublic)
def create_element(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    plane_id: uuid.UUID,
    element_in: CanvasElementCreate,
) -> Any:
    """Create new canvas element."""
    plane = session.get(Plane, plane_id)
    if not plane:
        raise HTTPException(status_code=404, detail="Plane not found")
    if not current_user.is_superuser and (plane.owner_id != current_user.id):
        raise HTTPException(status_code=403, detail="Not enough permissions")
    element = CanvasElement.model_validate(element_in, update={"plane_id": plane_id})
    session.add(element)
    session.commit()
    session.refresh(element)
    return element


@router.put("/{plane_id}/elements/{element_id}", response_model=CanvasElementPublic)
def update_element(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    plane_id: uuid.UUID,
    element_id: uuid.UUID,
    element_in: CanvasElementUpdate,
) -> Any:
    """Update canvas element."""
    plane = session.get(Plane, plane_id)
    if not plane:
        raise HTTPException(status_code=404, detail="Plane not found")
    if not current_user.is_superuser and (plane.owner_id != current_user.id):
        raise HTTPException(status_code=403, detail="Not enough permissions")
    element = session.get(CanvasElement, element_id)
    if not element or element.plane_id != plane_id:
        raise HTTPException(status_code=404, detail="Element not found")
    element_data = element_in.model_dump(exclude_unset=True)
    element.sqlmodel_update(element_data)
    session.add(element)
    session.commit()
    session.refresh(element)
    return element


@router.delete("/{plane_id}/elements/{element_id}")
def delete_element(
    session: SessionDep, current_user: CurrentUser, plane_id: uuid.UUID, element_id: uuid.UUID
) -> Any:
    """Delete canvas element."""
    plane = session.get(Plane, plane_id)
    if not plane:
        raise HTTPException(status_code=404, detail="Plane not found")
    if not current_user.is_superuser and (plane.owner_id != current_user.id):
        raise HTTPException(status_code=403, detail="Not enough permissions")
    element = session.get(CanvasElement, element_id)
    if not element or element.plane_id != plane_id:
        raise HTTPException(status_code=404, detail="Element not found")
    session.delete(element)
    session.commit()
    return {"ok": True}
