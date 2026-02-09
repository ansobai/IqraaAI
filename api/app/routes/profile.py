from __future__ import annotations

from typing import Any, Dict

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status

from ..auth import get_current_user_id
from ..db import get_pool
from ..schemas import Profile, ProfileCreate, ProfileUpdate

router = APIRouter()


@router.get("/profile", response_model=Profile)
async def get_profile(
    request: Request,
    clerk_user_id: str = Depends(get_current_user_id),
) -> Dict[str, Any]:
    pool = get_pool(request)
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            "select * from public.profiles where clerk_user_id=$1",
            clerk_user_id,
        )

    if row is None:
        raise HTTPException(status_code=404, detail="Profile not found")
    return dict(row)


@router.post("/profile", response_model=Profile, status_code=status.HTTP_201_CREATED)
async def create_profile_if_missing(
    body: ProfileCreate,
    request: Request,
    response: Response,
    clerk_user_id: str = Depends(get_current_user_id),
) -> Dict[str, Any]:
    pool = get_pool(request)
    async with pool.acquire() as conn:
        created = await conn.fetchrow(
            """
            insert into public.profiles (clerk_user_id, email, first_name, last_name)
            values ($1, $2, $3, $4)
            on conflict (clerk_user_id) do nothing
            returning *
            """,
            clerk_user_id,
            body.email,
            body.first_name,
            body.last_name,
        )

        if created is not None:
            response.status_code = status.HTTP_201_CREATED
            return dict(created)

        existing = await conn.fetchrow(
            "select * from public.profiles where clerk_user_id=$1",
            clerk_user_id,
        )

    if existing is None:
        raise HTTPException(status_code=500, detail="Failed to create profile")

    response.status_code = status.HTTP_200_OK
    return dict(existing)


@router.patch("/profile", response_model=Profile)
async def update_profile(
    body: ProfileUpdate,
    request: Request,
    clerk_user_id: str = Depends(get_current_user_id),
) -> Dict[str, Any]:
    pool = get_pool(request)
    async with pool.acquire() as conn:
        row = await conn.fetchrow(
            """
            update public.profiles
            set first_name=$2, last_name=$3, phone_number=$4
            where clerk_user_id=$1
            returning *
            """,
            clerk_user_id,
            body.first_name,
            body.last_name,
            body.phone_number,
        )

    if row is None:
        raise HTTPException(status_code=404, detail="Profile not found")
    return dict(row)
