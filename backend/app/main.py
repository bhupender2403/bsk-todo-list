from contextlib import asynccontextmanager
import os
from datetime import date
from typing import Dict, List

from fastapi import Depends, FastAPI, HTTPException, Response, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import inspect, select, text
from sqlalchemy.orm import Session

from .database import Base, WORKSPACE, engine, get_db
from .models import Aim, Sprint, Todo, TodoItem
from .schemas import (
    TaskAnalysisRequest,
    TaskAnalysisResponse,
    TaskAnalysisConfigResponse,
    TaskCommandRequest,
    TaskCommandResponse,
    SprintCreate,
    SprintResponse,
    AimCreate,
    AimResponse,
    TodoCreate,
    TodoResponse,
    TodoItemResponse,
    TodoUpdate,
)
from .task_detection import task_detection_graph
from .task_commands import resolve_task_command


@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(bind=engine)
    migrate_sqlite_schema()
    yield


def migrate_sqlite_schema() -> None:
    if engine.dialect.name != "sqlite":
        return
    inspector = inspect(engine)
    columns = {column["name"] for column in inspector.get_columns("todos")}
    additions = {
        "description": "TEXT NOT NULL DEFAULT ''",
        "sprint_id": "INTEGER",
        "aim_id": "INTEGER",
        "start_time": "DATETIME",
        "end_time": "DATETIME",
        "expected_duration_minutes": "INTEGER",
        "is_running": "BOOLEAN NOT NULL DEFAULT 0",
    }
    with engine.begin() as connection:
        for name, definition in additions.items():
            if name in columns:
                continue
            connection.execute(
                text("ALTER TABLE todos ADD COLUMN {} {}".format(name, definition))
            )
        connection.execute(
            text("UPDATE todos SET end_time = updated_at WHERE completed = 1 AND end_time IS NULL")
        )
        if "sprint_settings" in inspector.get_table_names():
            connection.execute(
                text(
                    "INSERT INTO sprints (name, end_date) "
                    "SELECT 'Current sprint', end_date FROM sprint_settings "
                    "WHERE end_date IS NOT NULL "
                    "AND NOT EXISTS (SELECT 1 FROM sprints WHERE name = 'Current sprint')"
                )
            )


app = FastAPI(title="BSK Todo API", version="1.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def clean_title(title: str) -> str:
    cleaned = title.strip()
    if not cleaned:
        raise HTTPException(status_code=422, detail="Title cannot be blank")
    return cleaned


def build_todo_items(items) -> List[TodoItem]:
    return [
        TodoItem(
            name=clean_title(item.name),
            estimated_duration_minutes=item.estimated_duration_minutes,
        )
        for item in items
    ]


def find_todo(todo_id: int, db: Session) -> Todo:
    todo = db.get(Todo, todo_id)
    if todo is None:
        raise HTTPException(status_code=404, detail="Todo not found")
    return todo


def find_todos(todo_ids: List[int], db: Session) -> List[Todo]:
    unique_ids = list(dict.fromkeys(todo_ids))
    if not unique_ids:
        return []
    todos = list(db.scalars(select(Todo).where(Todo.id.in_(unique_ids))))
    if len(todos) != len(unique_ids):
        raise HTTPException(status_code=422, detail="One or more referenced tasks do not exist")
    by_id = {todo.id: todo for todo in todos}
    return [by_id[todo_id] for todo_id in unique_ids]


def validate_schedule(start_time, end_time) -> None:
    if start_time is not None and end_time is not None and end_time < start_time:
        raise HTTPException(status_code=422, detail="End time cannot be before start time")


def validate_dag(todo_id: int, dependencies: List[Todo], db: Session) -> None:
    pending = [item.id for item in dependencies]
    visited = set()
    while pending:
        current_id = pending.pop()
        if current_id == todo_id:
            raise HTTPException(status_code=422, detail="This relationship would create a cycle")
        if current_id in visited:
            continue
        visited.add(current_id)
        current = find_todo(current_id, db)
        pending.extend(current.dependency_ids)


@app.get("/api/health")
def health() -> Dict[str, str]:
    return {"status": "ok"}


@app.get("/api/workspace")
def workspace() -> Dict[str, str]:
    return {"path": str(WORKSPACE)}


@app.get("/api/sprints", response_model=List[SprintResponse])
def list_sprints(db: Session = Depends(get_db)):
    return list(db.scalars(select(Sprint).order_by(Sprint.end_date, Sprint.id)))


@app.post("/api/sprints", response_model=SprintResponse, status_code=status.HTTP_201_CREATED)
def create_sprint(payload: SprintCreate, db: Session = Depends(get_db)):
    name = " ".join(payload.name.split())
    if not name:
        raise HTTPException(status_code=422, detail="Sprint name cannot be blank")
    if payload.end_date <= date.today():
        raise HTTPException(status_code=422, detail="Sprint end date must be after today")
    if db.scalar(select(Sprint).where(Sprint.name == name)) is not None:
        raise HTTPException(status_code=409, detail="A sprint with this name already exists")
    sprint = Sprint(name=name, end_date=payload.end_date)
    db.add(sprint)
    db.commit()
    db.refresh(sprint)
    return sprint


@app.get("/api/aims", response_model=List[AimResponse])
def list_aims(db: Session = Depends(get_db)):
    return list(db.scalars(select(Aim).order_by(Aim.created_at, Aim.id)))


@app.post("/api/aims", response_model=AimResponse, status_code=status.HTTP_201_CREATED)
def create_aim(payload: AimCreate, db: Session = Depends(get_db)):
    name = clean_title(payload.name)
    aim = Aim(name=name, description=payload.description.strip())
    db.add(aim)
    db.commit()
    db.refresh(aim)
    return aim


@app.get("/api/todos", response_model=List[TodoResponse])
def list_todos(db: Session = Depends(get_db)) -> List[Todo]:
    return list(db.scalars(select(Todo).order_by(Todo.created_at.desc(), Todo.id.desc())))


@app.get("/api/todo-items", response_model=List[TodoItemResponse])
def list_todo_items(db: Session = Depends(get_db)) -> List[TodoItem]:
    return list(db.scalars(select(TodoItem).order_by(TodoItem.id)))


@app.post("/api/task-analysis", response_model=TaskAnalysisResponse)
def analyze_task(payload: TaskAnalysisRequest, db: Session = Depends(get_db)):
    result = task_detection_graph.invoke(
        {
            "text": payload.text,
            "answers": payload.answers,
            "task_names": list(db.scalars(select(Todo.title))),
        }
    )
    return {
        "suggestion": result["suggestion"],
        "clarification_questions": result["clarification_questions"],
        "ai_powered": result["ai_powered"],
        "analysis_source": result["analysis_source"],
    }


@app.get("/api/task-analysis/config", response_model=TaskAnalysisConfigResponse)
def task_analysis_config():
    configured = bool(os.getenv("OPENAI_API_KEY"))
    return {
        "openai_configured": configured,
        "model": os.getenv("OPENAI_MODEL", "gpt-4.1-mini") if configured else None,
    }


@app.post("/api/task-commands", response_model=TaskCommandResponse)
def run_task_command(payload: TaskCommandRequest, db: Session = Depends(get_db)):
    command, source = resolve_task_command(payload.text)
    if command is None:
        return {"handled": False, "source": source}

    task_id = int(command["task_id"])
    todo = find_todo(task_id, db)
    action = command["action"]
    if action == "dependency":
        dependency_id = int(command["dependency_id"])
        dependency_ids = list(dict.fromkeys([*todo.dependency_ids, dependency_id]))
        todo = update_todo(task_id, TodoUpdate(dependency_ids=dependency_ids), db)
        message = f"Set #{task_id} to depend on #{dependency_id}."
    elif action == "rename":
        title = str(command["title"])
        todo = update_todo(task_id, TodoUpdate(title=title), db)
        message = f"Renamed #{task_id} to “{todo.title}”."
    elif action == "duration":
        minutes = int(command["minutes"])
        todo = update_todo(task_id, TodoUpdate(expected_duration_minutes=minutes), db)
        message = f"Set the estimated time for #{task_id} to {minutes // 1440} days and {(minutes % 1440) // 60} hours."
    elif action == "aim":
        aim_id = int(command["aim_id"])
        if db.get(Aim, aim_id) is None:
            raise HTTPException(status_code=404, detail="Aim not found")
        todo = update_todo(task_id, TodoUpdate(aim_id=aim_id), db)
        message = f"Assigned #{task_id} to aim @{aim_id}."
    else:
        todo = update_todo(task_id, TodoUpdate(start_time=command["start_time"]), db)
        message = f"Set the start time for #{task_id} to {command['when']}."
    return {"handled": True, "message": message, "todo": todo, "source": source}


@app.post("/api/todos", response_model=TodoResponse, status_code=status.HTTP_201_CREATED)
def create_todo(payload: TodoCreate, db: Session = Depends(get_db)) -> Todo:
    if payload.sprint_id is not None and db.get(Sprint, payload.sprint_id) is None:
        raise HTTPException(status_code=422, detail="Sprint does not exist")
    if payload.aim_id is not None and db.get(Aim, payload.aim_id) is None:
        raise HTTPException(status_code=422, detail="Aim does not exist")
    validate_schedule(payload.start_time, payload.end_time)
    dependencies = find_todos(payload.dependency_ids, db)
    todo = Todo(
        title=clean_title(payload.title),
        description=payload.description.strip(),
        sprint_id=payload.sprint_id,
        aim_id=payload.aim_id,
        start_time=payload.start_time,
        end_time=payload.end_time,
        expected_duration_minutes=payload.expected_duration_minutes,
        completed=payload.end_time is not None,
        is_running=payload.is_running and payload.end_time is None,
        dependencies=dependencies,
        todo_items=build_todo_items(payload.todo_items),
    )
    db.add(todo)
    db.commit()
    db.refresh(todo)
    return todo


@app.patch("/api/todos/{todo_id}", response_model=TodoResponse)
def update_todo(todo_id: int, payload: TodoUpdate, db: Session = Depends(get_db)) -> Todo:
    todo = find_todo(todo_id, db)
    changes = payload.model_dump(exclude_unset=True)
    dependency_ids = changes.pop("dependency_ids", None)
    todo_item_values = changes.pop("todo_items", None)
    if "title" in changes:
        if changes["title"] is None:
            raise HTTPException(status_code=422, detail="Title cannot be null")
        changes["title"] = clean_title(changes["title"])
    if "description" in changes:
        if changes["description"] is None:
            raise HTTPException(status_code=422, detail="Description cannot be null")
        changes["description"] = changes["description"].strip()
    if "completed" in changes and changes["completed"] is None:
        raise HTTPException(status_code=422, detail="Completed cannot be null")
    if changes.get("sprint_id") is not None and "sprint_id" in changes:
        if db.get(Sprint, changes["sprint_id"]) is None:
            raise HTTPException(status_code=422, detail="Sprint does not exist")
    if changes.get("aim_id") is not None and "aim_id" in changes:
        if db.get(Aim, changes["aim_id"]) is None:
            raise HTTPException(status_code=422, detail="Aim does not exist")
    validate_schedule(
        changes.get("start_time", todo.start_time), changes.get("end_time", todo.end_time)
    )
    if changes.get("end_time") is not None:
        changes["completed"] = True
        changes["is_running"] = False
    elif "end_time" in changes and changes["end_time"] is None:
        changes["completed"] = False
    if changes.get("is_running") is True:
        changes["completed"] = False
        changes["end_time"] = None
    new_dependencies = list(todo.dependencies)
    if dependency_ids is not None:
        if todo.id in dependency_ids:
            raise HTTPException(status_code=422, detail="A task cannot depend on itself")
        new_dependencies = find_todos(dependency_ids, db)
    validate_dag(todo.id, new_dependencies, db)
    todo.dependencies = new_dependencies
    if todo_item_values is not None:
        existing = {item.id: item for item in todo.todo_items}
        replacement = []
        for value in todo_item_values:
            item_id = value.get("id")
            item = existing.get(item_id) if item_id is not None else None
            if item_id is not None and item is None:
                raise HTTPException(status_code=422, detail="Todo item does not belong to this task")
            if item is None:
                item = TodoItem()
            item.name = clean_title(value["name"])
            item.estimated_duration_minutes = value["estimated_duration_minutes"]
            replacement.append(item)
        todo.todo_items = replacement
    for field, value in changes.items():
        setattr(todo, field, value)
    db.commit()
    db.refresh(todo)
    return todo


@app.delete("/api/todos/{todo_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_todo(todo_id: int, db: Session = Depends(get_db)) -> Response:
    todo = find_todo(todo_id, db)
    db.delete(todo)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
