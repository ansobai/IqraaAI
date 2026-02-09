from __future__ import annotations

from functools import lru_cache
from typing import Optional

import jwt
from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt import PyJWKClient

bearer_scheme = HTTPBearer(auto_error=False)


def _jwks_url(issuer: str) -> str:
    return issuer.rstrip("/") + "/.well-known/jwks.json"


@lru_cache(maxsize=8)
def _jwks_client(jwks_url: str) -> PyJWKClient:
    return PyJWKClient(jwks_url)


async def get_current_user_id(
    request: Request,
    creds: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
) -> str:
    if creds is None or creds.scheme.lower() != "bearer" or not creds.credentials:
        raise HTTPException(status_code=401, detail="Missing bearer token")

    settings = getattr(request.app.state, "settings", None)
    if settings is None:
        raise HTTPException(status_code=500, detail="Server misconfigured")

    token = creds.credentials
    jwks_url = _jwks_url(settings.clerk_issuer)

    try:
        signing_key = _jwks_client(jwks_url).get_signing_key_from_jwt(token).key
        decoded = jwt.decode(
            token,
            signing_key,
            algorithms=["RS256"],
            issuer=settings.clerk_issuer,
            audience=settings.clerk_audience if settings.clerk_audience else None,
            options={"verify_aud": bool(settings.clerk_audience)},
        )
    except Exception as exc:
        raise HTTPException(status_code=401, detail="Invalid token") from exc

    sub = decoded.get("sub")
    if not isinstance(sub, str) or not sub:
        raise HTTPException(status_code=401, detail="Invalid token")
    return sub
