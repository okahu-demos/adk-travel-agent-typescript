# ADK Travel Agent (TypeScript)

A multi-agent travel booking assistant built with the [Google Agent Development Kit (ADK)](https://github.com/google/adk) TypeScript SDK. The supervisor agent coordinates flight and hotel bookings through specialized sub-agents, then produces a concise trip summary.

This is a TypeScript port of the Python [okahu-demos/adk-travel-agent](https://github.com/okahu-demos/adk-travel-agent) project. It is instrumented with [Monocle](https://github.com/monocle2ai/monocle) for distributed tracing, exporting spans to a local file and/or [Okahu](https://www.okahu.ai/).

## What it does

Given a natural-language travel request (e.g. *"Book me a flight from SFO to BOM and a stay at Marriott in Mumbai"*), the agent:

1. Parses the request and asks for any missing details.
2. Delegates the flight booking to the flight agent.
3. Delegates the hotel booking to the hotel agent.
4. Summarizes the final itinerary in one sentence.

Booking tools are mocked — they return success messages without calling any real booking API — so the project is safe to run end-to-end for demos and development.

## How it works

The agent graph is composed of four `LlmAgent`s, all backed by Gemini:

| Agent | Role |
| --- | --- |
| `adk_supervisor_agent` (root) | Orchestrates the workflow, collects missing info from the user, and invokes the specialist agents as tools. |
| `adk_flight_booking_agent` | Handles flight booking only. Calls `adk_book_flight`. |
| `adk_hotel_booking_agent` | Handles hotel booking only. Calls `adk_book_hotel`. Applies a domain rule: Marriott is only available on odd dates; otherwise defaults to Hilton. |
| `adk_trip_summary_agent` | Produces a one-sentence summary once bookings are complete. |

Sub-agents are exposed to the supervisor via `AgentTool`, so the supervisor invokes them the same way it invokes any other tool.

Tools (`src/tools.ts`) are defined with `FunctionTool` and Zod v4 schemas:

- `adk_book_flight(from_airport, to_airport)`
- `adk_book_hotel(hotel_name, city)`

The entry point (`src/index.ts`) uses `InMemoryRunner` with `runEphemeral` to execute a single turn against the root agent and prints the final response.

### Tracing (Monocle → Okahu)

`src/index.ts` imports `./instrument.js` as its very first line, before any `@google/adk` import. That bootstrap ([`src/instrument.ts`](src/instrument.ts)) calls `setupMonocle(...)`, which installs a CommonJS `require`-hook that transparently wraps ADK and the underlying `@google/genai` SDK — so every agent run, tool call, and LLM request emits a span with **no tracing code in the agent logic itself**.

Spans are exported per the `MONOCLE_EXPORTER` env var:

- `file` — written to `./.monocle/monocle_trace_*.json` (handy for local inspection).
- `okahu` — POSTed to the `OKAHU_INGESTION_ENDPOINT` using `OKAHU_API_KEY`.

A typical run produces a span tree of `workflow` → `adk.runner.run_ephemeral` → `adk.agent.run` → `adk.tool` / `gemini.generate_content`.

> **Note:** Monocle batches spans (default 5s) and flushes on a timer, so after printing its answer the process lingers a few seconds before exiting. A hard `SIGTERM`/`Ctrl-C` arriving before the next flush can drop buffered spans. To export them deterministically on exit, force a flush via the global tracer provider in `instrument.ts`:
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
  index.ts      # CLI entry point — accepts an arg or prompts interactively
  instrument.ts # Monocle tracing bootstrap (imported first by index.ts)
  agents.ts     # Agent definitions and composition
  tools.ts      # FunctionTool definitions with Zod schemas
.monocle/       # Local span output (created at runtime when MONOCLE_EXPORTER includes "file")
.env.example    # Template for required env vars
tsconfig.json
package.json
```

## Libraries used

- **`@google/adk`** (`^0.6.0`) — the Agent Development Kit; provides `LlmAgent`, `AgentTool`, `FunctionTool`, `InMemoryRunner`, and event helpers.
- **`@google/adk-devtools`** (`^0.6.0`) — provides the `adk` CLI (`adk run`, `adk web`).
- **`zod`** (`^4.x`) — tool parameter schemas. Import from `zod/v4`; ADK compiles against Zod v4.
- **`monocle2ai`** — distributed tracing. Installed from a **local build** of the sibling `monocle-typescript` repo (see Setup), not from npm.
- **`dotenv`** — loads API keys and config from `.env`.
- **`tsx`** — runs TypeScript directly for dev/start scripts.
- **`typescript`** — for the `build` script.

## Setup

### Prerequisites

- Node.js 20+
- A Google GenAI API key ([get one here](https://aistudio.google.com/apikey))
- The **`monocle-typescript` repo checked out as a sibling directory** (see below) — the `monocle2ai` dependency points at a local build of it, not at npm. An Okahu API key is also needed if you export traces to Okahu.

> This project runs as **CommonJS** (`tsx`/`node`); there is no `"type": "module"` in `package.json`.

### Build the local Monocle package

`package.json` depends on Monocle via a local file path:

```json
"monocle2ai": "file:../monocle-typescript/dist/monocle2ai-0.1.2.tgz"
```

That tarball does not exist until you build it, so a plain `npm install` on a fresh clone will fail. Check out the `monocle-typescript` SDK (from the [Monocle org](https://github.com/monocle2ai)) as a sibling directory, then build and pack it:

```bash
# from the parent directory that contains this project, alongside it:
#   <parent>/adk-travel-agent-typescript   <- this repo
#   <parent>/monocle-typescript            <- the Monocle TS SDK
cd monocle-typescript && npm install && npm run build && cd dist && npm pack && cd ../..
```

This produces `../monocle-typescript/dist/monocle2ai-0.1.2.tgz`. After the initial build, the `sync-monocle` script rebuilds and reinstalls it in one step:

```bash
npm run sync-monocle
```

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

### Interactive prompt

Run with no argument and you'll be prompted for input:

```bash
npm start
```

### Watch mode (dev)

```bash
npm run dev
```

### Via the ADK CLI

Run the agent through the ADK runner:

```bash
npm run adk:run
```

Launch ADK's browser-based dev UI:

```bash
npm run adk:web
```

### Build

```bash
npm run build     # emits compiled JS to dist/
```

## Scripts reference

| Script | Description |
| --- | --- |
| `npm start` | Run `src/index.ts` once via tsx. |
| `npm run dev` | Run with tsx watch mode. |
| `npm run build` | Type-check and compile to `dist/`. |
| `npm run adk:run` | Run the agent through the ADK CLI. |
| `npm run adk:web` | Launch the ADK web dev UI. |
| `npm run sync-monocle` | Rebuild the sibling `monocle-typescript`, repack it, and reinstall the local `monocle2ai` tarball. |
