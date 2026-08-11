import re
from datetime import datetime, timedelta
from typing import Dict, Optional


def parse_task_command(text: str) -> Optional[Dict[str, object]]:
    command = " ".join(text.strip().rstrip(".!?").split())

    match = re.fullmatch(r"set #(?P<parent>\d+) as parent of #(?P<task>\d+)", command, re.I)
    if match:
        return {
            "action": "parent",
            "task_id": int(match["task"]),
            "parent_id": int(match["parent"]),
        }

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
        now = datetime.now()
        when = match["when"].lower()
        start_time = now if when == "now" else (now + timedelta(days=1 if when == "tomorrow" else 3)).replace(hour=0, minute=0, second=0, microsecond=0)
        return {
            "action": "start",
            "task_id": int(match["task"]),
            "start_time": start_time,
            "when": when,
        }

    return None
