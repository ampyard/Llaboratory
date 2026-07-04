import type {
  Tool, ToolVersion, ModelConfig, Plan, PlanVersion,
  Session, SessionDetail, Event, RunBatch, RunBatchProgress,
  ImportCheckResult, ImportResult, SeedToolPreview,
} from '../types'

const BASE = '/api'

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`${res.status}: ${text}`)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

// ── Tools ─────────────────────────────────────────────────────────────────

export const api = {
  tools: {
    list: () => req<Tool[]>('/tools'),
    get: (id: string) => req<Tool>(`/tools/${id}`),
    create: (body: unknown) => req<Tool>('/tools', { method: 'POST', body: JSON.stringify(body) }),
    updateMeta: (id: string, body: unknown) =>
      req<Tool>(`/tools/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    addVersion: (id: string, body: unknown) =>
      req<ToolVersion>(`/tools/${id}/versions`, { method: 'POST', body: JSON.stringify(body) }),
    delete: (id: string) => req<void>(`/tools/${id}`, { method: 'DELETE' }),
    clone: (id: string) => req<Tool>(`/tools/${id}/clone`, { method: 'POST' }),
  },

  modelConfigs: {
    list: () => req<ModelConfig[]>('/model-configs'),
    get: (id: string) => req<ModelConfig>(`/model-configs/${id}`),
    create: (body: unknown) =>
      req<ModelConfig>('/model-configs', { method: 'POST', body: JSON.stringify(body) }),
    update: (id: string, body: unknown) =>
      req<ModelConfig>(`/model-configs/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    delete: (id: string) => req<void>(`/model-configs/${id}`, { method: 'DELETE' }),
  },

  plans: {
    list: () => req<Plan[]>('/plans'),
    get: (id: string) => req<Plan>(`/plans/${id}`),
    create: (body: unknown) => req<Plan>('/plans', { method: 'POST', body: JSON.stringify(body) }),
    updateMeta: (id: string, body: unknown) =>
      req<Plan>(`/plans/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    addVersion: (id: string, body: unknown) =>
      req<PlanVersion>(`/plans/${id}/versions`, { method: 'POST', body: JSON.stringify(body) }),
    clone: (id: string) => req<Plan>(`/plans/${id}/clone`, { method: 'POST' }),
    delete: (id: string) => req<void>(`/plans/${id}`, { method: 'DELETE' }),
  },

  sessions: {
    list: (params?: { plan_version_id?: string; status?: string }) => {
      const qs = params ? '?' + new URLSearchParams(params as Record<string, string>).toString() : ''
      return req<Session[]>(`/sessions${qs}`)
    },
    get: (id: string) => req<SessionDetail>(`/sessions/${id}`),
    create: (plan_version_id: string) =>
      req<Session>('/sessions', { method: 'POST', body: JSON.stringify({ plan_version_id }) }),
    run: (id: string) => req<Session>(`/sessions/${id}/run`, { method: 'POST' }),
    abort: (id: string) => req<Session>(`/sessions/${id}/abort`, { method: 'POST' }),
    events: (id: string) => req<Event[]>(`/sessions/${id}/events`),
    metrics: (id: string) => req<Record<string, unknown>>(`/sessions/${id}/metrics`),
  },

  runBatches: {
    list: (plan_version_id?: string) =>
      req<RunBatch[]>(`/run-batches${plan_version_id ? `?plan_version_id=${plan_version_id}` : ''}`),
    create: (plan_version_id: string, repetitions?: number, name?: string) =>
      req<RunBatch>('/run-batches', { method: 'POST', body: JSON.stringify({ plan_version_id, repetitions, name }) }),
    get: (id: string) => req<RunBatchProgress>(`/run-batches/${id}`),
    abort: (id: string) => req<RunBatch>(`/run-batches/${id}/abort`, { method: 'POST' }),
  },

  analysis: {
    planVersion: (id: string, batchId?: string) =>
      req<Record<string, unknown>>(`/analysis/plan-version/${id}${batchId ? `?batch_id=${batchId}` : ''}`),
    tool: (id: string) => req<Record<string, unknown>>(`/analysis/tool/${id}`),
    exportCsvUrl: (id: string) => `${BASE}/analysis/plan-version/${id}/export.csv`,
    reportUrl: (id: string) => `${BASE}/analysis/plan-version/${id}/report.md`,
    reportDownloadUrl: (id: string) => `${BASE}/analysis/plan-version/${id}/report.md?download=1`,
    fetchReport: (id: string) => fetch(`${BASE}/analysis/plan-version/${id}/report.md`).then(r => r.text()),
  },

  export: {
    download: async (body: { tool_ids?: string[]; model_config_ids?: string[]; plan_ids?: string[] }) => {
      const res = await fetch(`${BASE}/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`)
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const disposition = res.headers.get('Content-Disposition') || ''
      const match = disposition.match(/filename="(.+?)"/)
      a.download = match ? match[1] : 'llaboratory-export.zip'
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    },
  },

  factoryReset: () => req<{ success: boolean }>('/factory-reset', { method: 'POST' }),
  seed: Object.assign(
    () => req<{ success: boolean }>('/seed', { method: 'POST' }),
    { preview: () => req<SeedToolPreview[]>('/seed/preview') },
  ),

  import: {
    check: async (file: File): Promise<ImportCheckResult> => {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch(`${BASE}/import/check`, { method: 'POST', body: form })
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`)
      return res.json()
    },
    run: async (file: File, renameMap: Record<string, Record<string, string>>): Promise<ImportResult> => {
      const form = new FormData()
      form.append('file', file)
      form.append('rename_map', JSON.stringify(renameMap))
      const res = await fetch(`${BASE}/import`, { method: 'POST', body: form })
      if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`)
      return res.json()
    },
  },
}
