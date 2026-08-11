# BSK Todo List

A full-stack life-planning application with a FastAPI/SQLite backend and a React/TypeScript frontend.

## Features

- Create, edit, complete, and delete todos
- Detect task details in a separate natural-language chat with a LangGraph workflow
- Keep numbered markers on related chat messages and open a prefilled task modal from any marker
- Ask and answer clarification questions before creating a task
- Update existing tasks from Chat with `#ID` commands for dependencies, names, durations, and start dates
- Add detailed descriptions and notes to tasks
- Assign reusable types to todos and create new types while adding a task
- Track visible task IDs, schedules, and expected duration
- Create multiple named sprints with future end dates
- Assign tasks to sprints and select a sprint-scoped timeline from the sidebar
- Link tasks through searchable dependencies
- Explore dependency relationships in an interactive DAG
- Track pending, scheduled, running, and completed task lifecycle states
- Filter by all, active, or completed
- Persistent SQLite storage
- Configurable backend workspace directory
- Responsive user interface
- REST API with interactive documentation

## Run locally

### Start everything

After installing the backend and frontend dependencies once, start the whole
system from the project root:

```bash
./start.sh
```

Pass a custom backend workspace when needed:

```bash
./start.sh --workspace ~/Documents/personal-todos
```

Run `./start.sh --help` to see host, port, and reload options. Press `Ctrl+C` to
stop both servers.

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

Task detection works locally without credentials. To use model-assisted extraction,
set `OPENAI_API_KEY`; optionally override the default model with `OPENAI_MODEL`:

```bash
OPENAI_API_KEY=your-key OPENAI_MODEL=gpt-4.1-mini ./start.sh
```

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

### Chat task commands

The Task Assistant understands these update commands:

```text
set #4 depends on #5
update #4 name to New name
set #5 estimated time to 4 days 5 hours
set #7 start time to now
set #7 start time to tomorrow
set #7 start time to three days from now
```

Type `#` in Chat to find a task by its ID and insert its reference.
When OpenAI is configured, commands are selected through structured function
tool calls. Without a key—or if the model call fails—the documented command
forms continue to work through the local fallback parser. Chat labels which
route handled each mutation.

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
| `GET` | `/api/todo-types` | List reusable todo types |
| `GET` | `/api/sprints` | List named sprints |
| `POST` | `/api/sprints` | Create a named sprint with a future end date |
| `POST` | `/api/todo-types` | Create a todo type |
| `POST` | `/api/task-analysis` | Detect task fields and clarification questions from text |
| `POST` | `/api/task-commands` | Apply a supported task update command |
| `POST` | `/api/todos` | Create a todo |
| `PATCH` | `/api/todos/{id}` | Update a todo |
| `DELETE` | `/api/todos/{id}` | Delete a todo |
