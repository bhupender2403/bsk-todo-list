from datetime import date, datetime
from typing import Dict, List, Optional

from pydantic import BaseModel, ConfigDict, Field


class TodoItemInput(BaseModel):
    id: Optional[int] = None
    name: str = Field(min_length=1, max_length=200)
    estimated_duration_minutes: int = Field(default=0, ge=0)


class TodoItemResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    task_id: int
    name: str
    estimated_duration_minutes: int
    created_at: datetime


class TodoCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=5000)
    sprint_id: Optional[int] = None
    aim_id: Optional[int] = None
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None
    expected_duration_minutes: Optional[int] = Field(default=None, ge=0)
    dependency_ids: List[int] = Field(default_factory=list)
    is_running: bool = False
    todo_items: List[TodoItemInput] = Field(default_factory=list)


class TodoUpdate(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=200)
    description: Optional[str] = Field(default=None, max_length=5000)
    completed: Optional[bool] = None
    sprint_id: Optional[int] = None
    aim_id: Optional[int] = None
    start_time: Optional[datetime] = None
    end_time: Optional[datetime] = None
    expected_duration_minutes: Optional[int] = Field(default=None, ge=0)
    dependency_ids: Optional[List[int]] = None
    is_running: Optional[bool] = None
    todo_items: Optional[List[TodoItemInput]] = None


class TodoResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    description: str
    completed: bool
    sprint_id: Optional[int]
    aim_id: Optional[int]
    start_time: Optional[datetime]
    end_time: Optional[datetime]
    expected_duration_minutes: Optional[int]
    dependency_ids: List[int]
    is_running: bool
    created_at: datetime
    updated_at: datetime
    todo_items: List[TodoItemResponse]

class TaskAnalysisRequest(BaseModel):
    text: str = Field(min_length=1, max_length=10000)
    answers: Dict[str, str] = Field(default_factory=dict)
    loaded_task_id: Optional[int] = None
    loaded_aim_id: Optional[int] = None


class TaskSuggestion(BaseModel):
    title: str
    description: str
    start_date: Optional[str] = None
    expected_duration_days: int = 0
    expected_duration_hours: int = 0
    dependency_names: List[str] = Field(default_factory=list)


class TaskAnalysisResponse(BaseModel):
    suggestion: TaskSuggestion
    clarification_questions: List[str]
    ai_powered: bool
    analysis_source: str


class TaskAnalysisConfigResponse(BaseModel):
    openai_configured: bool
    model: Optional[str] = None


class TaskCommandRequest(BaseModel):
    text: str = Field(min_length=1, max_length=1000)
    loaded_task_id: Optional[int] = None
    loaded_aim_id: Optional[int] = None


class TaskCommandResponse(BaseModel):
    handled: bool
    message: Optional[str] = None
    todo: Optional[TodoResponse] = None
    source: str


class SprintCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    end_date: date


class SprintResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    end_date: date
    created_at: datetime


class AimCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=5000)


class AimUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str = Field(default="", max_length=5000)


class AimResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    description: str
    created_at: datetime
