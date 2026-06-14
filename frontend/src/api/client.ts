import type {
  Tool, ToolVersion, ModelConfig, Plan, PlanVersion,
  Session, SessionDetail, Event,
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

  analysis: {
    planVersion: (id: string) => req<Record<string, unknown>>(`/analysis/plan-version/${id}`),
    exportCsvUrl: (id: string) => `${BASE}/analysis/plan-version/${id}/export.csv`,
  },
}
