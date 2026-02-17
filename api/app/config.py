from __future__ import annotations

import os
from dataclasses import dataclass
from typing import List, Optional


@dataclass(frozen=True)
class Settings:
    database_url: str
    clerk_issuer: str
    clerk_audience: Optional[str]
    cors_origins: List[str]
    port: int


def _parse_cors_origins(raw: Optional[str]) -> List[str]:
    if not raw:
        return ["*"]
    origins = [o.strip() for o in raw.split(",") if o.strip()]
    return origins or ["*"]


def load_settings_from_env() -> Settings:
    database_url = os.getenv("DATABASE_URL") or ""
    clerk_issuer = os.getenv("CLERK_ISSUER") or ""

    missing: List[str] = []
    if not database_url:
        missing.append("DATABASE_URL")
    if not clerk_issuer:
        missing.append("CLERK_ISSUER")
    if missing:
        raise RuntimeError(
            "Missing required env vars: "
            + ", ".join(missing)
            + ". Copy api/.env.example to api/.env and fill in values.",
        )

    port_raw = os.getenv("PORT") or "8000"
    try:
        port = int(port_raw)
    except ValueError as exc:
        raise RuntimeError(f"Invalid PORT value: {port_raw}") from exc

    return Settings(
        database_url=database_url,
        clerk_issuer=clerk_issuer.rstrip("/"),
        clerk_audience=os.getenv("CLERK_AUDIENCE") or None,
        cors_origins=_parse_cors_origins(os.getenv("CORS_ORIGINS")),
        port=port,
    )
