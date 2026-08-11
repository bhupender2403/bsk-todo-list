import os

os.environ["DATABASE_URL"] = "sqlite://"

from fastapi.testclient import TestClient
from sqlalchemy import text

from app.database import Base, engine
from app.main import app


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


def test_task_analysis_accepts_short_text(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    with TestClient(app) as client:
        response = client.post("/api/task-analysis", json={"text": "Go"})

    assert response.status_code == 200
    assert response.json()["suggestion"]["title"] == "Go"
