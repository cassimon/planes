from typing import Any

from fastapi import APIRouter
from sqlmodel import select

from app.api.deps import CurrentUser, SessionDep
from app.models import UserState, UserStatePublic

router = APIRouter(prefix="/state", tags=["state"])


@router.get("/", response_model=UserStatePublic)
def read_state(session: SessionDep, current_user: CurrentUser) -> Any:
    """Get the current user's full application state."""
    statement = select(UserState).where(UserState.owner_id == current_user.id)
    state = session.exec(statement).first()
    if not state:
        return UserStatePublic(data={}, updated_at=None)
    return state


@router.put("/", response_model=UserStatePublic)
def update_state(
    session: SessionDep, current_user: CurrentUser, *, body: UserStatePublic
) -> Any:
    """Save the current user's full application state."""
    statement = select(UserState).where(UserState.owner_id == current_user.id)
    state = session.exec(statement).first()
    if state:
        state.data = body.data
        state.sqlmodel_update({"data": body.data})
        session.add(state)
    else:
        state = UserState(owner_id=current_user.id, data=body.data)
        session.add(state)
    session.commit()
    session.refresh(state)
    return state
