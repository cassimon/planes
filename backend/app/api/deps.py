from collections.abc import Generator
from typing import Annotated

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jwt.exceptions import InvalidTokenError
from pydantic import ValidationError
from sqlmodel import Session, select

from app.core import security
from app.core.config import settings
from app.core.db import engine
from app.models import TokenPayload, User
from app import crud
import logging


reusable_oauth2 = OAuth2PasswordBearer(
    tokenUrl=f"{settings.API_V1_STR}/login/access-token"
)


def get_db() -> Generator[Session, None, None]:
    with Session(engine) as session:
        yield session


SessionDep = Annotated[Session, Depends(get_db)]
TokenDep = Annotated[str, Depends(reusable_oauth2)]
logger = logging.getLogger(__name__)

def get_current_user(session: SessionDep, token: TokenDep) -> User:
    logger.info(f"Attempting to decode token")
    
    # First, try NOMAD OAuth token verification if enabled
    if settings.NOMAD_OAUTH_ENABLED:
        try:
            claims = security.verify_nomad_token(token)
            nomad_sub = claims.get("sub")
            
            if nomad_sub:
                # Find or create user based on nomad_sub
                user = session.exec(
                    select(User).where(User.nomad_sub == nomad_sub)
                ).first()
                
                if not user:
                    # Auto-create user on first NOMAD OAuth login
                    user = User(
                        email=claims.get("email"),
                        full_name=claims.get("name"),
                        nomad_sub=nomad_sub,
                        is_active=True,
                        is_superuser=False,
                    )
                    session.add(user)
                    session.commit()
                    session.refresh(user)
                    logger.info(f"Created new user from NOMAD OAuth: {user.email}")
                
                if not user.is_active:
                    raise HTTPException(status_code=400, detail="Inactive user")
                
                return user
        except HTTPException as e:
            # If NOMAD verification fails with 401, try local auth
            if e.status_code != 401:
                raise
            logger.debug("NOMAD token verification failed, trying local auth")
    
    # Fall back to local JWT authentication
    try:
        payload = jwt.decode(
            token, settings.SECRET_KEY, algorithms=[security.ALGORITHM]
        )
        token_data = TokenPayload(**payload)
    except (InvalidTokenError, ValidationError):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Could not validate credentials",
        )
    
    user = session.get(User, token_data.sub)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if not user.is_active:
        raise HTTPException(status_code=400, detail="Inactive user")
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


def get_current_active_superuser(current_user: CurrentUser) -> User:
    if not current_user.is_superuser:
        raise HTTPException(
            status_code=403, detail="The user doesn't have enough privileges"
        )
    return current_user
