from pathlib import Path

from app.__main__ import build_parser
from app.workspace import database_path, resolve_workspace


def test_workspace_is_created(tmp_path):
    requested = tmp_path / "nested" / "todo-data"

    workspace = resolve_workspace(str(requested))

    assert workspace == requested.resolve()
    assert workspace.is_dir()
    assert database_path(str(requested)) == workspace / "todos.sqlite3"


def test_workspace_cli_argument():
    args = build_parser().parse_args(["--workspace", "/tmp/my-todos", "--port", "9000"])

    assert Path(args.workspace) == Path("/tmp/my-todos")
    assert args.port == 9000
