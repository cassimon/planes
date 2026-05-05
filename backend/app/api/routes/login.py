from datetime import timedelta
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel
import httpx

from app import crud
from app.api.deps import CurrentUser, SessionDep, get_current_active_superuser
from app.core import security
from app.core.config import settings
from app.models import Message, NewPassword, Token, UserPublic, UserUpdate
from app.utils import (
    generate_password_reset_token,
    generate_reset_password_email,
    send_email,
    verify_password_reset_token,
)

router = APIRouter(tags=["login"])


@router.post("/login/access-token")
def login_access_token(
    session: SessionDep, form_data: Annotated[OAuth2PasswordRequestForm, Depends()]
) -> Token:
    """
    OAuth2 compatible token login, get an access token for future requests
    """
    user = crud.authenticate(
        session=session, email=form_data.username, password=form_data.password
    )
    if not user:
        raise HTTPException(status_code=400, detail="Incorrect email or password")
    elif not user.is_active:
        raise HTTPException(status_code=400, detail="Inactive user")
    access_token_expires = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    return Token(
        access_token=security.create_access_token(
            user.id, expires_delta=access_token_expires
        )
    )


@router.post("/login/test-token", response_model=UserPublic)
def test_token(current_user: CurrentUser) -> Any:
    """
    Test access token
    """
    return current_user


@router.post("/password-recovery/{email}")
def recover_password(email: str, session: SessionDep) -> Message:
    """
    Password Recovery
    """
    user = crud.get_user_by_email(session=session, email=email)

    # Always return the same response to prevent email enumeration attacks
    # Only send email if user actually exists
    if user:
        password_reset_token = generate_password_reset_token(email=email)
        email_data = generate_reset_password_email(
            email_to=user.email, email=email, token=password_reset_token
        )
        send_email(
            email_to=user.email,
            subject=email_data.subject,
            html_content=email_data.html_content,
        )
    return Message(
        message="If that email is registered, we sent a password recovery link"
    )


@router.post("/reset-password/")
def reset_password(session: SessionDep, body: NewPassword) -> Message:
    """
    Reset password
    """
    email = verify_password_reset_token(token=body.token)
    if not email:
        raise HTTPException(status_code=400, detail="Invalid token")
    user = crud.get_user_by_email(session=session, email=email)
    if not user:
        # Don't reveal that the user doesn't exist - use same error as invalid token
        raise HTTPException(status_code=400, detail="Invalid token")
    elif not user.is_active:
        raise HTTPException(status_code=400, detail="Inactive user")
    user_in_update = UserUpdate(password=body.new_password)
    crud.update_user(
        session=session,
        db_user=user,
        user_in=user_in_update,
    )
    return Message(message="Password updated successfully")


@router.post(
    "/password-recovery-html-content/{email}",
    dependencies=[Depends(get_current_active_superuser)],
    response_class=HTMLResponse,
)
def recover_password_html_content(email: str, session: SessionDep) -> Any:
    """
    HTML Content for Password Recovery
    """
    user = crud.get_user_by_email(session=session, email=email)

    if not user:
        raise HTTPException(
            status_code=404,
            detail="The user with this username does not exist in the system.",
        )
    password_reset_token = generate_password_reset_token(email=email)
    email_data = generate_reset_password_email(
        email_to=user.email, email=email, token=password_reset_token
    )

    return HTMLResponse(
        content=email_data.html_content, headers={"subject:": email_data.subject}
    )


class NomadAuthorizeParams(BaseModel):
    realm_url: str
    client_id: str
    redirect_uri: str


class NomadExchangeRequest(BaseModel):
    code: str
    code_verifier: str
    redirect_uri: str


@router.get("/login/nomad/authorize")
def nomad_oauth_authorize() -> NomadAuthorizeParams:
    """
    Return the Keycloak realm URL, client_id and redirect_uri so the frontend
    can build a proper Authorization Code + PKCE request.  The frontend is
    responsible for generating state, nonce and the code_verifier/challenge.
    """
    if not settings.NOMAD_OAUTH_ENABLED:
        raise HTTPException(
            status_code=400,
            detail="NOMAD OAuth is not enabled"
        )

    return NomadAuthorizeParams(
        realm_url=settings.NOMAD_KEYCLOAK_REALM_URL,
        client_id=settings.NOMAD_OAUTH_CLIENT_ID,
        redirect_uri=f"{settings.FRONTEND_HOST}/auth/nomad/callback",
    )


@router.post("/login/nomad/exchange")
def nomad_oauth_exchange(body: NomadExchangeRequest) -> Token:
    """
    Exchange a Keycloak authorization code (+ PKCE code_verifier) for an
    access token.  Plains re-uses the Keycloak access token as its own bearer
    token so that the NOMAD upload service can forward it when needed.
    """
    if not settings.NOMAD_OAUTH_ENABLED:
        raise HTTPException(
            status_code=400,
            detail="NOMAD OAuth is not enabled"
        )

    # Exchange code at Keycloak token endpoint
    try:
        resp = httpx.post(
            f"{settings.NOMAD_KEYCLOAK_REALM_URL}/protocol/openid-connect/token",
            data={
                "grant_type": "authorization_code",
                "code": body.code,
                "code_verifier": body.code_verifier,
                "redirect_uri": body.redirect_uri,
                "client_id": settings.NOMAD_OAUTH_CLIENT_ID,
            },
            timeout=15.0,
        )
        resp.raise_for_status()
    except httpx.HTTPStatusError as e:
        raise HTTPException(
            status_code=401,
            detail=f"Keycloak token exchange failed: {e.response.text}"
        )
    except Exception as e:
        raise HTTPException(
            status_code=503,
            detail=f"Could not reach Keycloak: {str(e)}"
        )

    token_data = resp.json()
    access_token = token_data.get("access_token")
    if not access_token:
        raise HTTPException(
            status_code=401,
            detail="No access_token in Keycloak response"
        )

    # Validate the token locally via JWKS — ensures it wasn't tampered with
    security.verify_nomad_token(access_token)

    return Token(access_token=access_token)
