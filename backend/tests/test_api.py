import os
from datetime import date, timedelta

os.environ["DATABASE_URL"] = "sqlite://"

from fastapi.testclient import TestClient
from sqlalchemy import text

from app.database import Base, engine
from app.main import app
from app.task_commands import _has_explicit_entity_ids


def setup_function():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)


def test_todo_lifecycle():
    with TestClient(app) as client:
        created = client.post(
            "/api/todos",
            json={
                "title": "  Ship the app  ",
                "description": "Prepare and publish the release.",
                "start_time": "2026-08-10T09:00:00",
                "end_time": "2026-08-10T17:00:00",
                "expected_duration_minutes": 480,
                "todo_items": [
                    {"name": "Build package", "estimated_duration_minutes": 45},
                    {"name": "Publish release", "estimated_duration_minutes": 30},
                ],
            },
        )
        assert created.status_code == 201
        todo = created.json()
        assert todo["title"] == "Ship the app"
        assert todo["description"] == "Prepare and publish the release."
        assert todo["id"] > 0
        assert todo["expected_duration_minutes"] == 480
        assert todo["dependency_ids"] == []
        assert todo["is_running"] is False
        assert todo["completed"] is True
        assert [item["name"] for item in todo["todo_items"]] == [
            "Build package",
            "Publish release",
        ]
        assert all(item["id"] > 0 for item in todo["todo_items"])
        assert all(item["task_id"] == todo["id"] for item in todo["todo_items"])

        first_item = todo["todo_items"][0]
        changed_items = client.patch(
            f"/api/todos/{todo['id']}",
            json={
                "todo_items": [
                    {
                        "id": first_item["id"],
                        "name": "Build signed package",
                        "estimated_duration_minutes": 60,
                    }
                ]
            },
        ).json()["todo_items"]
        assert changed_items[0]["id"] == first_item["id"]
        assert changed_items[0]["name"] == "Build signed package"
        assert len(client.get("/api/todo-items").json()) == 1

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


def test_existing_workspace_is_migrated_with_current_task_fields():
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

    assert todos[0]["title"] == "Existing task"
    assert todos[0]["description"] == ""


def test_dependencies_and_cycles():
    with TestClient(app) as client:
        dependency = client.post("/api/todos", json={"title": "Dependency"}).json()
        child = client.post(
            "/api/todos",
            json={
                "title": "Child",
                "dependency_ids": [dependency["id"]],
            },
        )

        assert child.status_code == 201
        assert child.json()["dependency_ids"] == [dependency["id"]]

        cycle = client.patch(
            f"/api/todos/{dependency['id']}",
            json={"dependency_ids": [child.json()["id"]]},
        )
        assert cycle.status_code == 422


def test_picking_requires_unfinished_dependencies_to_be_picked():
    with TestClient(app) as client:
        dependency = client.post("/api/todos", json={"title": "Prepare"}).json()
        task = client.post(
            "/api/todos",
            json={"title": "Execute", "dependency_ids": [dependency["id"]]},
        ).json()

        blocked = client.patch(f"/api/todos/{task['id']}", json={"is_picked": True})
        assert blocked.status_code == 422
        assert f"#{dependency['id']} Prepare" in blocked.json()["detail"]

        client.patch(f"/api/todos/{dependency['id']}", json={"is_picked": True})
        picked = client.patch(f"/api/todos/{task['id']}", json={"is_picked": True})
        assert picked.status_code == 200
        assert picked.json()["is_picked"] is True


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
        response = client.post(
            "/api/task-analysis",
            json={
                "text": "Write ideas",
                "answers": {
                    "When should this task start? You can also say that it should remain pending.": "Keep it pending",
                    "How long do you expect this task to take?": "Not sure yet",
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


def test_existing_task_can_be_updated_by_command(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    with TestClient(app) as client:
        todo = client.post("/api/todos", json={"title": "Publish"}).json()

        task_result = client.post(
            "/api/task-commands",
            json={"text": f'update #{todo["id"]} description to Ready for launch'},
        ).json()
        assert task_result["handled"] is True
        assert task_result["todo"]["description"] == "Ready for launch"



def test_tool_call_requires_hash_prefixed_task_ids():
    command = {"action": "duration", "task_id": 1, "minutes": 1440}

    assert _has_explicit_entity_ids("Set estimated time for #1 to 1 day", command)
    assert not _has_explicit_entity_ids("Add a new 1 day task named clean room", command)


def test_aim_creation_assignment_and_status_data(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    with TestClient(app) as client:
        aim_response = client.post(
            "/api/aims",
            json={"name": "Improve fitness", "description": "Build a healthy routine"},
        )
        assert aim_response.status_code == 201
        aim = aim_response.json()

        task_response = client.post(
            "/api/todos",
            json={"title": "Morning walk", "aim_id": aim["id"]},
        )
        assert task_response.status_code == 201
        task = task_response.json()
        assert task["aim_id"] == aim["id"]

        unassigned = client.post("/api/todos", json={"title": "Drink water"}).json()
        command = client.post(
            "/api/task-commands",
            json={"text": f"add #{unassigned['id']} to @{aim['id']}"},
        )
        assert command.status_code == 200
        assert command.json()["handled"] is True
        assert command.json()["todo"]["aim_id"] == aim["id"]

        aims = client.get("/api/aims")
        assert aims.status_code == 200
        assert aims.json() == [aim]


def test_aim_command_requires_at_prefixed_aim_id():
    command = {"action": "aim", "task_id": 4, "aim_id": 2}

    assert _has_explicit_entity_ids("add #4 to @2", command)
    assert not _has_explicit_entity_ids("add #4 to aim 2", command)
