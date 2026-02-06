from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

import asyncpg
from dotenv import load_dotenv


async def _apply_schema(database_url: str, schema_sql: str) -> None:
    conn = await asyncpg.connect(database_url)
    try:
        await conn.execute(schema_sql)
    finally:
        await conn.close()


def main() -> int:
    dotenv_path = Path(__file__).resolve().parents[1] / ".env"
    load_dotenv(dotenv_path=dotenv_path)

    database_url = os.getenv("DATABASE_URL")
    if not database_url:
        print(
            "Missing DATABASE_URL. Copy api/.env.example to api/.env and set DATABASE_URL.",
            file=sys.stderr,
        )
        return 1

    repo_root = Path(__file__).resolve().parents[2]
    schema_path = repo_root / "db" / "schema.sql"
    if not schema_path.exists():
        print(f"Schema file not found: {schema_path}", file=sys.stderr)
        return 1

    schema_sql = schema_path.read_text(encoding="utf-8")
    asyncio.run(_apply_schema(database_url, schema_sql))
    print("Schema applied successfully.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
