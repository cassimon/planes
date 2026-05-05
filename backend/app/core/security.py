from datetime import datetime, timedelta, timezone
from typing import Any
from functools import lru_cache

import jwt
import httpx
from fastapi import HTTPException
from pwdlib import PasswordHash
from pwdlib.hashers.argon2 import Argon2Hasher
from pwdlib.hashers.bcrypt import BcryptHasher

from app.core.config import settings

password_hash = PasswordHash(
    (
        Argon2Hasher(),
        BcryptHasher(),
    )
)


ALGORITHM = "HS256"


def create_access_token(subject: str | Any, expires_delta: timedelta) -> str:
    expire = datetime.now(timezone.utc) + expires_delta
    to_encode = {"exp": expire, "sub": str(subject)}
    encoded_jwt = jwt.encode(to_encode, settings.SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt


def verify_password(
    plain_password: str, hashed_password: str
) -> tuple[bool, str | None]:
    return password_hash.verify_and_update(plain_password, hashed_password)


def get_password_hash(password: str) -> str:
    return password_hash.hash(password)


@lru_cache(maxsize=1)
def get_nomad_jwks() -> dict[str, Any]:
    """Fetch Keycloak JWKS for token verification. Cached to avoid repeated fetches."""
    if not settings.NOMAD_OAUTH_ENABLED:
        return {}
    
    jwks_url = f"{settings.NOMAD_KEYCLOAK_REALM_URL}/protocol/openid-connect/certs"
    try:
        response = httpx.get(jwks_url, timeout=10.0)
        response.raise_for_status()
        return response.json()
    except Exception as e:
        raise HTTPException(
            status_code=503,
            detail=f"Failed to fetch NOMAD JWKS: {str(e)}"
        )


def verify_nomad_token(token: str) -> dict[str, Any]:
    """Verify a Keycloak JWT and return its claims."""
    if not settings.NOMAD_OAUTH_ENABLED:
        raise HTTPException(
            status_code=400,
            detail="NOMAD OAuth is not enabled"
        )
    
    jwks = get_nomad_jwks()
    issuer = settings.NOMAD_KEYCLOAK_REALM_URL
    
    try:
        # PyJWT with JWKS support
        from jwt import PyJWKClient
        
        jwks_client = PyJWKClient(
            f"{issuer}/protocol/openid-connect/certs",
            cache_keys=True
        )
        signing_key = jwks_client.get_signing_key_from_jwt(token)
        
        claims = jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256"],
            issuer=issuer,
            options={"verify_aud": False}  # Oasis doesn't restrict audience
        )
        return claims
    except jwt.InvalidTokenError as e:
        raise HTTPException(
            status_code=401,
            detail=f"Invalid NOMAD token: {str(e)}"
        )
    except Exception as e:
        raise HTTPException(
            status_code=401,
            detail=f"Token verification failed: {str(e)}"
        )
