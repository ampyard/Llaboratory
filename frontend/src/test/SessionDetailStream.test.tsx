import { render, screen } from '@testing-library/react'
import { act } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { vi, beforeEach } from 'vitest'
import SessionDetail from '../pages/SessionDetail'
import { api } from '../api/client'

// A MockEventSource that actually records listeners so tests can dispatch
// SSE messages and observe how SessionDetail's live view reacts, unlike the
// no-op stub in SessionDetail.test.tsx.
let lastInstance: MockEventSource | null = null

class MockEventSource {
  listeners: Record<string, ((e: MessageEvent) => void)[]> = {}
  close = vi.fn()
  constructor(_url: string | URL) {
    lastInstance = this
  }
  addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    const fn = typeof listener === 'function' ? listener : listener.handleEvent.bind(listener)
    this.listeners[type] = [...(this.listeners[type] ?? []), fn as (e: MessageEvent) => void]
  }
  emit(type: string, data: unknown) {
    for (const fn of this.listeners[type] ?? []) {
      fn({ data: JSON.stringify(data) } as MessageEvent)
    }
  }
}
vi.stubGlobal('EventSource', MockEventSource)

vi.mock('../api/client', () => ({
  api: {
    sessions: { get: vi.fn() },
    plans: { get: vi.fn() },
  },
}))

const basePlanVersion = {
  id: 'pv-1',
  plan_id: 'plan-1',
  version_number: 1,
  created_at: '2025-01-01T00:00:00Z',
  model_config_snapshot: { model_snapshot: 'gpt-4o-mini' },
  system_prompt: '',
  user_prompt: 'Hello',
  run_settings: { repetitions: 1, tool_order_strategy: 'fixed', max_turns: 20, max_tool_calls: 50, timeout_seconds: 300 },
  tool_versions: [],
}

function baseSession(events: unknown[]) {
  return {
    id: 'sess-001',
    plan_version_id: 'pv-1',
    batch_id: null,
    batch_index: 0,
    started_at: '2025-06-01T10:00:00Z',
    ended_at: null,
    status: 'running',
    termination_reason: null,
    tool_order_used: [],
    totals: {},
    events,
    plan_version: basePlanVersion,
  }
}

function renderDetail(qc: QueryClient) {
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/sessions/sess-001']}>
        <Routes>
          <Route path="/sessions/:sessionId" element={<SessionDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

function evt(type: string, sequence_no: number, payload: Record<string, unknown>, tool_call_id: string | null = null) {
  return {
    id: `evt-${sequence_no}`,
    session_id: 'sess-001',
    sequence_no,
    timestamp: '2025-06-01T10:00:00Z',
    type,
    payload,
    latency_ms: null,
    token_usage: null,
    tool_call_id,
  }
}

beforeEach(() => {
  lastInstance = null
  vi.mocked(api.plans.get).mockResolvedValue({ id: 'plan-1', name: 'Test Plan' } as never)
  Element.prototype.scrollIntoView = vi.fn()
})

test('turn1 (think->tool->tool->tool) stays visible when a mid-run refetch lands, and through turn2 streaming', async () => {
  vi.mocked(api.sessions.get).mockResolvedValue(baseSession([]) as never)
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 } } })
  renderDetail(qc)
  await screen.findByText(/streaming/i)
  const es = lastInstance!

  // Turn 1: reasoning + 3 tool calls, all live via SSE (nothing persisted yet).
  act(() => {
    es.emit('message', { type: 'model_request', sequence_no: 0, payload: { messages: [], tools: [] } })
    es.emit('message', {
      type: 'model_response',
      sequence_no: 1,
      payload: {
        content_parts: [
          { type: 'reasoning', content: 'Turn one thinking.' },
          { type: 'tool_call', name: 'open_document', raw_args: '{"doc_id":"a"}', tool_call_id: 'c1' },
          { type: 'tool_call', name: 'open_document', raw_args: '{"doc_id":"b"}', tool_call_id: 'c2' },
          { type: 'tool_call', name: 'open_document', raw_args: '{"doc_id":"c"}', tool_call_id: 'c3' },
        ],
        finish_reason: 'tool_call',
      },
    })
    es.emit('message', { type: 'tool_call', sequence_no: 2, payload: { name: 'open_document', parsed_args: { doc_id: 'a' } }, tool_call_id: 'c1' })
    es.emit('message', { type: 'tool_result', sequence_no: 3, payload: { name: 'open_document', result: {} }, tool_call_id: 'c1' })
    es.emit('message', { type: 'tool_call', sequence_no: 4, payload: { name: 'open_document', parsed_args: { doc_id: 'b' } }, tool_call_id: 'c2' })
    es.emit('message', { type: 'tool_result', sequence_no: 5, payload: { name: 'open_document', result: {} }, tool_call_id: 'c2' })
    es.emit('message', { type: 'tool_call', sequence_no: 6, payload: { name: 'open_document', parsed_args: { doc_id: 'c' } }, tool_call_id: 'c3' })
    es.emit('message', { type: 'tool_result', sequence_no: 7, payload: { name: 'open_document', result: {} }, tool_call_id: 'c3' })
  })

  expect(screen.getByText('Turn one thinking.')).toBeInTheDocument()
  expect(screen.getAllByText('open_document').length).toBeGreaterThan(0)

  // Simulate a background refetch landing mid-run (e.g. window focus / staleTime
  // expiry) that now returns turn 1 as persisted DB history.
  const turn1Events = [
    evt('model_request', 0, { messages: [], tools: [] }),
    evt('model_response', 1, {
      content_parts: [
        { type: 'reasoning', content: 'Turn one thinking.' },
        { type: 'tool_call', name: 'open_document', raw_args: '{"doc_id":"a"}', tool_call_id: 'c1' },
        { type: 'tool_call', name: 'open_document', raw_args: '{"doc_id":"b"}', tool_call_id: 'c2' },
        { type: 'tool_call', name: 'open_document', raw_args: '{"doc_id":"c"}', tool_call_id: 'c3' },
      ],
      finish_reason: 'tool_call',
    }),
    evt('tool_call', 2, { name: 'open_document', parsed_args: { doc_id: 'a' } }, 'c1'),
    evt('tool_result', 3, { name: 'open_document', result: {} }, 'c1'),
    evt('tool_call', 4, { name: 'open_document', parsed_args: { doc_id: 'b' } }, 'c2'),
    evt('tool_result', 5, { name: 'open_document', result: {} }, 'c2'),
    evt('tool_call', 6, { name: 'open_document', parsed_args: { doc_id: 'c' } }, 'c3'),
    evt('tool_result', 7, { name: 'open_document', result: {} }, 'c3'),
  ]
  vi.mocked(api.sessions.get).mockResolvedValue(baseSession(turn1Events) as never)
  await act(async () => {
    await qc.refetchQueries({ queryKey: ['sessions', 'sess-001'] })
  })

  // Turn 1 must still be visible after the switch from liveEvents to persisted events.
  expect(screen.getByText('Turn one thinking.')).toBeInTheDocument()
  expect(screen.getAllByText('open_document').length).toBeGreaterThan(0)

  // Turn 2 starts streaming.
  act(() => {
    es.emit('message', { type: 'model_request', sequence_no: 8, payload: { messages: [], tools: [] } })
    es.emit('message', { type: 'stream_delta', kind: 'reasoning_delta', data: 'Turn two thinking.' })
  })

  // Bug: turn 1 disappears, turn 2's reasoning shows as if it were the first block.
  expect(screen.getByText('Turn one thinking.')).toBeInTheDocument()
  expect(screen.getAllByText('open_document').length).toBeGreaterThan(0)
  expect(screen.getByText('Turn two thinking.')).toBeInTheDocument()
})

test('EventSource replaying turn1 history a second time (native reconnect) then turn2 streaming', async () => {
  vi.mocked(api.sessions.get).mockResolvedValue(baseSession([]) as never)
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
  renderDetail(qc)
  await screen.findByText(/streaming/i)
  const es = lastInstance!

  const turn1Live = [
    { type: 'model_request', sequence_no: 0, payload: { messages: [], tools: [] } },
    {
      type: 'model_response',
      sequence_no: 1,
      payload: {
        content_parts: [
          { type: 'reasoning', content: 'Turn one thinking.' },
          { type: 'tool_call', name: 'open_document', raw_args: '{"doc_id":"a"}', tool_call_id: 'c1' },
          { type: 'tool_call', name: 'open_document', raw_args: '{"doc_id":"b"}', tool_call_id: 'c2' },
          { type: 'tool_call', name: 'open_document', raw_args: '{"doc_id":"c"}', tool_call_id: 'c3' },
        ],
        finish_reason: 'tool_call',
      },
    },
    { type: 'tool_call', sequence_no: 2, payload: { name: 'open_document', parsed_args: { doc_id: 'a' } }, tool_call_id: 'c1' },
    { type: 'tool_result', sequence_no: 3, payload: { name: 'open_document', result: {} }, tool_call_id: 'c1' },
    { type: 'tool_call', sequence_no: 4, payload: { name: 'open_document', parsed_args: { doc_id: 'b' } }, tool_call_id: 'c2' },
    { type: 'tool_result', sequence_no: 5, payload: { name: 'open_document', result: {} }, tool_call_id: 'c2' },
    { type: 'tool_call', sequence_no: 6, payload: { name: 'open_document', parsed_args: { doc_id: 'c' } }, tool_call_id: 'c3' },
    { type: 'tool_result', sequence_no: 7, payload: { name: 'open_document', result: {} }, tool_call_id: 'c3' },
  ]

  act(() => {
    for (const e of turn1Live) es.emit('message', e)
  })
  expect(screen.getAllByText('Turn one thinking.').length).toBe(1)

  // Simulate the browser's native EventSource silently reconnecting mid-run
  // (same JS object, listeners persist) and the backend replaying full
  // history to the fresh server-side connection.
  act(() => {
    for (const e of turn1Live) es.emit('message', e)
  })
  // A reconnect (native EventSource retry, or a fresh connection) replays
  // already-seen events from the server — dedup by sequence_no must keep
  // this to a single render, not a duplicate.
  expect(screen.getAllByText('Turn one thinking.').length).toBe(1)
  expect(screen.getAllByText('open_document').length).toBe(9)

  act(() => {
    es.emit('message', { type: 'model_request', sequence_no: 8, payload: { messages: [], tools: [] } })
    es.emit('message', { type: 'stream_delta', kind: 'reasoning_delta', data: 'Turn two thinking.' })
  })

  expect(screen.getAllByText('Turn one thinking.').length).toBe(1)
  expect(screen.getAllByText('open_document').length).toBe(9)
  expect(screen.getByText('Turn two thinking.')).toBeInTheDocument()
})
