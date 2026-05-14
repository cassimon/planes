from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.core.config import settings

router = APIRouter(tags=["login"])


class AuthConfig(BaseModel):
    keycloak_url: str
    keycloak_realm: str
    keycloak_client_id: str


@router.get("/auth/config")
def auth_config() -> AuthConfig:
    """
    Return Keycloak configuration so the frontend can initialise keycloak-js.

    The response contains:
    - ``keycloak_url``: the Keycloak server base URL (before ``/realms/``)
    - ``keycloak_realm``: the realm name
    - ``keycloak_client_id``: the OAuth2 client id (public PKCE client)

    This endpoint is intentionally unauthenticated so the login page can
    fetch it before any token is available.
    """
    if not settings.NOMAD_OAUTH_ENABLED:
        raise HTTPException(
            status_code=400,
            detail="NOMAD OAuth is not enabled",
        )

    # NOMAD_KEYCLOAK_REALM_URL format:
    #   https://nomad-lab.eu/fairdi/keycloak/auth/realms/fairdi_nomad_prod
    parts = settings.NOMAD_KEYCLOAK_REALM_URL.rsplit("/realms/", 1)
    keycloak_url = parts[0]
    keycloak_realm = parts[1] if len(parts) > 1 else ""

    return AuthConfig(
        keycloak_url=keycloak_url,
        keycloak_realm=keycloak_realm,
        keycloak_client_id=settings.NOMAD_OAUTH_CLIENT_ID,
    )
