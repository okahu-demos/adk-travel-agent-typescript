# ADK Travel Agent (TypeScript)

A multi-agent travel booking assistant built with the [Google Agent Development Kit (ADK)](https://github.com/google/adk) TypeScript SDK. Specialized sub-agents handle flight booking, hotel booking, and trip summarization.

This is a TypeScript port of the Python [okahu-demos/adk-travel-agent](https://github.com/okahu-demos/adk-travel-agent) project. It is instrumented with [Monocle](https://github.com/monocle2ai/monocle) for distributed tracing, exporting spans to a local file and/or [Okahu](https://www.okahu.ai/).

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

Each entry point calls `setupMonocle('adk-travel-agent-ts')` *before* `require`-ing the agent module:

```ts
require('dotenv/config');
const { setupMonocle } = require('monocle2ai');

setupMonocle('adk-travel-agent-ts');

const { rootAgent } = require('./agents-sequential.js');
const { runCliWithSession } = require('./runner.js');
```

Ordering is the whole trick. `require()` runs inline rather than being hoisted the way `import` is, so `setupMonocle()` installs its CommonJS `require`-hook before ADK is ever loaded. The hook transparently wraps ADK and the underlying `@google/genai` SDK, so every agent run, tool call, and LLM request emits a span with **no tracing code in the agent logic itself**. This is also why the entry points use `require` instead of `import`.

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

> **Note:** Monocle batches spans and flushes on a timer (`MONOCLE_EXPORTER_DELAY`, default 5000 ms), so after printing its answer the process lingers a few seconds before exiting. A hard `SIGTERM`/`Ctrl-C` arriving before the next flush can drop buffered spans. To export them deterministically on exit, force a flush via the global tracer provider in the entry point:
>
> ```ts
> import { trace } from '@opentelemetry/api';
> const provider = (trace.getTracerProvider() as { getDelegate?: () => { forceFlush?: () => Promise<void>; shutdown?: () => Promise<void> } }).getDelegate?.();
> const flush = async () => { await provider?.forceFlush?.(); await provider?.shutdown?.(); };
> process.on('beforeExit', flush);
> process.on('SIGINT', async () => { await flush(); process.exit(0); });
> process.on('SIGTERM', async () => { await flush(); process.exit(0); });
> ```

## Project layout

```
src/
  main-sequential.ts     # Entry point — Monocle bootstrap + SequentialAgent variant (default)
  main-orchestrator.ts   # Entry point — Monocle bootstrap + LLM-orchestrator variant
  agents-sequential.ts   # Agent definitions composed with SequentialAgent
  agents-orchestrator.ts # Agent definitions composed with an LlmAgent supervisor + AgentTool
  runner.ts              # Shared CLI: session creation, run loop, event handling
  tools.ts               # FunctionTool definitions with Zod schemas
.monocle/                # Local span output (created at runtime when MONOCLE_EXPORTER includes "file")
.env.example             # Template for required env vars
tsconfig.json
package.json
LICENSE
```

## Libraries used

- **`@google/adk`** (`^0.6.0`) — the Agent Development Kit; provides `LlmAgent`, `SequentialAgent`, `AgentTool`, `FunctionTool`, `InMemoryRunner`, and event helpers.
- **`@google/adk-devtools`** (`^0.6.0`) — provides the `adk` CLI (`adk run`, `adk web`).
- **`zod`** (`^4.3.6`) — tool parameter schemas. Import from `zod/v4`; ADK compiles against Zod v4.
- **`monocle2ai`** (`0.4.0`) — distributed tracing, pinned exactly.
- **`dotenv`** — loads API keys and config from `.env`.
- **`tsx`** — runs TypeScript directly for dev/start scripts.
- **`typescript`** — for the `build` script.

## Setup

### Prerequisites

- Node.js 20+
- A Google GenAI API key ([get one here](https://aistudio.google.com/apikey))
- An Okahu API key, only if you want to export traces to Okahu

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
MONOCLE_TEST_WORKFLOW_NAME=adk-travel-agent-ts
MONOCLE_ISOLATE_SPANS=true
MONOCLE_INCLUDE_ALL_SPANS=false
LOG_LEVEL=error
# MONOCLE_EXPORTER_DELAY=5000      # Batch flush interval in ms

# Required only when "okahu" is in MONOCLE_EXPORTER:
OKAHU_API_KEY=<your_okahu_api_key>
OKAHU_INGESTION_ENDPOINT=https://okahu-ingestion-dev-scus.azurewebsites.net/api/v1/trace/ingest
# Preload monocle
NODE_OPTIONS=--import monocle2ai/register
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
