from datetime import datetime
from typing import Dict, List, Optional

from pydantic import BaseModel, ConfigDict, Field


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
    model_config = ConfigDict(from_attributes=True)

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

class TodoTypeCreate(BaseModel):
    name: str = Field(min_length=1, max_length=60)


class TodoTypeResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    created_at: datetime

class TaskAnalysisRequest(BaseModel):
    text: str = Field(min_length=1, max_length=10000)
    answers: Dict[str, str] = Field(default_factory=dict)


class TaskSuggestion(BaseModel):
    title: str
    description: str
    todo_type: str
    start_date: Optional[str] = None
    expected_duration_days: int = 0
    expected_duration_hours: int = 0
    parent_name: Optional[str] = None
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


class TaskCommandResponse(BaseModel):
    handled: bool
    message: Optional[str] = None
    todo: Optional[TodoResponse] = None
    source: str
