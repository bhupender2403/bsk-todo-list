from contextlib import asynccontextmanager
from typing import Dict, List

from fastapi import Depends, FastAPI, HTTPException, Response, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select
from sqlalchemy.orm import Session

from .database import Base, WORKSPACE, engine, get_db
from .models import Todo
from .schemas import TodoCreate, TodoResponse, TodoUpdate


@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(bind=engine)
    yield


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


def find_todo(todo_id: int, db: Session) -> Todo:
    todo = db.get(Todo, todo_id)
    if todo is None:
        raise HTTPException(status_code=404, detail="Todo not found")
    return todo


@app.get("/api/health")
def health() -> Dict[str, str]:
    return {"status": "ok"}


@app.get("/api/workspace")
def workspace() -> Dict[str, str]:
    return {"path": str(WORKSPACE)}


@app.get("/api/todos", response_model=List[TodoResponse])
def list_todos(db: Session = Depends(get_db)) -> List[Todo]:
    return list(db.scalars(select(Todo).order_by(Todo.created_at.desc(), Todo.id.desc())))


@app.post("/api/todos", response_model=TodoResponse, status_code=status.HTTP_201_CREATED)
def create_todo(payload: TodoCreate, db: Session = Depends(get_db)) -> Todo:
    todo = Todo(title=clean_title(payload.title))
    db.add(todo)
    db.commit()
    db.refresh(todo)
    return todo


@app.patch("/api/todos/{todo_id}", response_model=TodoResponse)
def update_todo(todo_id: int, payload: TodoUpdate, db: Session = Depends(get_db)) -> Todo:
    todo = find_todo(todo_id, db)
    changes = payload.dict(exclude_unset=True)
    if "title" in changes:
        if changes["title"] is None:
            raise HTTPException(status_code=422, detail="Title cannot be null")
        changes["title"] = clean_title(changes["title"])
    if "completed" in changes and changes["completed"] is None:
        raise HTTPException(status_code=422, detail="Completed cannot be null")
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
