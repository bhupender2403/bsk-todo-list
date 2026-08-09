import os

os.environ["DATABASE_URL"] = "sqlite://"

from fastapi.testclient import TestClient

from app.database import Base, engine
from app.main import app


def setup_function():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)


def test_todo_lifecycle():
    with TestClient(app) as client:
        created = client.post("/api/todos", json={"title": "  Ship the app  "})
        assert created.status_code == 201
        todo = created.json()
        assert todo["title"] == "Ship the app"
        assert todo["completed"] is False

        listed = client.get("/api/todos")
        assert listed.status_code == 200
        assert len(listed.json()) == 1

        updated = client.patch(
            f"/api/todos/{todo['id']}", json={"completed": True}
        )
        assert updated.status_code == 200
        assert updated.json()["completed"] is True

        deleted = client.delete(f"/api/todos/{todo['id']}")
        assert deleted.status_code == 204
        assert client.get("/api/todos").json() == []


def test_rejects_blank_title():
    with TestClient(app) as client:
        response = client.post("/api/todos", json={"title": "   "})
        assert response.status_code == 422
