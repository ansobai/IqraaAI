from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

import asyncpg
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import Settings, load_settings_from_env
from .routes.profile import router as profile_router


def create_app(settings: Optional[Settings] = None) -> FastAPI:
    dotenv_path = Path(__file__).resolve().parents[1] / ".env"
    load_dotenv(dotenv_path=dotenv_path)
    resolved_settings = settings or load_settings_from_env()
    allow_credentials = "*" not in resolved_settings.cors_origins

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.settings = resolved_settings

        app.state.db_pool = await asyncpg.create_pool(resolved_settings.database_url)
        try:
            yield
        finally:
            await app.state.db_pool.close()

    app = FastAPI(lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=resolved_settings.cors_origins,
        allow_credentials=allow_credentials,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/healthz")
    async def healthz():
        return {"ok": True}

    app.include_router(profile_router, prefix="/v1")
    return app


app = create_app()
