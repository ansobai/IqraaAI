from __future__ import annotations

import asyncpg
from fastapi import Request


def get_pool(request: Request) -> asyncpg.Pool:
    pool = getattr(request.app.state, "db_pool", None)
    if pool is None:
        raise RuntimeError("Database pool not initialized")
    return pool
