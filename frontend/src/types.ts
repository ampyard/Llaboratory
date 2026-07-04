export interface ToolVersion {
  id: string
  tool_id: string
  version_number: number
  created_at: string
  display_name: string
  model_facing_description: string
  parameter_schema: Record<string, unknown>
  response_mode: 'static' | 'dynamic' | 'manual'
  static_response: unknown
  dynamic_code: string | null
  dynamic_approved: number
}

export interface Tool {
  id: string
  name: string
  description: string
  tags: string[]
  built_in: boolean
  created_at: string
  versions: ToolVersion[]
}

export interface ModelConfig {
  id: string
  name: string
  provider_kind: string
  base_url: string
  model_snapshot: string
  api_key_env: string
  params: Record<string, unknown>
  input_cost_per_1k: number
  output_cost_per_1k: number
  created_at: string
}

export interface RunSettings {
  repetitions: number
  tool_order_strategy: 'fixed' | 'randomized_per_session'
  max_turns: number
  max_tool_calls: number
  timeout_seconds: number
}

export interface PlanVersion {
  id: string
  plan_id: string
  version_number: number
  created_at: string
  model_config_snapshot: ModelConfig
  system_prompt: string
  user_prompt: string
  run_settings: RunSettings
  tool_versions: ToolVersion[]
}

export interface Plan {
  id: string
  name: string
  description: string
  created_at: string
  versions: PlanVersion[]
}

export interface SessionTotals {
  turns: number
  tool_calls: number
  input_tokens: number
  output_tokens: number
  cost_usd: number
  wall_clock_ms: number
}

export type SessionStatus = 'pending' | 'running' | 'completed' | 'aborted' | 'errored'

export interface Session {
  id: string
  plan_version_id: string
  batch_id: string | null
  batch_index: number
  started_at: string | null
  ended_at: string | null
  status: SessionStatus
  termination_reason: string | null
  tool_order_used: string[]
  totals: Partial<SessionTotals>
}

export type RunBatchStatus = 'pending' | 'running' | 'completed' | 'aborted' | 'errored'

export interface RunBatch {
  id: string
  plan_version_id: string
  name: string
  requested_repetitions: number
  status: RunBatchStatus
  created_at: string
  started_at: string | null
  ended_at: string | null
}

export interface RunBatchSessionSummary {
  id: string
  batch_index: number
  status: SessionStatus
  termination_reason: string | null
  totals: Partial<SessionTotals>
}

export interface RunBatchProgress {
  id: string
  plan_version_id: string
  name: string
  status: RunBatchStatus
  requested_repetitions: number
  completed_count: number
  running_count: number
  pending_count: number
  current_session_id: string | null
  session_ids: string[]
  sessions: RunBatchSessionSummary[]
}

export interface Event {
  id: string
  session_id: string
  sequence_no: number
  timestamp: string
  type: string
  payload: Record<string, unknown>
  latency_ms: number | null
  token_usage: Record<string, number> | null
  tool_call_id: string | null
}

export interface SessionDetail extends Session {
  events: Event[]
  plan_version: PlanVersion
}

// ── Seed Preview ──────────────────────────────────────────────────────────

export interface SeedToolPreview {
  name: string
  description: string
  tags: string[]
  parameter_schema: Record<string, unknown>
}

// ── Export / Import ──────────────────────────────────────────────────────────

export interface ExportConflict {
  type: 'tool' | 'model_config' | 'plan'
  name: string
  message: string
}

export interface ImportCheckResult {
  has_conflicts: boolean
  conflicts: ExportConflict[]
}

export interface ImportResult {
  success: boolean
  error?: string
  conflicts?: ExportConflict[]
  imported_tools?: number
  imported_tool_versions?: number
  imported_model_configs?: number
  imported_plans?: number
  imported_plan_versions?: number
  imported_run_batches?: number
  imported_sessions?: number
  imported_events?: number
}
