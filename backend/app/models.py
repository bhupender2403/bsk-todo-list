from datetime import datetime

from typing import List, Optional

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Table, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


todo_dependencies = Table(
    "todo_dependencies",
    Base.metadata,
    Column("todo_id", ForeignKey("todos.id", ondelete="CASCADE"), primary_key=True),
    Column("depends_on_id", ForeignKey("todos.id", ondelete="CASCADE"), primary_key=True),
)


class Todo(Base):
    __tablename__ = "todos"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(200), index=True)
    description: Mapped[str] = mapped_column(Text, default="")
    completed: Mapped[bool] = mapped_column(Boolean, default=False)
    is_running: Mapped[bool] = mapped_column(Boolean, default=False)
    is_picked: Mapped[bool] = mapped_column(Boolean, default=False)
    aim_id: Mapped[Optional[int]] = mapped_column(ForeignKey("aims.id"), nullable=True)
    start_time: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    end_time: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    expected_duration_minutes: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )
    aim: Mapped[Optional["Aim"]] = relationship(foreign_keys=[aim_id], back_populates="tasks")
    dependencies: Mapped[List["Todo"]] = relationship(
        secondary=todo_dependencies,
        primaryjoin=id == todo_dependencies.c.todo_id,
        secondaryjoin=id == todo_dependencies.c.depends_on_id,
    )
    todo_items: Mapped[List["TodoItem"]] = relationship(
        back_populates="task", cascade="all, delete-orphan", order_by="TodoItem.id"
    )

    @property
    def dependency_ids(self) -> List[int]:
        return [todo.id for todo in self.dependencies]


class TodoItem(Base):
    __tablename__ = "todo_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    task_id: Mapped[int] = mapped_column(ForeignKey("todos.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    estimated_duration_minutes: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    task: Mapped["Todo"] = relationship(back_populates="todo_items")


class Aim(Base):
    __tablename__ = "aims"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200), index=True)
    description: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    tasks: Mapped[List["Todo"]] = relationship(back_populates="aim")
