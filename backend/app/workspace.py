import os
from pathlib import Path
from typing import Optional


DEFAULT_WORKSPACE = Path(__file__).resolve().parent.parent / "workspace"


def resolve_workspace(value: Optional[str] = None) -> Path:
    """Return an absolute, writable workspace directory and create it if needed."""
    configured = value or os.getenv("TODO_WORKSPACE")
    workspace = Path(configured).expanduser() if configured else DEFAULT_WORKSPACE
    workspace = workspace.resolve()
    workspace.mkdir(parents=True, exist_ok=True)

    if not workspace.is_dir():
        raise RuntimeError("Todo workspace must be a directory: {}".format(workspace))
    if not os.access(str(workspace), os.W_OK):
        raise RuntimeError("Todo workspace is not writable: {}".format(workspace))

    return workspace


def database_path(value: Optional[str] = None) -> Path:
    return resolve_workspace(value) / "todos.sqlite3"
