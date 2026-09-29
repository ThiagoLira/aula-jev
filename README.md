# aula-jev 🦆

A ladder of increasingly obnoxious fake web shops (**DuckMart**), and a harness that drives
[jev-ultrafast](https://github.com/browser-use/jev-ultrafast) through them with three swappable models:

| Role | Job | Default | Protocol |
|---|---|---|---|
| **planner** | reads the screen, writes the next steps for *this* screen, warns about traps | OpenRouter `google/gemini-3.8-flash` | OpenAI-compatible chat |
| **decider** | the Jev role: picks operation + element every step, as probabilities | local [JevK5-9B](https://github.com/allebee/jevk5) | `/v1/systemone` (or a chat model emulating it) |
| **writer** | writes the value for `TYPE_TEXT` fields | OpenRouter `inception/mercury-2.5` | OpenAI-compatible chat |

The exact traffic between them is in [docs/exchanges.md](docs/exchanges.md) (a Mermaid diagram generated from a real captured run).

## Setup

```bash
uv sync --extra laya                 # harness + the Laya decider
export OPENROUTER_API_KEY=...        # planner and writer
uv run aula jevk5 &                  # local JevK5-9B on :8091 (first start downloads ~19 GB; its own venv, see below)
uv run aula laya &                   # optional: local Laya on :8000
uv run aula check                    # ping all three roles
```

JevK5 lives in its own venv because its torch/transformers pins differ from Laya's:

```bash
uv venv servers/jevk5 --python 3.12
VIRTUAL_ENV=servers/jevk5 uv pip install "jevk5[fast] @ git+https://github.com/allebee/jevk5@v0.3.0"
```

Runs use a dedicated Chromium (`.browser/` profile, DevTools on :9333, headless unless `--headed`);
your own browser is never touched.

## Run

```bash
uv run aula run --level 0 --headed         # watch one attempt
uv run aula ladder                          # levels 0..6, table at the end
uv run aula ladder --levels 2-4 --repeat 3
uv run aula run --level 3 --no-plan         # baseline: Jev gets the raw task, no planner
uv run aula run --level 1 --capture && uv run aula diagram    # regenerate docs/exchanges.md
uv run aula serve                           # poke at http://127.0.0.1:8765/?level=5 yourself
```

Every run writes `runs/<time>-L<level>.json`: summary, plans, every executed action, every decision,
the site's own record of what happened, and with `--capture` every request/response body.

## Swapping models

Everything is in [config.toml](config.toml): providers (URL, key env var, protocol) and roles
(provider + model + extra body fields). Override any role per run with `provider:model`:

```bash
uv run aula ladder --planner openrouter:anthropic/claude-opus-5.5
uv run aula ladder --decider laya:english          # the small encoder (set shape = "compact", see below)
uv run aula ladder --decider openrouter:qwen/qwen3.8-flash   # any chat model can play Jev (one-hot answers)
uv run aula ladder --decider typesafe:jev-latest   # the real thing, with TYPESAFE_API_KEY
uv run aula ladder --writer llamacpp:local         # your llama-server on :8080
```

- `protocol = "systemone"` speaks the Jev wire API: TypeSafe Jev, JevK5, Laya, OpenJev, Codiv…
- `protocol = "chat"` on the decider emulates `/v1/systemone` with a chat completion.
- `shape = "compact"` (decider) reshapes jev's request for small encoders: the plan becomes the state
  and each head gets one short question. Laya is near-random on jev's full request.
- `[run] replan` / `replan_every` / `done_min_confidence` control how often the planner steps in.

## The ladder

Same task every level: 2 plain rubber ducks, no warranty, necessary cookies only, no newsletter,
Ada Lovelace's details, cheapest shipping, pay with "Good vibes". Annoyances stack:

| Level | Adds |
|---|---|
| 0 | nothing: a plain shop (the dummy page) |
| 1 | cookie wall, a newsletter popup that waits for its moment |
| 2 | decoy giant buttons, the real one a grey 11px link; pre-checked warranty with a double negative; shuffled quantities; confirmshaming; expensive shipping pre-selected |
| 3 | last name before first name, confirm e-mail, digits-only phone, pre-checked spam box, fake countries, terms you must scroll through |
| 4 | traffic-light captcha, then "select all bicycles" (there are none, but there is a unicycle); three "are you sure?" dialogs with swapped buttons |
| 5 | catalog only visible through search autocomplete; buttons with countdowns; loading curtains; a survey whose × opens survey 2; dialogs no longer make the page behind them inert |
| 6 | div soup: unlabeled inputs and a Continue "button" that is a `<div>` |

Grading never trusts the agent's DONE: the site records every screen, trap and the final order in
`localStorage`, and [task.py](aula_jev/task.py) compares that order field by field.

## First results (2026-09-28)

planner `gemini-3.8-flash` · decider `JevK5-9B` (local, RTX 5090) · writer `mercury-2.5` · re-plan after every action

| Level | Result | Steps | Time | Notes |
|---|---|---|---|---|
| 0 | ✅ correct | 15 | 63 s | |
| 1 | ✅ correct | 17 | 57 s | |
| 2 | ✅ correct | 23 | 72 s | found "manage options" and unchecked every cookie; unchecked the double-negative warranty |
| 3 | 🟡 placed | 29 | 88 s | shipping left on the pre-selected Express: the planner said "select Standard", the decider skipped it |
| 4 | ✅ correct | 39 | 138 s | solved both captchas ("a unicycle is not a bicycle") and all three swapped "are you sure?" dialogs |
| 5 | 🟡 placed | 39 | 120 s | same Express miss, and one cookie left on |
| 6 | ❌ stuck at cart | 60 | 264 s | the `<div>` Continue button is invisible to jev's snapshot: the designed wall |

What it took to get there:
- **Laya (421M) can't play Jev here.** On jev's full request its target head is near uniform, and it picks
  the logo even when told by name which button to press. With `shape = "compact"` it gets through
  most of level 0, then clicks "Standard shipping" 20 times while the planner asks for "Good vibes".
- **JevK5-9B works on the full, unmodified jev request** (p ≈ 0.95–1.00 on planned elements, ~450 ms/decision).
- Harness fixes that mattered: answer one-option questions locally (JevK5 refuses them); re-plan when
  3 ticks in a row execute nothing (a popup covering the target); re-plan on a DONE below 0.6 confidence;
  have the planner state checkbox end states ("uncheck Marketing"), since jev will not toggle what it thinks is right.
