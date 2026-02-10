from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class Profile(BaseModel):
    clerk_user_id: str
    email: str
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    phone_number: Optional[str] = None
    avatar_url: Optional[str] = None
    created_at: datetime
    updated_at: datetime


class ProfileCreate(BaseModel):
    email: str
    first_name: Optional[str] = None
    last_name: Optional[str] = None


class ProfileUpdate(BaseModel):
    first_name: Optional[str]
    last_name: Optional[str]
    phone_number: Optional[str]
