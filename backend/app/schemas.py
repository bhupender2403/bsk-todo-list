from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field


class TodoCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=5000)
    todo_type: str = Field(default="General", min_length=1, max_length=60)
    parent_id: Optional[int] = None
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None
    expected_duration_minutes: Optional[int] = Field(default=None, ge=0)
    dependency_ids: List[int] = Field(default_factory=list)
    is_running: bool = False


class TodoUpdate(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=200)
    description: Optional[str] = Field(default=None, max_length=5000)
    todo_type: Optional[str] = Field(default=None, min_length=1, max_length=60)
    completed: Optional[bool] = None
    parent_id: Optional[int] = None
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None
    expected_duration_minutes: Optional[int] = Field(default=None, ge=0)
    dependency_ids: Optional[List[int]] = None
    is_running: Optional[bool] = None


class TodoResponse(BaseModel):
    id: int
    title: str
    description: str
    todo_type: str
    completed: bool
    parent_id: Optional[int]
    start_time: Optional[datetime]
    end_time: Optional[datetime]
    expected_duration_minutes: Optional[int]
    dependency_ids: List[int]
    is_running: bool
    created_at: datetime
    updated_at: datetime

    class Config:
        orm_mode = True


class TodoTypeCreate(BaseModel):
    name: str = Field(min_length=1, max_length=60)


class TodoTypeResponse(BaseModel):
    id: int
    name: str
    created_at: datetime

    class Config:
        orm_mode = True
