# ADK Travel Agent (TypeScript)

A multi-agent travel booking assistant built with the [Google Agent Development Kit (ADK)](https://github.com/google/adk) TypeScript SDK. Specialized sub-agents handle flight booking, hotel booking, and trip summarization.

It is instrumented with [Monocle](https://github.com/monocle2ai/monocle) for distributed tracing, exporting spans to a local file and/or [Okahu](https://www.okahu.ai/).

## What it does

Given a natural-language travel request (e.g. *"Book me a flight from SFO to BOM and a stay at Marriott in Mumbai"*), the agent:

1. Parses the request and asks for any missing details.
2. Books the flight.
3. Books the hotel.
4. Summarizes the final itinerary in one sentence.

Booking tools are mocked — they return success messages without calling any real booking API — so the project is safe to run end-to-end for demos and development.

## Two orchestration approaches

The same three sub-agents are wired up two different ways, so you can compare how each shape behaves and traces. Each variant is a self-contained agent module plus an entry point:

| | Sequential (default) | LLM orchestrator |
| --- | --- | --- |
| Agent module | [`src/agents-sequential.ts`](src/agents-sequential.ts) | [`src/agents-orchestrator.ts`](src/agents-orchestrator.ts) |
| Entry point | [`src/main-sequential.ts`](src/main-sequential.ts) | [`src/main-orchestrator.ts`](src/main-orchestrator.ts) |
| Root agent | `SequentialAgent` | `LlmAgent` |
| Control flow | Fixed order: flight → hotel → summary. Every sub-agent runs on every turn. | The supervisor LLM decides which sub-agents to call, and in what order. |
| Sub-agents wired as | `subAgents` | `AgentTool` (each sub-agent is a tool) |
| Run it | `npm start` | `npm run start:orchestrator` |

Both export a `rootAgent` under the same name (`adk_supervisor_agent`), and both entry points feed it to the shared CLI in [`src/runner.ts`](src/runner.ts).

The two variants also give the summary agent different instructions, because their failure modes differ. In the orchestrator variant the supervisor collects missing details itself before calling any booking tool. In the sequential variant there is no supervisor to do that, so the summary agent is instructed to relay any pending question from the booking agents back to the user instead of replying that it cannot summarize.

## The agents

| Agent | Role |
| --- | --- |
| `adk_supervisor_agent` (root) | Coordinates the workflow. Either a `SequentialAgent` or an orchestrating `LlmAgent` depending on the variant. |
| `adk_flight_booking_agent` | Handles flight booking only. Calls `adk_book_flight`. |
| `adk_hotel_booking_agent` | Handles hotel booking only. Calls `adk_book_hotel`. Applies a domain rule: Marriott is only available on odd dates; otherwise defaults to Hilton. |
| `adk_trip_summary_agent` | Produces the final one-sentence message. Writes to the `booking_summary` output key. |

All sub-agents are `LlmAgent`s backed by Gemini, using the model in `GOOGLE_GENAI_MODEL` and capped at `MAX_OUTPUT_TOKENS`.

Tools ([`src/tools.ts`](src/tools.ts)) are defined with `FunctionTool` and Zod v4 schemas:

- `adk_book_flight(from_airport, to_airport)`
- `adk_book_hotel(hotel_name, city)`

## Running a turn

[`src/runner.ts`](src/runner.ts) holds the CLI shared by both entry points. `runCliWithSession` builds one `InMemoryRunner`, creates an explicit session in the in-memory session service, and drives the agent with `runAsync` against that session id — mirroring the Python project.

Because the session id is reused across turns, interactive mode is a **multi-turn conversation**: the agent keeps full context until you type `exit` or `quit`. Each `runAsync` call is still its own trace, so one trace equals one turn.

Passing a request as a CLI argument runs a single turn and exits.

> The file also exports an older `runCli` that uses `runEphemeral` for a one-shot, session-less turn. Nothing calls it — the entry points both use `runCliWithSession`.

## Tracing (Monocle → Okahu)

There is no tracing code in `src/` at all — instrumentation is pure configuration. `.env` carries:

```bash
NODE_OPTIONS=--import monocle2ai/register
MONOCLE_WORKFLOW_NAME=adk-travel-agent-typescript
```

Node applies `NODE_OPTIONS` from an env file *before* it loads the app, so the `monocle2ai/register` preload runs `setupMonocle(MONOCLE_WORKFLOW_NAME)` ahead of the entry point's first `require`. `setupMonocle` installs a CommonJS `require`-hook, and because it is in place before ADK is ever loaded, the hook transparently wraps ADK and the underlying `@google/genai` SDK. Every agent run, tool call, and LLM request emits a span with **no tracing code in the agent logic itself**. This is also why the entry points use `require` instead of `import` — `require()` runs inline rather than being hoisted, keeping the load order predictable.

`MONOCLE_WORKFLOW_NAME` is the name traces are filed under, in both the local filenames and Okahu. The [test suite](#testing-against-traces) has to be pointed at the same name.

> **Gotcha:** the preload only takes effect for scripts that pass the env file to Node — `npm start`, `npm run start:orchestrator` and `npm run dev*` use `--env-file=.env`, so they are traced. `npm run start:sequential` does not, and its in-process `require('dotenv/config')` sets `NODE_OPTIONS` far too late to matter, so **that script produces no traces**. Use `npm start` when you are collecting traces to test against.

Spans are exported per the `MONOCLE_EXPORTER` env var:

- `file` — written to `./.monocle/monocle_trace_*.json` (handy for local inspection).
- `okahu` — POSTed to the `OKAHU_INGESTION_ENDPOINT` using `OKAHU_API_KEY`.

A run produces this span tree:

```
workflow                    [workflow]
└─ adk.runner.run_async     [agentic.turn]
   └─ adk.agent.run         [agentic.invocation]
      ├─ gemini.generate_content   [inference]
      └─ adk.tool                  [agentic.tool.invocation]
```

> **Note:** Monocle batches spans and flushes them asynchronously, so a run does not write its trace the instant it prints an answer. The `monocle2ai/register` preload holds the event loop open on `beforeExit` for `MONOCLE_FLUSH_MS` (default 6000 ms) to give that flush time to land, which is why the process lingers a few seconds before exiting. A hard `Ctrl-C`/`SIGTERM` skips the hold and can drop buffered spans — so let a run exit on its own when you are collecting a trace to test against.

## Project layout

```
src/
  main-sequential.ts     # Entry point — Monocle bootstrap + SequentialAgent variant (default)
  main-orchestrator.ts   # Entry point — Monocle bootstrap + LLM-orchestrator variant
  agents-sequential.ts   # Agent definitions composed with SequentialAgent
  agents-orchestrator.ts # Agent definitions composed with an LlmAgent supervisor + AgentTool
  runner.ts              # Shared CLI: session creation, run loop, event handling
  tools.ts               # FunctionTool definitions with Zod schemas
tests/
  conftest.py            # Loads .env.test and puts the project root on sys.path
  test_ts_adk_travel_agent_fluent.py   # Trace assertions for a flight-booking turn
  .monocle/test_traces/  # Traces of the test run itself (created at runtime)
.monocle/                # Local span output (created at runtime when MONOCLE_EXPORTER includes "file")
.env.example             # Template for the agent's env vars
.env.test.example        # Template for the test suite's env vars
requirements.txt         # Python test dependencies
tsconfig.json
package.json
LICENSE
```

## Libraries used

- **`@google/adk`** (`^0.6.0`) — the Agent Development Kit; provides `LlmAgent`, `SequentialAgent`, `AgentTool`, `FunctionTool`, `InMemoryRunner`, and event helpers.
- **`@google/adk-devtools`** (`^0.6.0`) — provides the `adk` CLI (`adk run`, `adk web`).
- **`zod`** (`^4.3.6`) — tool parameter schemas. Import from `zod/v4`; ADK compiles against Zod v4.
- **`monocle2ai`** (`^0.4.1`) — distributed tracing. Loaded as a preload via `NODE_OPTIONS`, not imported by `src/`.
- **`dotenv`** — loads API keys and config from `.env`.
- **`tsx`** — runs TypeScript directly for dev/start scripts.
- **`typescript`** — for the `build` script.

Python, for the trace tests only (see [`requirements.txt`](requirements.txt)):

- **`monocle_test_tools`** (`0.8.14`) — fluent trace assertions, the `generate_test` CLI, and the pytest plugin providing `monocle_trace_asserter`.
- **`python-dotenv`** — loads `.env.test` in `tests/conftest.py`.

## Setup

### Prerequisites

- Node.js 20+
- A Google GenAI API key ([get one here](https://aistudio.google.com/apikey))
- An Okahu API key, only if you want to export traces to Okahu
- Python 3.10+, only if you want to run the [trace tests](#testing-against-traces)

> This project runs as **CommonJS** (`tsx`/`node`); there is no `"type": "module"` in `package.json`.

### Install

```bash
npm install
```

### Configure environment

Copy `.env.example` to `.env` and fill in your keys:

```bash
cp .env.example .env
```

```bash
# --- Google GenAI (required) ---
GOOGLE_GENAI_API_KEY=<your_google_api_key>
GOOGLE_GENAI_USE_VERTEXAI=false
GOOGLE_GENAI_MODEL=gemini-2.5-flash-lite
MAX_OUTPUT_TOKENS=1000

# --- Monocle tracing (optional; omit this block to run without tracing) ---
MONOCLE_EXPORTER=file,okahu        # "file" → ./.monocle/*.json, "okahu" → Okahu
MONOCLE_WORKFLOW_NAME=adk-travel-agent-typescript
MONOCLE_ISOLATE_SPANS=true
MONOCLE_INCLUDE_ALL_SPANS=false
LOG_LEVEL=error
# MONOCLE_EXPORTER_DELAY=5000      # Batch flush interval in ms

# Required only when "okahu" is in MONOCLE_EXPORTER:
OKAHU_API_KEY=<your_okahu_api_key>
OKAHU_INGESTION_ENDPOINT=https://okahu-ingestion-dev-scus.azurewebsites.net/api/v1/trace/ingest
```

Notes:
- The TypeScript ADK reads `GOOGLE_GENAI_API_KEY` (not `GOOGLE_API_KEY`).
- To trace **only to a local file** (no Okahu account needed), set `MONOCLE_EXPORTER=file` and drop the `OKAHU_*` vars.

## Running

### One-shot query

Pass the request as a CLI argument:

```bash
npm start -- "Book a flight from SFO to BOM and a hotel at Hilton in Mumbai"
```

### Interactive conversation

Run with no argument to get a multi-turn prompt. Type `exit` or `quit` to end it:

```bash
npm start
```

### The orchestrator variant

Swap `start` for `start:orchestrator` in either mode:

```bash
npm run start:orchestrator -- "Book a flight from SFO to BOM"
npm run start:orchestrator
```

### Watch mode (dev)

```bash
npm run dev                  # sequential
npm run dev:orchestrator     # orchestrator
```

### Via the ADK CLI

Run an agent module through the ADK runner, or launch ADK's browser-based dev UI:

```bash
npm run adk:run:sequential
npm run adk:run:orchestrator
npm run adk:web
```

### Build

```bash
npm run build     # type-check and emit compiled JS to dist/
```

## Scripts reference

| Script | Description |
| --- | --- |
| `npm start` | Run the sequential variant via tsx. Alias of `start:sequential`. |
| `npm run start:sequential` | Run `src/main-sequential.ts`. |
| `npm run start:orchestrator` | Run `src/main-orchestrator.ts`. |
| `npm run dev` | Sequential variant in tsx watch mode. |
| `npm run dev:orchestrator` | Orchestrator variant in tsx watch mode. |
| `npm run build` | Type-check and compile to `dist/`. |
| `npm run adk:run:sequential` | Run the sequential agent module through the ADK CLI. |
| `npm run adk:run:orchestrator` | Run the orchestrator agent module through the ADK CLI. |
| `npm run adk:web` | Launch the ADK web dev UI. |

## Testing against traces

The agent is TypeScript, but its tests are Python. They never run the agent — they run against the **traces** it emitted, asserting on which agents and tools were invoked, what they produced, how many tokens the turn burned, how long it took, and how the turn scores on Okahu's evals. The machinery is [`monocle_test_tools`](https://pypi.org/project/monocle-test-tools/), whose pytest plugin supplies the `monocle_trace_asserter` fixture the tests take as an argument.

### Install

```bash
python3 -m venv .venv-tests
source .venv-tests/bin/activate
pip install -r requirements.txt
```

`monocle_test_tools` pulls in `torch` (via `bert-score` / `sentence-transformers`, used by the built-in similarity evals), so the resulting venv lands around 1.2 GB and the install takes a few minutes.

### Configure

Copy the template and fill it in:

```bash
cp .env.test.example .env.test
```

```bash
OKAHU_API_KEY=<your_okahu_api_key>            # reading traces and running evals
OKAHU_API_ENDPOINT=<api_url>                  # where the tests read traces back from
OKAHU_EVALUATION_ENDPOINT=<eval_url>          # where check_eval() runs
OKAHU_INGESTION_ENDPOINT=<ingest_url>         # where test-result traces are sent
MONOCLE_EXPORTER=file,okahu
MONOCLE_TEST_WORKFLOW_NAME=adk-travel-agent-typescript
```

[`tests/conftest.py`](tests/conftest.py) loads `.env.test` in `pytest_configure` with `override=True`, and skips it when the file is absent — so in CI you set the same variables in the environment and ship no file.

Two things are easy to conflate here, because both are "a workflow name":

- **The trace under test** is chosen by the explicit `workflow_name=` argument passed to `with_trace_source("okahu", ...)` inside each test. That is the one that has to match the `MONOCLE_WORKFLOW_NAME` the *agent* ran under.
- **`MONOCLE_TEST_WORKFLOW_NAME`** names the traces the *test run itself* emits. The suite is instrumented too: each test's pass/fail and assertion messages are exported per `MONOCLE_EXPORTER`, to `./.monocle/test_traces/` and/or to `OKAHU_INGESTION_ENDPOINT`. Set it to anything you like — keeping it equal to the agent's workflow name simply files both under one name in Okahu.

Nothing in `.env.test` overlaps with the agent's `.env`; the two are read by different processes and can hold different Okahu keys.

### Running the tests

**1. Run a turn and let it finish.** Use `npm start` (not `start:sequential` — see the gotcha under [Tracing](#tracing-monocle--okahu)) and let the process exit on its own so the spans flush:

```bash
npm start -- "book me a flight from bom to sfo"
```

With `MONOCLE_EXPORTER=file,okahu` you get both a local copy and an Okahu-side trace. The local filename carries the trace id:

```
.monocle/monocle_trace_<workflow>_<trace_id>_<timestamp>.json
                                  ^^^^^^^^^^
```

**2. Point the test at that trace.** In [`tests/test_ts_adk_travel_agent_fluent.py`](tests/test_ts_adk_travel_agent_fluent.py), set the trace source to the run you just made — by trace id from Okahu, or by path to the local file:

```python
asserter.with_trace_source("okahu", id="<trace_id>", workflow_name="adk-travel-agent-typescript")
# or
asserter.with_trace_source("file", trace_path="../.monocle/monocle_trace_....json")
```

**3. Run it**, from inside `tests/`:

```bash
source .venv-tests/bin/activate
cd tests
pytest -v -s test_ts_adk_travel_agent_fluent.py
```

`-v` names each test as it runs, `-s` lets the assertion output through instead of capturing it. Drop the filename to run everything in the directory.

> Run from `tests/`, not the project root. The suite writes its own traces to `./.monocle/test_traces/` relative to the working directory, so running from the root scatters them into the agent's `.monocle/` alongside the traces you are testing.

### Writing a new test

`monocle_test_tools` ships a generator that reads a trace and emits a test asserting on what actually happened in it — a starting point rather than a finished test, since it pins the model's exact wording and the turn's exact token count:

```bash
python -m monocle_test_tools generate_test --trace-id <trace_id> --workflow-name adk-travel-agent-typescript
```

It also accepts `--trace-file <path>` for a local trace, `--session-id` to cover a whole multi-turn session, and `--eval NAME=EXPECTED --eval-source okahu` to inject eval assertions. Output goes to stdout; `--help` lists the rest.

[`tests/test_ts_adk_travel_agent_fluent.py`](tests/test_ts_adk_travel_agent_fluent.py) started life this way and was then loosened by hand — worth reading as a worked example of which generated assertions are worth keeping.

### What the assertions look like

After naming a trace source, a test asserts against it:

| Assertion | Checks |
| --- | --- |
| `called_agent("adk_flight_booking_agent")` | that sub-agent was invoked at all |
| `.contains_input(text)` / `.contains_output(text)` | a substring of what went in or came out |
| `.contains_any_output(a, b, c)` | at least one of several substrings — the looser form, better for LLM wording |
| `called_tool("adk_book_flight", "adk_flight_booking_agent")` | the tool ran, from that agent |
| `under_token_limit(n)` | total tokens for the turn — a cost regression guard |
| `under_duration(n, units="seconds", span_type="agent_turn")` | turn latency |
| `with_evaluation("okahu").check_eval("frustration", expected="ok")` | an LLM-judged eval, scored server-side by Okahu |

`check_eval` also takes `not_expected=` for negative assertions (`sentiment`, `toxicity`), and `fact_name=` to score at a different level — `inferences`, `agentic_turns`, or `agentic_sessions` — rather than the whole trace.

Assertions are collected rather than raised one at a time: the plugin fails the test at the end with every failure reported together, so one run tells you everything that drifted.
