# PRD: LLM Tool-Calling Testing Harness

**Status:** Draft v2
**Last updated:** 2026-06-07

> **v2 changelog (resolved gaps from v1 review):** added credential handling (§10.14); reworded the reproducibility guarantee to cover *setup*, not *outcomes* (§12); set a concurrency cap of 5 with WAL mode (§9.6, §10.9); added a deterministic `occurrence_index` to manual-replay keying and a `tool_call_id` for event correlation (§5.1, §10.5); specified the normalized internal representation and scoped v1 to OpenAI-compatible providers with streaming (§8); paused the wall-clock timer during `awaiting_manual_input` (§9.2); gated execution of imported dynamic tools behind explicit user approval (§3, §10.6, §10.13); and reserved a `reasoning` content part plus reasoning/cache token fields (costing still deferred) (§5.1, §8, §10.8).

---

## 1. Summary

A self-hostable, open-source harness for studying how LLM models behave when offered a set of tools. Tools are *fake* — they don't perform real work; they exist to observe which tools a model chooses, in what order, with what arguments, and how it reacts to the responses it gets back.

The user designs fake tools in an HTML-based builder, assembles them (plus a model and prompts) into a reusable **Testing Plan**, and executes the plan as one or more **Testing Sessions**. Every model interaction and tool call is logged in a structured, queryable form and surfaced in the UI, plus an analysis layer for comparing runs and models. The primary downstream use is publishing research findings (Substack) and releasing the harness itself as open source.

---

## 2. Goals

- Let a researcher design fake tools with configurable responses (static, dynamic, manual) through a web UI.
- Maintain a versioned **library** of reusable tools.
- Compose tools + model + prompts into reusable, versioned **Testing Plans**.
- Run a plan as any number of independent **Testing Sessions**, including repeated runs for statistical signal.
- Normalize behavior across OpenAI-compatible providers in v1, behind an interface that allows native providers later.
- Log every interaction and tool call in a structured, queryable schema.
- Provide an analysis/aggregation layer to compare runs within a plan and across models.
- Support import/export of tool libraries and plans for sharing.

## 3. Non-Goals (v1)

- Automatic correctness scoring / "expected behavior" definitions. *(Deferred — design the schema so it can be added later.)*
- Real tool execution / side effects on external systems.
- Sandboxing of dynamic-response code. *(Accepted risk for code the user authors locally; see §10.6. Note: imported third-party dynamic code is treated differently — it does not execute until the user reviews and approves it, see §10.13.)*
- Multi-user accounts, auth, RBAC, hosted multi-tenant service. *(Single-user / single-researcher tool for v1.)*
- Fine-tuning, training, or model hosting.
- Native (non-OpenAI-compatible) provider adapters. *(The normalized internal representation is designed so these can be added without touching the loop, logging, or analysis — but only the OpenAI-compatible adapter ships in v1.)*

---

## 4. Personas & Primary Use Cases

**Persona — The Researcher (single user).** Technically capable, runs the harness locally, designs experiments, and writes them up.

Representative use cases:

1. *Tool-selection study.* Offer 8 tools where 2 are plausible for the task; measure which the model picks across 50 runs and across 3 models.
2. *Description-sensitivity study.* Run the same plan twice with only one tool's description reworded; compare selection rates.
3. *Recovery study.* Make a tool return an error and observe whether the model retries, switches tools, or gives up.
4. *Human-in-the-loop probe.* Use a manual tool to interactively decide responses while watching the model live, then freeze those responses for batch reruns.

---

## 5. Core Concepts & Entity Model

The system is built on a strict separation between **mutable logical objects** and **immutable versions**. Plans pin specific versions; sessions record exactly what ran. This is what makes published findings reproducible *at the setup level* (see §12 for the precise scope of that guarantee).

### 5.1 Entities

**Tool** (logical, mutable)
- `id`, `name`, `created_at`, `description` (library-level note, not the model-facing one)
- Has many **ToolVersions**.

**ToolVersion** (immutable snapshot — the unit a plan actually references)
- `id`, `tool_id`, `version_number`, `created_at`
- `display_name` — the model-facing tool name.
- `model_facing_description` — the description the model sees (a primary experimental variable).
- `parameter_schema` — JSON Schema for arguments.
- `response_mode` — `static` | `dynamic` | `manual`.
- `static_response` — payload returned for static mode.
- `dynamic_code` — Python function source for dynamic mode (see §10.6).
- `manual_config` — `{ replay_default: bool }` and replay behavior (see §10.5).
- Once created, never edited. Editing a tool produces a new ToolVersion.

**ModelConfig** (library-level authoring template, mutable — *copied by value* into a PlanVersion, never referenced live)
- `id`, `name`, `provider_kind` (`openai_compatible` in v1), `base_url`, `model_snapshot` (exact pinned snapshot string, not an alias), `params` (temperature, top_p, seed, max_tokens, tool_choice, etc.).
- `api_key_env` — the **name** of the environment variable that holds the API key (e.g. `OPENROUTER_API_KEY`). The key value itself is never stored on the entity (§10.14).
- `pricing` — `input_cost_per_1k`, `output_cost_per_1k` (user-supplied; drives cost accounting in §10.8).
- A ModelConfig is purely an authoring convenience: when a plan is snapshotted, the entire ModelConfig is frozen *by value* into the PlanVersion (§7.2). There is intentionally **no** separate `ModelConfigVersion` table — the PlanVersion *is* the frozen copy.

**Plan** (logical, mutable)
- `id`, `name`, `description`, has many **PlanVersions**.

**PlanVersion** (immutable — the executable unit)
- `id`, `plan_id`, `version_number`, `created_at`
- Pinned set of `ToolVersion` references (ordered).
- `model_config_snapshot` — the full ModelConfig frozen **by value** at snapshot time (provider_kind, base_url, model_snapshot, params, api_key_env, pricing). Mutating the source ModelConfig afterward never affects this PlanVersion.
- `system_prompt` and `user_prompt` (both user-settable, see §10.7).
- `run_settings`:
  - `repetitions` (default 1; >1 enables statistics — §10.9)
  - `tool_order_strategy` — `fixed` | `randomized_per_session` (§10.10)
  - agent-loop limits (§9.2)
- Snapshotting a plan freezes all of the above.

**Session** (immutable record of one execution of a PlanVersion)
- `id`, `plan_version_id`, `started_at`, `ended_at`
- `status` — `pending` | `running` | `completed` | `aborted` | `errored` | `awaiting_manual_input`
- `termination_reason` (§9.3)
- `tool_order_used` — the actual ordering presented (logged even when randomized).
- `totals` — turns, tool calls, tokens (in/out, and reasoning/cache if reported), computed cost, wall-clock duration.
- Has many **Events**.

**Event** (immutable structured log entry — the atom of everything queryable)
- `id`, `session_id`, `sequence_no`, `timestamp`, `type`, `payload` (typed JSON), `latency_ms`, `token_usage`.
- `tool_call_id` — present on `tool_call`, `tool_result`, and `tool_error` events; correlates a result/error back to its originating call. Essential for matching parallel calls (§9.4). This is a real per-call identifier and is **distinct from** the manual-replay key (§10.5).
- Event types: `session_start`, `model_request`, `model_response`, `tool_call`, `tool_result`, `tool_error`, `manual_prompt`, `manual_response`, `hallucinated_tool_call`, `loop_guard_triggered`, `abort`, `session_end`.
- `model_response` payloads carry an ordered list of normalized content parts (`text`, `tool_call`, `reasoning`); the `reasoning` part is captured when the provider exposes it (§8). Costing of reasoning tokens is deferred (§10.8) but the data is retained.

**ManualResponseRecord** (for record-and-replay — §10.5)
- `id`, `session_id`, `tool_version_id`, `call_args_hash`, `occurrence_index`, `recorded_response`, `created_at`.
- The replay lookup key is the tuple **(`tool_version_id`, `call_args_hash`, `occurrence_index`)**. `occurrence_index` is the deterministic count of prior calls to the same tool version with the same args hash within the session (0, 1, 2, …). This lets two identical-argument calls receive different recorded human responses while remaining reproducible as long as the model emits the same call stream.

### 5.2 Relationship summary

```
Tool 1──* ToolVersion ──* (pinned into) PlanVersion *──1 Plan
ModelConfig ──(copied by value into)── PlanVersion
PlanVersion 1──* Session 1──* Event
Session 1──* ManualResponseRecord
```

---

## 6. Tool Library

### 6.1 Tool Builder (HTML UI)

A form-based builder to create/edit a tool, producing a new ToolVersion on save. Fields:

- Model-facing name and description.
- Parameter schema editor (JSON Schema). Provide both a raw editor and a simple field-by-field builder (name, type, required, description, enum).
- Response mode selector: static / dynamic / manual.
- Mode-specific configuration panel (§6.2).
- A test/preview pane: enter sample arguments, see the response that would be returned (executes dynamic code, shows the manual prompt, etc.).

### 6.2 Response modes

- **Static** — returns a fixed payload regardless of arguments.
- **Dynamic** — runs a user-written Python function `def respond(args, context) -> response`. `context` exposes session-scoped state so tools can be **stateful** within a session (e.g., a fake DB that remembers writes). State is per-session and discarded at session end. (§10.6 for execution model and risk.)
- **Manual** — pauses the session, surfaces a prompt in the live UI, and waits for the human to supply the response. Behavior governed by record-and-replay settings (§10.5).

### 6.3 Versioning behavior

- Saving edits to a tool **always** creates a new ToolVersion; prior versions are immutable and remain referenceable.
- The library UI shows version history per tool and a diff between versions (description, schema, response config).
- Plans reference a specific ToolVersion; bumping a tool does not retroactively change existing plans.

### 6.4 Library management

- List/search/filter tools and versions.
- Tag tools for organization.
- Clone a tool/version as a starting point.

---

## 7. Testing Plans

### 7.1 Plan creation

A plan is assembled by:

1. Selecting tools from the library (specific versions; default to latest, user can pin older).
2. Ordering the tools (or choosing the randomize-per-session strategy).
3. Selecting a ModelConfig template from the library and adjusting it as needed (provider_kind, base_url, exact snapshot, params, `api_key_env`, pricing).
4. Writing the system prompt and the user/starting prompt.
5. Setting run settings (repetitions, tool-order strategy, agent-loop limits).

### 7.2 Plan versioning

- Saving a plan creates a PlanVersion that freezes everything above, including a **by-value copy of the ModelConfig** as `model_config_snapshot`.
- A plan can be re-run any number of times; each run is a new Session bound to a PlanVersion.
- The UI clearly indicates which PlanVersion a session was run against.

---

## 8. Provider Adapter Layer

All providers are normalized to one internal representation so the agent loop, logging, and analysis are provider-agnostic. **v1 ships a single adapter for OpenAI-compatible Chat Completions endpoints** (e.g. LM Studio, OpenRouter, and anything exposing the same API). The normalized representation below is defined independently of that adapter so native providers can be added later without changing the loop, logging, or analysis (§3).

### 8.1 Normalized internal representation — request (internal → provider)

- **Message list** — ordered, with roles `system` | `user` | `assistant` | `tool`.
  - `assistant` messages may carry text content and/or one or more `tool_call`s.
  - `tool` messages carry a result/error and reference the `tool_call_id` they answer.
- **Tool definitions** — list of `{ name, description, parameter_schema (JSON Schema) }`.
- **System prompt placement** — represented as the leading `system` message; the adapter maps it to whatever shape the provider expects.
- **`tool_choice`** — canonical values `auto` | `required` | `none` | `specific(name)`. Each adapter maps these to the provider's vocabulary.
- **Sampling params** — `temperature`, `top_p`, `seed`, `max_tokens`, `stop`, and any provider-specific extras. Rule: if a provider does not support a requested param, the adapter **drops it and logs the drop** in the request metadata rather than failing.
- **Parallel-calls flag** — enabled where the provider supports it.

### 8.2 Normalized internal representation — response (provider → internal)

- **Assistant turn** = an ordered list of content parts, each one of:
  - `text`
  - `tool_call` — `{ tool_call_id, name, raw_args (string), parsed_args (object), parallel_group }`. `tool_call_id` is stable and is the linkage used by `tool_result`/`tool_error` events (§5.1).
  - `reasoning` — captured whenever the provider exposes reasoning/thinking content. Retained as behavior data; not costed in v1 (§10.8).
- **Finish reason** — canonical `end_turn` | `tool_call` | `length` | `content_filter` | `error`.
- **Token usage** — normalized `input_tokens`, `output_tokens`, plus optional `reasoning_tokens`, `cache_read_tokens`, `cache_write_tokens` recorded when the provider reports them.
- **Error taxonomy** — split into:
  - *transient / retryable* — rate limit, 5xx, timeout (feeds §9.5 backoff).
  - *permanent* — auth failure, bad request, context-length exceeded, content filter.

### 8.3 Streaming (required for live UI in v1)

- The adapter consumes the provider's streaming response, assembling partial text and incrementally building each tool call's argument string from deltas.
- Incremental output is forwarded to the live-session UI as it arrives (§10.11).
- The agent loop operates on the **assembled final turn**: a complete `model_response` event (with full content parts, finish reason, and usage) is emitted once the turn closes. Tool execution never begins on a partially-streamed call.

### 8.4 Adapter contract

- **Captured metadata per request:** model snapshot, params actually sent (and any dropped per §8.1), system prompt, full normalized message list.
- **Pinned snapshots:** record the exact model snapshot the provider reports; if it differs from the requested value, log both.
- **Extensibility:** adding a provider = implementing one adapter interface against the normalized representation in §8.1–§8.2; no changes to the loop or schema.

---

## 9. Testing Session & Agent Loop

### 9.1 Loop overview

A session executes the classic agent loop: model request → (optional) tool calls → tool results fed back → model request → … until a termination condition fires. Every step emits Events.

### 9.2 Safe defaults (all configurable in run settings)

| Limit | Default | Purpose |
|---|---|---|
| Max turns | 20 | Bound total model round-trips. |
| Max total tool calls | 50 | Bound runaway tool usage. |
| Repeat-call guard | same tool + same args 5× in a row | Detect/stop infinite loops. |
| Wall-clock timeout | 5 min/session | Bound hung sessions. **The timer pauses while the session is `awaiting_manual_input`** so live human responses don't trip it. |
| Max parallel calls handled per turn | provider-dependent, all executed | Support multi-call turns. |

### 9.3 Termination conditions (recorded as `termination_reason`)

- Model returns a final assistant message with **no tool call** → `completed_no_tool_call`.
- Max turns reached → `max_turns`.
- Max tool calls reached → `max_tool_calls`.
- Loop guard triggered → `loop_guard`.
- Timeout → `timeout`.
- User abort → `aborted`.
- Provider/API error after retries → `errored`.

### 9.4 Loop behaviors

- **Parallel tool calls:** when a provider emits multiple calls in one turn, all are executed; results are returned together in the next request. Each call/result pair is correlated by `tool_call_id`. Execution order and timing are logged.
- **Malformed / invalid arguments:** arguments are validated against the tool's JSON Schema. On failure, return a structured error to the model as the tool result and emit a `tool_error` event. (The model's recovery is itself data.)
- **Hallucinated tools:** model calls a tool not in the set → emit `hallucinated_tool_call`, return a structured "unknown tool" error to the model, continue the loop.
- **No tool call at all:** a first-class valid outcome, not a failure. Recorded and surfaced in analysis.
- **Abort:** a running session can be killed from the UI; partial events are preserved and `termination_reason = aborted`.

### 9.5 API resilience

- Retry with exponential backoff on transient provider errors / rate limits (per the §8.2 error taxonomy).
- After retries exhausted mid-session: mark `errored`, preserve all events up to the failure, record where it failed.

### 9.6 Concurrency

- The batch runner executes at most **5 sessions concurrently** in v1 (a fixed cap; expandable later). Implemented as a simple semaphore/queue; excess sessions wait in `pending`.
- SQLite runs in **WAL mode** so concurrent session writers don't serialize badly.

---

## 10. Detailed Feature Requirements

### 10.5 Manual tools — record-and-replay

- **Default: record-and-replay on.** On the first session that hits a manual tool, the human's response is captured into a `ManualResponseRecord` keyed by **(tool version, call-args hash, occurrence index)** — where `occurrence_index` is the deterministic count of prior same-tool/same-args calls within that session. Subsequent sessions of the same plan replay the recorded response automatically (no human needed), enabling batch and repeated runs.
- **Why the occurrence index:** it lets two identical-argument calls in one session receive distinct human answers and still replay deterministically, as long as the model emits the same call stream. Tool order being `randomized_per_session` changes which tools are *offered*, not the args of a given call, so order is deliberately **not** part of the key.
- **Opt-out (rare cases):** a per-tool (or per-plan) toggle to **disable replay**, so the tool always prompts the human live on every run. The user explicitly accepts that such sessions are non-batchable and non-reproducible.
- **No record yet during replay mode:** if a replay-enabled run encounters a manual call with no matching record (e.g., new arguments, or a higher occurrence index than recorded), it falls back to prompting the human and records the new response.
- The session enters `awaiting_manual_input` status while waiting; the live UI surfaces the prompt (§10.11), and the wall-clock timer is paused (§9.2).

### 10.6 Dynamic responses

- Implemented as a user-written Python function `respond(args, context)`.
- `context` provides session-scoped, mutable state for stateful tools; reset per session.
- **Security:** executed in-process without sandboxing for v1. This is an accepted risk **for code the user authored locally**, because the tool is a single-user research harness. **This must be stated prominently in the README.** Dynamic tools *imported from others* are handled differently — they do not execute until the user reviews and approves the code (§10.13).

### 10.7 Prompts

- System prompt and user/starting prompt are both independently settable per PlanVersion.
- Both are frozen into the PlanVersion and logged with each session's first model request.

### 10.8 Token & cost accounting

- Token usage captured per model request from the normalized adapter and aggregated per session. Where the provider reports them, `reasoning_tokens`, `cache_read_tokens`, and `cache_write_tokens` are also recorded.
- **Cost** is computed from user-supplied pricing on the frozen ModelConfig (`input_cost_per_1k`, `output_cost_per_1k`). No external price lookups; the user sets pricing when configuring the model.
- **Reasoning/cache token costing is deferred:** these token counts are stored for completeness and analysis, but v1's cost figure is computed only from input/output pricing. (A later version can add reasoning/cache rate fields without a schema migration of the captured counts.)
- Session totals and per-request breakdowns are queryable and shown in the UI; aggregates roll up to plan-level (e.g., "this study cost $X").

### 10.9 Statistics / repetitions

- `repetitions` in run settings; default 1.
- When >1, running the plan launches N sessions (subject to the §9.6 concurrency cap) and the analysis layer reports distributions and variance across them (§11). Statistics are only computed/displayed when the user opted into repetitions.
- Where the provider supports it, `seed` is captured to aid (partial) reproducibility of *setup*. Note this does not constrain outcome variability — see the reproducibility scope in §12.

### 10.10 Tool-order position bias

- `tool_order_strategy`: `fixed` (as authored) or `randomized_per_session`.
- The actual order presented to the model in each session is recorded in `Session.tool_order_used` so order can be controlled for in analysis.

### 10.11 Live-session UI

- Real-time view of an in-progress session via streaming (§8.3): model text and tool-call arguments appear incrementally as they arrive, alongside the event stream.
- Required for manual tools: shows the manual prompt, the pending call's arguments, and an input to supply the response; resumes the session on submit.
- Controls: abort session; for live (non-replay) manual mode, respond to prompts.

### 10.12 Logging, querying & viewing

- All Events persisted to SQLite (WAL mode, §9.6) with a versioned schema.
- Structured, typed payloads per event type (§5.1).
- Query/filter UI: by plan, plan version, model, session, status, tool, event type, time range.
- Session detail view: full ordered event timeline (model messages, tool calls + args, results/errors, manual prompts/responses, loop-guard hits, token/latency per step).

### 10.13 Import / export (library sharing)

- Export tools/versions and plans (with their pinned tool versions and frozen ModelConfig snapshot) to a portable JSON bundle. **Bundles never contain API keys** — only the `api_key_env` reference name (§10.14).
- Import bundles into a local library, preserving versions.
- **Imported dynamic-response tools are inert on import.** Their `dynamic_code` does not execute on first use; instead the UI surfaces the code for the user to review and **explicitly approve**. Only after approval can the tool run. This closes the remote-code-execution path that arbitrary shared bundles would otherwise open, and is the mitigation that justifies deferring a full sandbox (§3, §10.6).

### 10.14 Credentials & secrets

- API keys are supplied via **environment variables** (or a local `.env` the app reads at startup). Keys are never stored on entities, in the database, or in export bundles.
- `ModelConfig.api_key_env` holds only the **name** of the variable to read (e.g. `OPENAI_API_KEY`, `OPENROUTER_API_KEY`).
- At session start the runner resolves the named variable; if it is unset, the session fails fast (`errored`) with a clear message naming the missing variable, **before** any model request is made.
- No keychain, encryption-at-rest, or in-UI key entry in v1 — intentionally minimal.

---

## 11. Analysis & Aggregation Layer

Logging gives raw records; this layer turns them into findings.

- **Per-session derived metrics:** tools called (set + counts), call order/sequence, turn count, total tool calls, tokens in/out (and reasoning/cache where present), computed cost, wall-clock duration, termination reason, whether any tool was called at all, hallucinated-tool count, error count.
- **Within-plan aggregation (across the N sessions of a PlanVersion):** tool-selection rates, first-tool-chosen distribution, call-order patterns, distribution/variance of turns/tokens/cost, rate of "no tool call," recovery rates after errors.
- **Failed/aborted sessions are counted.** `errored` and `aborted` sessions are included in the denominator of every rate and reported as their **own explicit categories**, so a high failure rate can never masquerade as (for example) a high "no tool call" rate.
- **Cross-model comparison:** the same plan (or equivalent plans differing only in ModelConfig) compared across models on the metrics above — the core Substack chart.
- **Export:** CSV/JSON export of per-session metrics and aggregates for external plotting/write-ups, plus generated markdown findings reports for plan-version summaries.
- **Deferred:** correctness scoring / expected-behavior definitions — schema should leave room (e.g., an optional per-plan expectations object and a per-session score field) without implementing evaluation in v1.

---

## 12. Non-Functional Requirements

- **Storage:** SQLite in WAL mode with a versioned, migratable schema.
- **Deployment:** runs locally / self-hosted; minimal setup; single user.
- **Reproducibility (scope):** the guarantee covers the **setup**, not the outcomes. Any session's *configuration* can be fully reconstructed from stored data — pinned plan version, tool versions, model snapshot, params, prompts, and tool order. The harness does **not** guarantee that re-running reproduces identical *outputs*: model responses are stochastic, and `dynamic` tools may be non-deterministic (they have no record-and-replay). The event log is always a faithful record of what actually happened in a given session.
- **Extensibility:** new providers via the adapter interface (§8.4); new event types additively.
- **Open-source readiness:** clear README, license, security disclaimer about dynamic code (local *and* imported), example tool library/plan, contribution guide.
- **Performance:** the event store and queries should remain responsive at thousands of sessions / hundreds of thousands of events (index on `session_id`, `sequence_no`, `type`).

---

## 13. Open Questions

Resolved in v2 (kept here for traceability):

- ~~Dynamic-code state scope~~ → **session-scoped only** for v1; persistent/plan-scoped fake-DB state is not in scope.
- ~~Randomized order + manual replay keying~~ → key is **(tool_version, args_hash, occurrence_index)**; order is not in the key (§10.5).
- ~~Streaming in the live UI~~ → **required in v1** (§8.3, §10.11).

Still open:

1. **Batch runner UX:** beyond the 5-session concurrency cap (§9.6), how are N repetitions surfaced and controlled in the UI (progress, partial-failure handling, retry of just the failed sessions)?
2. **Argument-hash normalization** for manual replay: how to canonicalize args (key ordering, whitespace, float representation) so equivalent calls produce the same `call_args_hash`.

---

## 14. Suggested Milestones

1. **M1 — Data layer:** SQLite schema (WAL), entity/versioning model, migrations.
2. **M2 — Tool builder + library:** HTML builder, static/dynamic/manual config, versioning, preview.
3. **M3 — Provider adapter + agent loop:** OpenAI-compatible adapter (with streaming) end-to-end, safe-default loop, event logging, credential resolution (§10.14).
4. **M4 — Plans & sessions:** plan composition/versioning (incl. by-value ModelConfig freeze), run a session, session detail view.
5. **M5 — Live UI + manual tools:** real-time stream, manual prompts, record-and-replay with occurrence index (+ opt-out).
6. **M6 — Concurrency & accounting:** 5-way batch runner, token/cost accounting (incl. reasoning/cache token capture).
7. **M7 — Analysis layer:** per-session metrics, within-plan + cross-model aggregation (with failed/aborted as explicit categories), CSV/JSON export, and markdown findings reports.
8. **M8 — Sharing + OSS polish:** import/export bundles (key-safe, approval-gated dynamic code), README, license, security disclaimer, examples.
