import json
import os
import re
from datetime import datetime, timedelta
from typing import Dict, Optional


TASK_TOOLS = [
    {"type": "function", "function": {"name": "add_dependency", "description": "Make a task depend on another existing task.", "parameters": {"type": "object", "properties": {"task_id": {"type": "integer"}, "dependency_id": {"type": "integer"}}, "required": ["task_id", "dependency_id"], "additionalProperties": False}}},
    {"type": "function", "function": {"name": "rename_task", "description": "Change the name or title of an existing task.", "parameters": {"type": "object", "properties": {"task_id": {"type": "integer"}, "title": {"type": "string"}}, "required": ["task_id", "title"], "additionalProperties": False}}},
    {"type": "function", "function": {"name": "set_estimated_duration", "description": "Set a task's estimated duration in days and hours.", "parameters": {"type": "object", "properties": {"task_id": {"type": "integer"}, "days": {"type": "integer", "minimum": 0}, "hours": {"type": "integer", "minimum": 0}}, "required": ["task_id", "days", "hours"], "additionalProperties": False}}},
    {"type": "function", "function": {"name": "set_start_time", "description": "Set a task start time using a supported relative date.", "parameters": {"type": "object", "properties": {"task_id": {"type": "integer"}, "when": {"type": "string", "enum": ["now", "tomorrow", "three days from now"]}}, "required": ["task_id", "when"], "additionalProperties": False}}},
]


def resolve_task_command(text: str):
    if os.getenv("OPENAI_API_KEY"):
        command = _openai_task_command(text)
        if command is not None:
            return command, os.getenv("OPENAI_MODEL", "gpt-4.1-mini")
    return parse_task_command(text), "local"


def _openai_task_command(text: str) -> Optional[Dict[str, object]]:
    try:
        from openai import OpenAI

        response = OpenAI().chat.completions.create(
            model=os.getenv("OPENAI_MODEL", "gpt-4.1-mini"),
            messages=[
                {"role": "system", "content": "Select a task mutation tool only when the user clearly asks to update an existing task. A task ID is valid only when written explicitly as # followed by digits. Never infer a task ID from an unprefixed number, date, duration, position, or name. Otherwise do not call a tool."},
                {"role": "user", "content": text},
            ],
            tools=TASK_TOOLS,
            tool_choice="auto",
        )
        calls = response.choices[0].message.tool_calls or []
        if len(calls) != 1:
            return None
        call = calls[0].function
        command = _command_from_tool_call(call.name, json.loads(call.arguments))
        return command if command is not None and _has_explicit_task_ids(text, command) else None
    except Exception:
        return None


def _command_from_tool_call(name: str, arguments: Dict[str, object]) -> Optional[Dict[str, object]]:
    task_id = int(arguments["task_id"])
    if name == "add_dependency":
        return {"action": "dependency", "task_id": task_id, "dependency_id": int(arguments["dependency_id"])}
    if name == "rename_task":
        return {"action": "rename", "task_id": task_id, "title": str(arguments["title"])}
    if name == "set_estimated_duration":
        return {"action": "duration", "task_id": task_id, "minutes": int(arguments["days"]) * 1440 + int(arguments["hours"]) * 60}
    if name == "set_start_time":
        return _start_command(task_id, str(arguments["when"]))
    return None


def _has_explicit_task_ids(text: str, command: Dict[str, object]) -> bool:
    referenced_ids = {
        int(value)
        for key, value in command.items()
        if key in {"task_id", "dependency_id"}
    }
    return bool(referenced_ids) and all(
        re.search(rf"#\s*{task_id}\b", text) is not None for task_id in referenced_ids
    )


def _start_command(task_id: int, when: str) -> Dict[str, object]:
    now = datetime.now()
    start_time = now if when == "now" else (now + timedelta(days=1 if when == "tomorrow" else 3)).replace(hour=0, minute=0, second=0, microsecond=0)
    return {"action": "start", "task_id": task_id, "start_time": start_time, "when": when}


def parse_task_command(text: str) -> Optional[Dict[str, object]]:
    command = " ".join(text.strip().rstrip(".!?").split())

    match = re.fullmatch(
        r"(?:set )?#(?P<task>\d+) depends? on #(?P<dependency>\d+)",
        command,
        re.I,
    )
    if match:
        return {
            "action": "dependency",
            "task_id": int(match["task"]),
            "dependency_id": int(match["dependency"]),
        }

    match = re.fullmatch(r"update #(?P<task>\d+) name to (?P<title>.+)", command, re.I)
    if match:
        return {
            "action": "rename",
            "task_id": int(match["task"]),
            "title": match["title"].strip(),
        }

    match = re.fullmatch(
        r"set #(?P<task>\d+) estimated time to"
        r"(?: (?P<days>\d+) days?)?(?: (?P<hours>\d+) hours?)?",
        command,
        re.I,
    )
    if match and (match["days"] or match["hours"]):
        return {
            "action": "duration",
            "task_id": int(match["task"]),
            "minutes": int(match["days"] or 0) * 1440 + int(match["hours"] or 0) * 60,
        }

    match = re.fullmatch(
        r"set #(?P<task>\d+) start time to (?P<when>now|tomorrow|three days from now)",
        command,
        re.I,
    )
    if match:
        when = match["when"].lower()
        return _start_command(int(match["task"]), when)

    return None
