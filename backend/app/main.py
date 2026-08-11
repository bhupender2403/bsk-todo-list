from contextlib import asynccontextmanager
import os
from typing import Dict, List

from fastapi import Depends, FastAPI, HTTPException, Response, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import inspect, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .database import Base, WORKSPACE, engine, get_db
from .models import Todo, TodoType
from .schemas import (
    TaskAnalysisRequest,
    TaskAnalysisResponse,
    TaskAnalysisConfigResponse,
    TaskCommandRequest,
    TaskCommandResponse,
    TodoCreate,
    TodoResponse,
    TodoTypeCreate,
    TodoTypeResponse,
    TodoUpdate,
)
from .task_detection import task_detection_graph
from .task_commands import parse_task_command


@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(bind=engine)
    migrate_sqlite_schema()
    ensure_default_type()
    yield


def migrate_sqlite_schema() -> None:
    if engine.dialect.name != "sqlite":
        return
    columns = {column["name"] for column in inspect(engine).get_columns("todos")}
    additions = {
        "description": "TEXT NOT NULL DEFAULT ''",
        "todo_type": "VARCHAR(60) NOT NULL DEFAULT 'General'",
        "parent_id": "INTEGER",
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


def ensure_default_type() -> None:
    with Session(engine) as db:
        if db.scalar(select(TodoType).where(TodoType.name == "General")) is None:
            db.add(TodoType(name="General"))
            db.commit()


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


def clean_type_name(name: str) -> str:
    cleaned = " ".join(name.split())
    if not cleaned:
        raise HTTPException(status_code=422, detail="Type name cannot be blank")
    return cleaned


def find_type(name: str, db: Session) -> TodoType:
    todo_type = db.scalar(select(TodoType).where(TodoType.name == name))
    if todo_type is None:
        raise HTTPException(status_code=422, detail="Todo type does not exist")
    return todo_type


def find_or_create_type(name: str, db: Session) -> TodoType:
    todo_type = db.scalar(select(TodoType).where(TodoType.name == name))
    if todo_type is None:
        todo_type = TodoType(name=name)
        db.add(todo_type)
        db.flush()
    return todo_type


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


def validate_dag(todo_id: int, parent_id, dependencies: List[Todo], db: Session) -> None:
    pending = ([parent_id] if parent_id is not None else []) + [item.id for item in dependencies]
    visited = set()
    while pending:
        current_id = pending.pop()
        if current_id == todo_id:
            raise HTTPException(status_code=422, detail="This relationship would create a cycle")
        if current_id in visited:
            continue
        visited.add(current_id)
        current = find_todo(current_id, db)
        if current.parent_id is not None:
            pending.append(current.parent_id)
        pending.extend(current.dependency_ids)


@app.get("/api/health")
def health() -> Dict[str, str]:
    return {"status": "ok"}


@app.get("/api/workspace")
def workspace() -> Dict[str, str]:
    return {"path": str(WORKSPACE)}


@app.get("/api/todos", response_model=List[TodoResponse])
def list_todos(db: Session = Depends(get_db)) -> List[Todo]:
    return list(db.scalars(select(Todo).order_by(Todo.created_at.desc(), Todo.id.desc())))


@app.post("/api/task-analysis", response_model=TaskAnalysisResponse)
def analyze_task(payload: TaskAnalysisRequest, db: Session = Depends(get_db)):
    result = task_detection_graph.invoke(
        {
            "text": payload.text,
            "answers": payload.answers,
            "type_names": list(db.scalars(select(TodoType.name))),
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
    command = parse_task_command(payload.text)
    if command is None:
        raise HTTPException(status_code=422, detail="I could not understand that task command")

    task_id = int(command["task_id"])
    todo = find_todo(task_id, db)
    action = command["action"]
    if action == "parent":
        parent_id = int(command["parent_id"])
        todo = update_todo(task_id, TodoUpdate(parent_id=parent_id), db)
        message = f"Set #{parent_id} as the parent of #{task_id}."
    elif action == "dependency":
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
    else:
        todo = update_todo(task_id, TodoUpdate(start_time=command["start_time"]), db)
        message = f"Set the start time for #{task_id} to {command['when']}."
    return {"message": message, "todo": todo}


@app.get("/api/todo-types", response_model=List[TodoTypeResponse])
def list_todo_types(db: Session = Depends(get_db)) -> List[TodoType]:
    return list(db.scalars(select(TodoType).order_by(TodoType.name)))


@app.post(
    "/api/todo-types",
    response_model=TodoTypeResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_todo_type(payload: TodoTypeCreate, db: Session = Depends(get_db)) -> TodoType:
    name = clean_type_name(payload.name)
    existing = db.scalar(select(TodoType).where(TodoType.name == name))
    if existing is not None:
        return existing
    todo_type = TodoType(name=name)
    db.add(todo_type)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        return db.scalar(select(TodoType).where(TodoType.name == name))
    db.refresh(todo_type)
    return todo_type


@app.post("/api/todos", response_model=TodoResponse, status_code=status.HTTP_201_CREATED)
def create_todo(payload: TodoCreate, db: Session = Depends(get_db)) -> Todo:
    type_name = clean_type_name(payload.todo_type)
    find_or_create_type(type_name, db)
    if payload.parent_id is not None:
        find_todo(payload.parent_id, db)
    validate_schedule(payload.start_time, payload.end_time)
    dependencies = find_todos(payload.dependency_ids, db)
    todo = Todo(
        title=clean_title(payload.title),
        description=payload.description.strip(),
        todo_type=type_name,
        parent_id=payload.parent_id,
        start_time=payload.start_time,
        end_time=payload.end_time,
        expected_duration_minutes=payload.expected_duration_minutes,
        completed=payload.end_time is not None,
        is_running=payload.is_running and payload.end_time is None,
        dependencies=dependencies,
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
    if "todo_type" in changes:
        if changes["todo_type"] is None:
            raise HTTPException(status_code=422, detail="Todo type cannot be null")
        changes["todo_type"] = clean_type_name(changes["todo_type"])
        find_or_create_type(changes["todo_type"], db)
    if changes.get("parent_id") == todo.id:
        raise HTTPException(status_code=422, detail="A task cannot be its own parent")
    if changes.get("parent_id") is not None and "parent_id" in changes:
        find_todo(changes["parent_id"], db)
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
    new_parent_id = changes.get("parent_id", todo.parent_id)
    validate_dag(todo.id, new_parent_id, new_dependencies, db)
    todo.dependencies = new_dependencies
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
