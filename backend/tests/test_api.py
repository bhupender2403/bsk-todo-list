import os
from datetime import date, timedelta

os.environ["DATABASE_URL"] = "sqlite://"

from fastapi.testclient import TestClient
from sqlalchemy import text

from app.database import Base, engine
from app.main import app
from app.task_commands import _has_explicit_task_ids


def setup_function():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)


def test_todo_lifecycle():
    with TestClient(app) as client:
        created_type = client.post("/api/todo-types", json={"name": "  Work  "})
        assert created_type.status_code == 201
        assert created_type.json()["name"] == "Work"

        created = client.post(
            "/api/todos",
            json={
                "title": "  Ship the app  ",
                "description": "Prepare and publish the release.",
                "todo_type": "Work",
                "start_time": "2026-08-10T09:00:00",
                "end_time": "2026-08-10T17:00:00",
                "expected_duration_minutes": 480,
            },
        )
        assert created.status_code == 201
        todo = created.json()
        assert todo["title"] == "Ship the app"
        assert todo["description"] == "Prepare and publish the release."
        assert todo["todo_type"] == "Work"
        assert todo["id"] > 0
        assert todo["expected_duration_minutes"] == 480
        assert todo["dependency_ids"] == []
        assert todo["is_running"] is False
        assert todo["completed"] is True

        listed = client.get("/api/todos")
        assert listed.status_code == 200
        assert len(listed.json()) == 1

        updated = client.patch(f"/api/todos/{todo['id']}", json={"completed": True})
        assert updated.status_code == 200
        assert updated.json()["completed"] is True

        deleted = client.delete(f"/api/todos/{todo['id']}")
        assert deleted.status_code == 204
        assert client.get("/api/todos").json() == []


def test_rejects_blank_title():
    with TestClient(app) as client:
        response = client.post("/api/todos", json={"title": "   "})
    assert response.status_code == 422


def test_current_sprint_end_date_can_be_saved_and_cleared():
    with TestClient(app) as client:
        assert client.get("/api/sprint").json() == {"end_date": None}
        assert client.put("/api/sprint", json={"end_date": "2026-08-28"}).json() == {
            "end_date": "2026-08-28"
        }
        assert client.get("/api/sprint").json() == {"end_date": "2026-08-28"}
        assert client.put("/api/sprint", json={"end_date": None}).json() == {
            "end_date": None
        }


def test_new_type_is_reusable_and_can_be_created_with_todo():
    with TestClient(app) as client:
        assert [item["name"] for item in client.get("/api/todo-types").json()] == [
            "General"
        ]
        client.post("/api/todo-types", json={"name": "Errands"})
        names = [item["name"] for item in client.get("/api/todo-types").json()]
        assert names == ["Errands", "General"]

        response = client.post(
            "/api/todos", json={"title": "Call someone", "todo_type": "Personal"}
        )
        assert response.status_code == 201
        assert response.json()["todo_type"] == "Personal"
        names = [item["name"] for item in client.get("/api/todo-types").json()]
        assert names == ["Errands", "General", "Personal"]


def test_existing_workspace_is_migrated_to_general_type():
    Base.metadata.drop_all(bind=engine)
    with engine.begin() as connection:
        connection.execute(
            text(
                "CREATE TABLE todos ("
                "id INTEGER PRIMARY KEY, title VARCHAR(200) NOT NULL, "
                "completed BOOLEAN NOT NULL DEFAULT 0, "
                "created_at DATETIME DEFAULT CURRENT_TIMESTAMP, "
                "updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)"
            )
        )
        connection.execute(text("INSERT INTO todos (title) VALUES ('Existing task')"))

    with TestClient(app) as client:
        todos = client.get("/api/todos").json()
        types = client.get("/api/todo-types").json()

    assert todos[0]["title"] == "Existing task"
    assert todos[0]["description"] == ""
    assert todos[0]["todo_type"] == "General"
    assert [item["name"] for item in types] == ["General"]


def test_parent_and_dependencies():
    with TestClient(app) as client:
        parent = client.post("/api/todos", json={"title": "Parent"}).json()
        dependency = client.post("/api/todos", json={"title": "Dependency"}).json()
        child = client.post(
            "/api/todos",
            json={
                "title": "Child",
                "parent_id": parent["id"],
                "dependency_ids": [dependency["id"]],
            },
        )

        assert child.status_code == 201
        assert child.json()["parent_id"] == parent["id"]
        assert child.json()["dependency_ids"] == [dependency["id"]]

        self_reference = client.patch(
            f"/api/todos/{parent['id']}", json={"parent_id": parent["id"]}
        )
        assert self_reference.status_code == 422

        cycle = client.patch(
            f"/api/todos/{dependency['id']}",
            json={"dependency_ids": [child.json()["id"]]},
        )
        assert cycle.status_code == 422


def test_rejects_end_before_start():
    with TestClient(app) as client:
        response = client.post(
            "/api/todos",
            json={
                "title": "Bad schedule",
                "start_time": "2026-08-11T10:00:00",
                "end_time": "2026-08-10T10:00:00",
            },
        )
        assert response.status_code == 422


def test_running_and_completed_lifecycle():
    with TestClient(app) as client:
        todo = client.post(
            "/api/todos",
            json={"title": "Scheduled", "start_time": "2026-08-11T10:00:00"},
        ).json()
        running = client.patch(
            f"/api/todos/{todo['id']}", json={"is_running": True}
        ).json()
        assert running["is_running"] is True
        assert running["end_time"] is None

        completed = client.patch(
            f"/api/todos/{todo['id']}", json={"end_time": "2026-08-11T12:00:00"}
        ).json()
        assert completed["completed"] is True
        assert completed["is_running"] is False


def test_task_analysis_detects_fields_and_requests_clarification(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    with TestClient(app) as client:
        response = client.post(
            "/api/task-analysis",
            json={"text": "Prepare release tomorrow for 2 hours"},
        )

    assert response.status_code == 200
    result = response.json()
    assert result["suggestion"]["title"] == "Prepare release tomorrow for 2 hours"
    assert result["suggestion"]["expected_duration_hours"] == 2
    assert result["suggestion"]["start_date"] is not None
    assert result["ai_powered"] is False
    assert result["analysis_source"] == "local"
    assert result["clarification_questions"] == []


def test_task_analysis_accepts_clarification_answers(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    with TestClient(app) as client:
        response = client.post(
            "/api/task-analysis",
            json={
                "text": "Prepare release",
                "answers": {
                    "When should this task start?": "tomorrow",
                    "How long?": "3 hours",
                },
            },
        )

    result = response.json()
    assert result["suggestion"]["start_date"] is not None
    assert result["suggestion"]["expected_duration_hours"] == 3


def test_answered_optional_clarifications_make_task_ready(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    with TestClient(app) as client:
        client.post("/api/todo-types", json={"name": "Work"})
        response = client.post(
            "/api/task-analysis",
            json={
                "text": "Write ideas",
                "answers": {
                    "When should this task start? You can also say that it should remain pending.": "Keep it pending",
                    "How long do you expect this task to take?": "Not sure yet",
                    "Which task type best describes this work?": "General",
                },
            },
        )

    assert response.status_code == 200
    assert response.json()["clarification_questions"] == []


def test_task_analysis_accepts_short_text(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    with TestClient(app) as client:
        response = client.post("/api/task-analysis", json={"text": "Go"})

    assert response.status_code == 200
    assert response.json()["suggestion"]["title"] == "Go"


def test_task_analysis_config_does_not_expose_key(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "secret-value")
    monkeypatch.setenv("OPENAI_MODEL", "test-model")
    with TestClient(app) as client:
        response = client.get("/api/task-analysis/config")

    assert response.json() == {
        "openai_configured": True,
        "model": "test-model",
    }
    assert "secret-value" not in response.text


def test_chat_task_commands_update_tasks():
    with TestClient(app) as client:
        tasks = [
            client.post("/api/todos", json={"title": f"Task {index}"}).json()
            for index in range(1, 8)
        ]
        by_number = {task["id"]: task for task in tasks}
        task3, task4, task5, task7 = (
            tasks[2]["id"],
            tasks[3]["id"],
            tasks[4]["id"],
            tasks[6]["id"],
        )

        parent = client.post(
            "/api/task-commands", json={"text": f"set #{task3} as parent of #{task4}"}
        )
        assert parent.status_code == 200
        assert parent.json()["handled"] is True
        assert parent.json()["source"] == "local"
        assert parent.json()["todo"]["parent_id"] == task3

        dependency = client.post(
            "/api/task-commands", json={"text": f"#{task4} depend on #{task5}"}
        )
        assert dependency.json()["todo"]["dependency_ids"] == [task5]

        renamed = client.post(
            "/api/task-commands", json={"text": f"update #{task4} name to New name"}
        )
        assert renamed.json()["todo"]["title"] == "New name"

        duration = client.post(
            "/api/task-commands",
            json={"text": f"set #{task5} estimated time to 4 days 5 hours"},
        )
        assert duration.json()["todo"]["expected_duration_minutes"] == 4 * 1440 + 5 * 60

        scheduled = client.post(
            "/api/task-commands",
            json={"text": f"set #{task7} start time to three days from now"},
        )
        assert scheduled.json()["todo"]["start_time"][:10] == (
            date.today() + timedelta(days=3)
        ).isoformat()
        assert set(by_number) == {task["id"] for task in client.get("/api/todos").json()}


def test_task_command_declines_non_mutation(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    with TestClient(app) as client:
        response = client.post("/api/task-commands", json={"text": "Plan a holiday"})

    assert response.json() == {
        "handled": False,
        "message": None,
        "todo": None,
        "source": "local",
    }


def test_tool_call_requires_hash_prefixed_task_ids():
    command = {"action": "duration", "task_id": 1, "minutes": 1440}

    assert _has_explicit_task_ids("Set estimated time for #1 to 1 day", command)
    assert not _has_explicit_task_ids("Add a new 1 day task named clean room", command)
