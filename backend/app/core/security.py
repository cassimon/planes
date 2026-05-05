from datetime import datetime, timedelta, timezone
from typing import Any

import jwt
from jwt import PyJWKClient
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

# Module-level JWKS client — PyJWKClient handles key caching and rotation internally.
# Instantiated lazily on first use so it doesn't fire on import (before settings load).
_jwks_client: PyJWKClient | None = None


def _get_jwks_client() -> PyJWKClient:
    global _jwks_client
    if _jwks_client is None:
        _jwks_client = PyJWKClient(
            f"{settings.NOMAD_KEYCLOAK_REALM_URL}/protocol/openid-connect/certs",
            cache_keys=True,
        )
    return _jwks_client


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


def verify_nomad_token(token: str) -> dict[str, Any]:
    """
    Verify a Keycloak RS256 JWT against the central NOMAD JWKS endpoint and
    return the decoded claims.  Raises HTTP 401 on any verification failure.
    """
    if not settings.NOMAD_OAUTH_ENABLED:
        raise HTTPException(
            status_code=400,
            detail="NOMAD OAuth is not enabled",
        )

    issuer = settings.NOMAD_KEYCLOAK_REALM_URL
    try:
        jwks_client = _get_jwks_client()
        signing_key = jwks_client.get_signing_key_from_jwt(token)
        claims = jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256"],
            issuer=issuer,
            # nomad_public tokens carry no restricted audience claim
            options={"verify_aud": False},
        )
        return claims
    except jwt.InvalidTokenError as e:
        raise HTTPException(
            status_code=401,
            detail=f"Invalid NOMAD token: {str(e)}",
        )
    except Exception as e:
        raise HTTPException(
            status_code=401,
            detail=f"Token verification failed: {str(e)}",
        )
