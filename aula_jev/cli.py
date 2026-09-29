"""aula: serve the DuckMart ladder, run Jev on it with a swappable planner/decider/writer, grade the result.

  uv run aula check                          ping all three roles
  uv run aula run --level 0                  one attempt (add --headed to watch)
  uv run aula ladder                         levels 0..6, one table at the end
  uv run aula serve                          just the site, for poking at it by hand
  uv run aula laya                           start the local Laya decision server (:8000)
  uv run aula diagram [runs/x.json]           Mermaid diagram of a --capture run's exact model traffic
  uv run aula jevk5                          start the local JevK5 decision server (:8091)

Any role can be overridden per run: --planner openrouter:qwen/qwen3.8-flash --decider llamacpp:x --writer ...
"""

import argparse
import functools
import http.server
import json
import os
import subprocess
import sys
import threading
import time
import urllib.request

from .providers import CAPTURE, ROOT, Calls, chat, decide, install, load_config, resolve

SITE_PORT = 8765
CDP_PORT = 9333


# ---------------------------------------------------------------- infrastructure


def up(url):
    try:
        urllib.request.urlopen(url, timeout=1)
        return True
    except OSError:
        return False


def serve_site(port=SITE_PORT, block=False):
    base = f"http://127.0.0.1:{port}"
    if up(base + "/index.html"):
        return base
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(ROOT / "site"))
    handler.log_message = lambda *a: None
    server = http.server.ThreadingHTTPServer(("127.0.0.1", port), handler)
    if block:
        print(f"DuckMart on {base}/?level=0 … {base}/?level=6")
        server.serve_forever()
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return base


def ensure_browser(headed):
    """A dedicated Chromium with its own profile, so runs never touch the user's browser."""
    endpoint = f"http://127.0.0.1:{CDP_PORT}"
    if up(endpoint + "/json/version"):
        agent = json.loads(urllib.request.urlopen(endpoint + "/json/version", timeout=2).read())["User-Agent"]
        if ("HeadlessChrome" in agent) == headed:  # wrong mode: close our own browser (only this profile)
            subprocess.run(["pkill", "-f", "--", f"--user-data-dir={ROOT / '.browser'}"], check=False)
            for _ in range(50):
                if not up(endpoint + "/json/version"):
                    break
                time.sleep(0.1)
    if not up(endpoint + "/json/version"):
        binary = next(
            b
            for b in ("chromium", "google-chrome-stable", "brave")
            if subprocess.run(["which", b], capture_output=True).returncode == 0
        )
        args = [
            binary,
            f"--remote-debugging-port={CDP_PORT}",
            f"--user-data-dir={ROOT / '.browser'}",
            "--no-first-run",
            "--no-default-browser-check",
            "--window-size=1200,900",
            "about:blank",
        ]
        if not headed:
            args.insert(1, "--headless=new")
        subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
        for _ in range(100):
            if up(endpoint + "/json/version"):
                break
            time.sleep(0.1)
        else:
            raise RuntimeError(f"{binary} did not open a DevTools port on {CDP_PORT}")
    os.environ["BU_CDP_URL"] = endpoint
    os.environ["BU_NAME"] = "aula"


def roles(args, config):
    return {name: resolve(config, name, getattr(args, name, None)) for name in ("planner", "decider", "writer")}


# ---------------------------------------------------------------- one attempt


def attempt(level, r, config, args):
    ensure_browser(args.headed)  # before importing jev: browser-harness reads BU_* at import time
    from jev_ultrafast import Agent
    from jev_ultrafast.model import action_space

    from .planner import goal_text, make_plan
    from .task import TASK, grade

    run = config["run"]
    calls = Calls()
    CAPTURE.clear()
    install(r["decider"], r["writer"], calls)
    url = f"{serve_site()}/?level={level}&run={int(time.time())}"
    plans, errors, started = [], [], time.perf_counter()
    planning = not args.no_plan
    mode = run.get("replan", "navigate")
    print(
        f"\n=== level {level}  planner={r['planner'] if planning else 'off'}  decider={r['decider']}  writer={r['writer']}"
    )

    with Agent(url, TASK) as agent:
        st = agent.state
        if args.headed:  # jev opens its tab in the background; bring it to the front so you can watch
            from browser_harness.helpers import cdp

            cdp("Target.activateTarget", targetId=agent.browser.target)
        planned_url, since_plan, record = None, 0, None
        stalled = 0  # ticks in a row that executed nothing (covered target, page changing, bad answer)
        while True:
            page = st["page"]
            blocked = st["status"] == "blocked"
            stuck = planning and stalled >= 3
            doubtful = (
                planning
                and st["status"] == "done"
                and st["decisions"][-1]["confidence"] < run.get("done_min_confidence", 0)
            )
            want = (
                planning
                and len(plans) <= run.get("max_replans", 12)
                and (
                    planned_url is None
                    or blocked
                    or doubtful
                    or stuck
                    or (mode == "navigate" and (page["url"] != planned_url or since_plan >= run.get("replan_every", 8)))
                )
            )
            if want:
                reason = (
                    "the agent is stuck; previous plan did not work"
                    if blocked
                    else "the agent's last choices could not be executed: the target is probably covered by a "
                    "dialog or overlay, or not usable yet"
                    if stuck
                    else "the agent guessed the task is done, but is unsure; check what is still missing"
                    if doubtful
                    else None
                )
                try:
                    plan = calls.timed(
                        r["planner"],
                        make_plan,
                        r["planner"],
                        TASK,
                        page,
                        action_space(page["actions"])[0],
                        st["history"],
                        reason,
                    )
                except Exception as e:  # a planner failure keeps the previous goal
                    errors.append(f"planner: {e}")
                    plan = None
                if plan:
                    plans.append({"at_step": len(st["history"]), "url": page["url"], **plan})
                    st["goal"] = goal_text(TASK, plan)
                    print(
                        f"  plan @ {page['url'].split('#')[-1] or '/'}: "
                        + " | ".join(plan["steps"])
                        + (f"  ⚠ {plan['notes']}" if plan["notes"] else "")
                    )
                planned_url, since_plan, stalled = page["url"], 0, 0
                if blocked or doubtful:
                    st["status"] = "ready"
            if st["status"] in {"done", "blocked"}:
                break
            if len(st["history"]) >= run.get("max_steps", 60) or len(errors) >= 6:
                break
            before = len(st["history"])
            try:
                agent.command("tick")
            except Exception as e:
                errors.append(f"{type(e).__name__}: {e}")
                print(f"  ! {errors[-1]}")
                st["decision"] = None
                stalled += 1
                if st["status"] not in {"done", "blocked"}:
                    st["status"] = "ready"
                continue
            stalled = stalled + 1 if len(st["history"]) == before else 0
            for h in st["history"][before:]:
                since_plan += 1
                d = st["decisions"][-1]
                print(
                    f"  {h['step']:>2}. {h['operation']:<9} {h['action'][:70]!r}"
                    + (f" ← {h['text']!r}" if h["text"] else "")
                    + f"  p={h['probability']:.2f}  {d['latency_ms']}ms"
                )
            if st["status"] == "done":
                print(f"  DONE chosen (p={st['decisions'][-1]['confidence']:.2f})")
        try:
            record = json.loads(agent.browser.evaluate("localStorage.getItem('duckmart')") or "null")
        except Exception as e:
            errors.append(f"grade read: {e}")

    result = grade(record)
    by_role = {}
    for c in calls.log:
        entry = by_role.setdefault(c["role"], {"calls": 0, "ms": 0})
        entry["calls"] += 1
        entry["ms"] += c["ms"]
    summary = {
        "level": level,
        **result,
        "status": st["status"],
        "steps": len(st["history"]),
        "seconds": round(time.perf_counter() - started, 1),
        "calls": by_role,
        "errors": errors,
        "roles": {k: str(v) for k, v in r.items()},
        "planner_on": planning,
    }
    out = ROOT / "runs" / f"{time.strftime('%Y%m%d-%H%M%S')}-L{level}.json"
    out.parent.mkdir(exist_ok=True)
    trace = {
        "summary": summary,
        "plans": plans,
        "history": st["history"],
        "site_record": record,
        "decisions": [
            {k: d.get(k) for k in ("operation", "target", "choice", "confidence", "latency_ms")}
            for d in st["decisions"]
        ],
    }
    if args.capture:
        trace["exchanges"] = CAPTURE
    out.write_text(json.dumps(trace, indent=1, default=str))
    verdict = (
        "✅ correct order"
        if result["correct"]
        else "🟡 order placed, with mistakes"
        if result["placed"]
        else f"❌ stopped at {result['reached']}"
    )
    print(
        f"  → {verdict}  {summary['steps']} steps, {summary['seconds']}s  {result['mistakes'] or ''}  trace: {out.relative_to(ROOT)}"
    )
    return summary


# ---------------------------------------------------------------- commands


def cmd_check(args, config):
    r = roles(args, config)
    for name, role in r.items():
        started = time.perf_counter()
        try:
            if name == "decider":
                answer = decide(
                    role,
                    {
                        "state": {"page": "A shop. The cart has 1 duck. Button [1] Checkout, [2] Help."},
                        "questions": {
                            "op": {
                                "type": "choice",
                                "instructions": "Goal: buy the duck. Next?",
                                "criteria": {"1": "Checkout", "2": "Help"},
                            }
                        },
                    },
                )
                reply = answer["answers"]["op"]["choice"] + f" {answer['answers']['op']['probabilities']}"
            else:
                reply, _ = chat(role, [{"role": "user", "content": 'Reply with JSON {"ok": true}'}], max_tokens=50)
            print(f"✅ {name:<8} {role}  {round((time.perf_counter() - started) * 1000)}ms  {reply.strip()[:80]}")
        except Exception as e:
            print(f"❌ {name:<8} {role}  {e}")


def cmd_run(args, config):
    attempt(args.level, roles(args, config), config, args)


def cmd_ladder(args, config):
    r = roles(args, config)
    low, _, high = args.levels.partition("-")
    results = []
    for level in range(int(low), int(high or low) + 1):
        for _ in range(args.repeat):
            results.append(attempt(level, r, config, args))
    print("\nlevel  result                 reached        steps   secs  decider ms/call  mistakes")
    for s in results:
        verdict = "correct" if s["correct"] else "placed w/ mistakes" if s["placed"] else "stuck"
        dec = s["calls"].get("decider", {"calls": 0, "ms": 0})
        per = dec["ms"] // dec["calls"] if dec["calls"] else 0
        print(
            f"{s['level']:>5}  {verdict:<21}  {s['reached']:<13}  {s['steps']:>5}  {s['seconds']:>5}  {per:>15}  "
            + "; ".join(s["mistakes"])[:80]
        )


def cmd_serve(args, config):
    serve_site(args.port, block=True)


def cmd_laya(args, config):
    env = {
        "LAYA_HOST": "127.0.0.1",
        "LAYA_PORT": "8000",
        "LAYA_DEVICE": "cuda",
        "LAYA_PRELOAD": "1",
        "LAYA_MODELS": "multilingual,english",
        **os.environ,
    }
    os.execvpe(str(ROOT / ".venv/bin/laya-serve"), ["laya-serve"], env)


def cmd_diagram(args, config):
    from .diagram import write

    trace = args.trace or max((ROOT / "runs").glob("*.json"), key=lambda p: p.stat().st_mtime)
    print(write(trace, args.out))


def cmd_jevk5(args, config):
    # Its own venv (servers/jevk5): its torch/transformers pins differ from Laya's.
    binary = ROOT / "servers/jevk5/bin/jevk5-serve"
    os.execv(str(binary), [str(binary), "--model", args.model, "--port", "8091"])


def main():
    sys.stdout.reconfigure(line_buffering=True)  # stream progress even when piped to a file
    parser = argparse.ArgumentParser(
        prog="aula", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--config", help="config.toml path")
    sub = parser.add_subparsers(dest="command", required=True)
    for name, fn in [
        ("check", cmd_check),
        ("run", cmd_run),
        ("ladder", cmd_ladder),
        ("serve", cmd_serve),
        ("laya", cmd_laya),
        ("jevk5", cmd_jevk5),
        ("diagram", cmd_diagram),
    ]:
        p = sub.add_parser(name)
        p.set_defaults(fn=fn)
        if name in {"check", "run", "ladder"}:
            for role in ("planner", "decider", "writer"):
                p.add_argument(f"--{role}", metavar="PROVIDER[:MODEL]", help=f"override the {role} role")
        if name in {"run", "ladder"}:
            p.add_argument("--headed", action="store_true", help="show the browser window")
            p.add_argument("--no-plan", action="store_true", help="baseline: give Jev the raw task, no planner")
            p.add_argument("--capture", action="store_true", help="save every model request/response body in the trace")
        if name == "run":
            p.add_argument("--level", type=int, default=0)
        if name == "ladder":
            p.add_argument("--levels", default="0-6", help="e.g. 0-6 or 3")
            p.add_argument("--repeat", type=int, default=1)
        if name == "diagram":
            p.add_argument("trace", nargs="?", help="runs/<file>.json captured with --capture (default: newest)")
            p.add_argument("--out", help="default docs/exchanges.md")
        if name == "jevk5":
            p.add_argument("--model", default="alibiserikbay/JevK5-9B", help="or alibiserikbay/JevK5 (4B, ~9 GB)")
        if name == "serve":
            p.add_argument("--port", type=int, default=SITE_PORT)
    args = parser.parse_args()
    args.fn(args, load_config(args.config))
