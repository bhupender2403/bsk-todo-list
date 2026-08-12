import json
import os
import re
from datetime import date, timedelta
from typing import Dict, List, Optional

from langgraph.graph import END, START, StateGraph
from typing_extensions import TypedDict


class DetectionState(TypedDict, total=False):
    text: str
    answers: Dict[str, str]
    task_names: List[str]
    loaded_task_id: Optional[int]
    loaded_aim_id: Optional[int]
    suggestion: Dict[str, object]
    clarification_questions: List[str]
    ai_powered: bool
    analysis_source: str


def extract_task(state: DetectionState) -> DetectionState:
    combined = state["text"]
    if state.get("answers"):
        combined += "\nClarifications:\n" + "\n".join(state["answers"].values())
    ai_suggestion = _openai_extract(combined, state)
    suggestion = ai_suggestion or _fallback_extract(combined, state)
    return {
        "suggestion": suggestion,
        "ai_powered": ai_suggestion is not None,
        "analysis_source": (
            os.getenv("OPENAI_MODEL", "gpt-4.1-mini")
            if ai_suggestion is not None
            else "local"
        ),
    }


def find_clarifications(state: DetectionState) -> DetectionState:
    suggestion = state["suggestion"]
    answers = state.get("answers", {})
    questions = []
    start_question = "When should this task start? You can also say that it should remain pending."
    duration_question = "How long do you expect this task to take?"
    if not suggestion.get("start_date") and start_question not in answers:
        questions.append(start_question)
    if not suggestion.get("expected_duration_days") and not suggestion.get("expected_duration_hours") and duration_question not in answers:
        questions.append(duration_question)
    return {"clarification_questions": questions[:3]}


def _openai_extract(text: str, state: DetectionState) -> Optional[Dict[str, object]]:
    if not os.getenv("OPENAI_API_KEY"):
        return None
    try:
        from openai import OpenAI

        prompt = """Extract a task from the user's text. Return JSON only with these keys:
title, description, start_date, expected_duration_days,
expected_duration_hours, dependency_names. start_date must be YYYY-MM-DD
or null. Durations must be non-negative numbers and
dependency_names must be an array. Use only the supplied existing task names
when selecting relationships. Do not invent details.

Existing tasks: {tasks}
Today: {today}
User text:
{text}

Loaded editor context: task #{loaded_task_id}, aim @{loaded_aim_id}.
If the user asks to create, add, or make a new task or aim, ignore both loaded IDs.
Otherwise, when the request refers ambiguously to "the task" or "the aim", assume it refers to the loaded entity.
This extraction endpoint creates task drafts; do not turn an aim update into a new task.""".format(
            tasks=", ".join(state.get("task_names", [])),
            today=date.today().isoformat(),
            text=text,
            loaded_task_id=state.get("loaded_task_id") or "none",
            loaded_aim_id=state.get("loaded_aim_id") or "none",
        )
        response = OpenAI().responses.create(
            model=os.getenv("OPENAI_MODEL", "gpt-4.1-mini"), input=prompt
        )
        content = response.output_text.strip()
        if content.startswith("```"):
            content = re.sub(r"^```(?:json)?\s*|\s*```$", "", content)
        return _normalize(json.loads(content), state)
    except Exception:
        return None


def _fallback_extract(text: str, state: DetectionState) -> Dict[str, object]:
    clean = " ".join(text.split())
    first_sentence = re.split(r"[.!?]", clean, maxsplit=1)[0].strip()
    title = first_sentence[:200] or "New task"
    lowered = clean.lower()
    start_date = None
    date_match = re.search(r"\b(20\d{2}-\d{2}-\d{2})\b", clean)
    if date_match:
        start_date = date_match.group(1)
    elif "tomorrow" in lowered:
        start_date = (date.today() + timedelta(days=1)).isoformat()
    elif "today" in lowered:
        start_date = date.today().isoformat()

    days = _number_before(r"days?", lowered)
    hours = _number_before(r"hours?|hrs?", lowered)
    matching_tasks = [
        name for name in state.get("task_names", []) if name.lower() in lowered
    ]
    dependencies = [
        name
        for name in matching_tasks
        if re.search(r"(?:depends on|after|blocked by)\s+" + re.escape(name.lower()), lowered)
    ]
    return {
        "title": title,
        "description": clean,
        "start_date": start_date,
        "expected_duration_days": days,
        "expected_duration_hours": hours,
        "dependency_names": dependencies,
    }


def _number_before(unit_pattern: str, text: str) -> int:
    match = re.search(r"\b(\d+)\s*(?:" + unit_pattern + r")\b", text)
    return int(match.group(1)) if match else 0


def _normalize(value: Dict[str, object], state: DetectionState) -> Dict[str, object]:
    tasks = state.get("task_names", [])
    raw_dependencies = value.get("dependency_names") or []
    dependencies = [name for name in raw_dependencies if name in tasks]
    return {
        "title": str(value.get("title") or "New task")[:200],
        "description": str(value.get("description") or "")[:5000],
        "start_date": value.get("start_date"),
        "expected_duration_days": max(0, int(value.get("expected_duration_days") or 0)),
        "expected_duration_hours": max(0, int(value.get("expected_duration_hours") or 0)),
        "dependency_names": dependencies,
    }


builder = StateGraph(DetectionState)
builder.add_node("extract_task", extract_task)
builder.add_node("find_clarifications", find_clarifications)
builder.add_edge(START, "extract_task")
builder.add_edge("extract_task", "find_clarifications")
builder.add_edge("find_clarifications", END)
task_detection_graph = builder.compile()
