import argparse
import os
from typing import Optional, Sequence


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run the BSK Todo backend")
    parser.add_argument(
        "--workspace",
        metavar="FOLDER",
        help="folder where backend data is stored (default: backend/workspace)",
    )
    parser.add_argument("--host", default="127.0.0.1", help="server host")
    parser.add_argument("--port", default=8000, type=int, help="server port")
    parser.add_argument("--reload", action="store_true", help="reload on code changes")
    return parser


def main(argv: Optional[Sequence[str]] = None) -> None:
    args = build_parser().parse_args(argv)
    if args.workspace:
        os.environ["TODO_WORKSPACE"] = args.workspace

    import uvicorn

    uvicorn.run("app.main:app", host=args.host, port=args.port, reload=args.reload)


if __name__ == "__main__":
    main()
