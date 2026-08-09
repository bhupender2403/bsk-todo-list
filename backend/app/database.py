import os

from sqlalchemy import URL, create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker
from sqlalchemy.pool import StaticPool

from .workspace import database_path, resolve_workspace


WORKSPACE = resolve_workspace()
DATABASE_URL = os.getenv("DATABASE_URL")
database_target = DATABASE_URL or URL.create("sqlite", database=str(database_path()))
is_sqlite = not DATABASE_URL or DATABASE_URL.startswith("sqlite")
connect_args = {"check_same_thread": False} if is_sqlite else {}
engine_options = {"poolclass": StaticPool} if DATABASE_URL == "sqlite://" else {}

engine = create_engine(database_target, connect_args=connect_args, **engine_options)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
