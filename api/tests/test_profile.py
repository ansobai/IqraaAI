import asyncio
import os
from pathlib import Path

import asyncpg
import pytest
from fastapi.testclient import TestClient

from api.app.auth import get_current_user_id
from api.app.config import Settings
from api.app.main import create_app


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


@pytest.fixture(scope="session")
def test_database_url() -> str:
    url = os.getenv("TEST_DATABASE_URL")
    if not url:
        pytest.skip("TEST_DATABASE_URL not set")
    return url


@pytest.fixture(scope="session", autouse=True)
def apply_schema(test_database_url: str):
    schema_path = _repo_root() / "db" / "schema.sql"
    schema_sql = schema_path.read_text(encoding="utf-8")

    async def run():
        conn = await asyncpg.connect(test_database_url)
        try:
            await conn.execute(schema_sql)
        finally:
            await conn.close()

    asyncio.run(run())


@pytest.fixture(autouse=True)
def truncate_profiles(test_database_url: str):
    async def run():
        conn = await asyncpg.connect(test_database_url)
        try:
            await conn.execute("truncate table public.profiles")
        finally:
            await conn.close()

    asyncio.run(run())


def _test_settings(database_url: str) -> Settings:
    return Settings(
        database_url=database_url,
        clerk_issuer="https://example.test",
        clerk_audience=None,
        cors_origins=["*"],
        port=8000,
    )


def test_missing_authorization_returns_401(test_database_url: str):
    app = create_app(_test_settings(test_database_url))
    with TestClient(app) as client:
        response = client.get("/v1/profile")
    assert response.status_code == 401


def test_invalid_token_returns_401(test_database_url: str):
    app = create_app(_test_settings(test_database_url))
    with TestClient(app) as client:
        response = client.get("/v1/profile", headers={"Authorization": "Bearer invalid"})
    assert response.status_code == 401


def test_get_profile_404_when_missing(test_database_url: str):
    app = create_app(_test_settings(test_database_url))
    app.dependency_overrides[get_current_user_id] = lambda: "user_test"
    with TestClient(app) as client:
        response = client.get("/v1/profile")
    assert response.status_code == 404


def test_post_profile_creates_then_idempotent(test_database_url: str):
    app = create_app(_test_settings(test_database_url))
    app.dependency_overrides[get_current_user_id] = lambda: "user_test"
    with TestClient(app) as client:
        create_1 = client.post(
            "/v1/profile",
            json={"email": "a@example.com", "first_name": "A", "last_name": "B"},
        )
        assert create_1.status_code == 201
        body_1 = create_1.json()
        assert body_1["clerk_user_id"] == "user_test"
        assert body_1["email"] == "a@example.com"
        assert body_1["first_name"] == "A"
        assert body_1["last_name"] == "B"

        create_2 = client.post(
            "/v1/profile",
            json={"email": "a@example.com", "first_name": "A", "last_name": "B"},
        )
        assert create_2.status_code == 200


def test_patch_profile_updates_fields(test_database_url: str):
    app = create_app(_test_settings(test_database_url))
    app.dependency_overrides[get_current_user_id] = lambda: "user_test"
    with TestClient(app) as client:
        client.post(
            "/v1/profile",
            json={"email": "a@example.com", "first_name": "A", "last_name": "B"},
        )
        updated = client.patch(
            "/v1/profile",
            json={"first_name": "AA", "last_name": None, "phone_number": "+15551234567"},
        )
        assert updated.status_code == 200
        body = updated.json()
        assert body["first_name"] == "AA"
        assert body["last_name"] is None
        assert body["phone_number"] == "+15551234567"

