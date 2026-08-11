from datetime import date, datetime

from typing import List, Optional

from sqlalchemy import Boolean, Column, Date, DateTime, ForeignKey, Integer, String, Table, Text, UniqueConstraint, func
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
    todo_type: Mapped[str] = mapped_column(String(60), default="General", index=True)
    completed: Mapped[bool] = mapped_column(Boolean, default=False)
    is_running: Mapped[bool] = mapped_column(Boolean, default=False)
    sprint_id: Mapped[Optional[int]] = mapped_column(ForeignKey("sprints.id"), nullable=True)
    aim_id: Mapped[Optional[int]] = mapped_column(ForeignKey("aims.id"), nullable=True)
    start_time: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    end_time: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    expected_duration_minutes: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now()
    )
    sprint: Mapped[Optional["Sprint"]] = relationship(foreign_keys=[sprint_id])
    aim: Mapped[Optional["Aim"]] = relationship(foreign_keys=[aim_id], back_populates="tasks")
    dependencies: Mapped[List["Todo"]] = relationship(
        secondary=todo_dependencies,
        primaryjoin=id == todo_dependencies.c.todo_id,
        secondaryjoin=id == todo_dependencies.c.depends_on_id,
    )

    @property
    def dependency_ids(self) -> List[int]:
        return [todo.id for todo in self.dependencies]


class TodoType(Base):
    __tablename__ = "todo_types"
    __table_args__ = (UniqueConstraint("name", name="uq_todo_types_name"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(60), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class Sprint(Base):
    __tablename__ = "sprints"
    __table_args__ = (UniqueConstraint("name", name="uq_sprints_name"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120), index=True)
    end_date: Mapped[date] = mapped_column(Date, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class Aim(Base):
    __tablename__ = "aims"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200), index=True)
    description: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    tasks: Mapped[List["Todo"]] = relationship(back_populates="aim")
