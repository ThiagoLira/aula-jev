"""Render a captured run (`aula run --capture`) as a Mermaid sequence diagram of the exact model traffic.

Nothing here is paraphrased: every note is a request or response body as it went over the wire,
taken from the trace's "exchanges". One example of each exchange kind is shown (the first planner
call, and the first TYPE_TEXT step: its decider call and the writer call it triggered).
"""

import json
import textwrap
from pathlib import Path

from .providers import ROOT

# Mermaid entity codes, applied in one pass so no escape is escaped again.
ENTITIES = str.maketrans({"&": "#38;", "#": "#35;", ";": "#59;", "<": "#60;", ">": "#62;"})


def esc(text, width=110):
    """Mermaid note text: wrap long lines (continuations keep their indent), escape syntax, <br/> newlines."""
    lines = []
    for line in text.split("\n"):
        indent = len(line) - len(line.lstrip())
        lines += textwrap.wrap(
            line, width, subsequent_indent=" " * (indent + 2), drop_whitespace=False, break_on_hyphens=False
        ) or [""]
    return "<br/>".join(line.translate(ENTITIES) for line in lines)


def pretty(value):
    return json.dumps(value, indent=1, ensure_ascii=False)


def messages(request):
    """Chat bodies: show each message's content as real text, not as an escaped JSON string."""
    head = {k: v for k, v in request.items() if k != "messages"}
    parts = [pretty(head)]
    for m in request["messages"]:
        content = m["content"]
        try:
            content = pretty(json.loads(content))
        except (TypeError, ValueError):
            pass
        parts.append(f"── {m['role']} ──\n{content}")
    return "\n".join(parts)


def reply(response):
    content = response["choices"][0]["message"]["content"]
    try:
        content = pretty(json.loads(content))
    except (TypeError, ValueError):
        pass
    return f"── assistant ──\n{content}"


def render(trace_path):
    trace = json.loads(Path(trace_path).read_text())
    ex = trace.get("exchanges")
    if not ex:
        raise SystemExit("This trace has no exchanges: run with --capture")
    roles = trace["summary"]["roles"]
    planner_model = roles["planner"].split(":", 1)[1].rsplit(" (", 1)[0]
    writer_model = roles["writer"].split(":", 1)[1].rsplit(" (", 1)[0]
    chats = [(i, e) for i, e in enumerate(ex) if e["url"].endswith("/chat/completions")]
    _, plan = next((i, e) for i, e in chats if e["request"]["model"] == planner_model)
    write_i, write = next(((i, e) for i, e in chats if e["request"]["model"] == writer_model), (None, None))
    decide_i = max(
        (i for i, e in enumerate(ex[: write_i or len(ex)]) if e["url"].endswith("/v1/systemone")),
        default=next(i for i, e in enumerate(ex) if e["url"].endswith("/v1/systemone")),
    )
    decide = ex[decide_i]
    step = next((h for h in trace["history"] if h["kind"] == "fill"), trace["history"][0])
    s = trace["summary"]

    lines = [
        '%%{init: {"sequence": {"noteAlign": "left"}}}%%',
        "sequenceDiagram",
        "    autonumber",
        "    participant H as Harness (aula + jev-ultrafast loop)",
        "    participant B as Browser (Chromium via CDP)",
        f"    participant P as Planner<br/>{esc(roles['planner'])}",
        f"    participant D as Decider (Jev role)<br/>{esc(roles['decider'])}",
        f"    participant W as Writer<br/>{esc(roles['writer'])}",
        "    H->>B: open DuckMart ?level=" + str(s["level"]) + ", run snapshot.js",
        "    B-->>H: visible text + indexed elements (node ids stay in the harness)",
        "    rect rgba(120,120,255,0.08)",
        "    Note over H,P: once per screen (and after every action when replan_every = 1)",
        f"    H->>P: POST {esc(plan['url'])}",
        f"    Note right of H: {esc(messages(plan['request']))}",
        "    P-->>H: plan JSON",
        f"    Note right of H: {esc(reply(plan['response']))}",
        "    H->>H: goal = task + plan (numbered steps + warning)",
        "    end",
        "    rect rgba(120,255,120,0.08)",
        "    Note over H,D: every step: one request, operation head + one target head per operation",
        f"    H->>D: POST {esc(decide['url'])}",
        f"    Note right of H: {esc(pretty(decide['request']))}",
        "    D-->>H: probabilities per head",
        f"    Note right of H: {esc(pretty(decide['response']))}",
        "    H->>H: validate: choice in offered ids, probabilities sum to 1, choice is the argmax",
        "    end",
    ]
    if write:
        lines += [
            "    rect rgba(255,200,120,0.12)",
            "    Note over H,W: only when the chosen operation is TYPE_TEXT",
            f"    H->>W: POST {esc(write['url'])}",
            f"    Note right of H: {esc(messages(write['request']))}",
            "    W-->>H: field value",
            f"    Note right of H: {esc(reply(write['response']))}",
            "    end",
        ]
    lines += [
        f"    H->>B: execute on the observed node: {esc(step['kind'])} {esc(repr(step['action']))}"
        + (f" ← {esc(repr(step['text']))}" if step.get("text") else ""),
        "    B-->>H: new snapshot (fingerprint changed?) → next step",
        "    Note over H,B: after DONE / BLOCKED / budget: grade from the site's own record",
        "    H->>B: localStorage.getItem('duckmart')",
        f"    B-->>H: order record → {esc('correct' if s['correct'] else 'placed with mistakes' if s['placed'] else 'stopped at ' + s['reached'])}",
    ]
    counts = {}
    for e in ex:
        kind = (
            "decider"
            if e["url"].endswith("/v1/systemone")
            else "planner"
            if e["request"].get("model") == planner_model
            else "writer"
        )
        counts[kind] = counts.get(kind, 0) + 1
    header = (
        f"# Model traffic, level {s['level']}\n\nGenerated by `uv run aula diagram {Path(trace_path).name}` "
        f"from a captured run. Every note is the exact body sent or received (API keys travel only in "
        f"headers and are never captured). This run made {counts.get('planner', 0)} planner, "
        f"{counts.get('decider', 0)} decider and {counts.get('writer', 0)} writer calls in "
        f"{s['steps']} browser actions; one of each is shown.\n\n"
    )
    return header + "```mermaid\n" + "\n".join(lines) + "\n```\n"


def write(trace_path, out=None):
    out = Path(out or ROOT / "docs" / "exchanges.md")
    out.parent.mkdir(exist_ok=True)
    out.write_text(render(trace_path))
    return out
