# BSK Todo List

A full-stack todo application with a FastAPI/SQLite backend and a React/TypeScript frontend.

## Features

- Create, edit, complete, and delete todos
- Filter by all, active, or completed
- Persistent SQLite storage
- Configurable backend workspace directory
- Responsive user interface
- REST API with interactive documentation

## Run locally

### Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python -m app --workspace ./workspace --reload
```

The API is available at `http://localhost:8000`; Swagger documentation is at
`http://localhost:8000/docs`.

`--workspace` accepts either a relative or absolute folder. The backend creates
the folder when necessary and stores its `todos.sqlite3` database inside it. This
makes it easy to keep separate todo collections:

```bash
python -m app --workspace ~/Documents/personal-todos --reload
python -m app --workspace /Volumes/team-data/todos --port 8001
```

If `--workspace` is omitted, data is stored in `backend/workspace`. When starting
with Uvicorn directly, set the equivalent `TODO_WORKSPACE` environment variable:

```bash
TODO_WORKSPACE=./my-data uvicorn app.main:app --reload
```

### Frontend

In another terminal:

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`. Vite proxies `/api` requests to the backend.

## Tests

```bash
cd backend
pip install -r requirements-dev.txt
pytest
```

```bash
cd frontend
npm install
npm run lint
npm run build
```

## API

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/todos` | List todos |
| `GET` | `/api/workspace` | Show the active workspace |
| `POST` | `/api/todos` | Create a todo |
| `PATCH` | `/api/todos/{id}` | Update a todo |
| `DELETE` | `/api/todos/{id}` | Delete a todo |
