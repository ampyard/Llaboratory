import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { vi, beforeEach } from 'vitest'
import SessionDetail from '../pages/SessionDetail'
import { api } from '../api/client'

class MockEventSource {
  onopen: (() => void) | null = null
  onmessage: ((e: MessageEvent) => void) | null = null
  onerror: (() => void) | null = null
  close = vi.fn()
  constructor(_url: string | URL) {}
  addEventListener(_type: string, _listener: EventListenerOrEventListenerObject) {}
}
vi.stubGlobal('EventSource', MockEventSource)

vi.mock('../api/client', () => ({
  api: {
    sessions: {
      get: vi.fn(),
      delete: vi.fn(),
    },
    plans: { get: vi.fn() },
  },
}))

function renderDetail() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/sessions/sess-001']}>
        <Routes>
          <Route path="/sessions/:sessionId" element={<SessionDetail />} />
          <Route path="/sessions" element={<div>Sessions List Page</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

const mockSession = {
  id: 'sess-001',
  plan_version_id: 'pv-1',
  batch_id: null,
  batch_index: 0,
  started_at: '2025-06-01T10:00:00Z',
  ended_at: '2025-06-01T10:05:00Z',
  status: 'completed',
  termination_reason: 'max_turns',
  tool_order_used: [],
  totals: { turns: 5, tool_calls: 3, cost_usd: 0.002 },
  events: [],
  plan_version: {
    id: 'pv-1',
    plan_id: 'plan-1',
    version_number: 1,
    created_at: '2025-01-01T00:00:00Z',
    model_config_snapshot: { model_snapshot: 'gpt-4o-mini' },
    system_prompt: '',
    user_prompt: 'Hello',
    run_settings: { repetitions: 1, tool_order_strategy: 'fixed', max_turns: 20, max_tool_calls: 50, timeout_seconds: 300 },
    tool_versions: [],
  },
}

beforeEach(() => {
  vi.mocked(api.sessions.get).mockResolvedValue(mockSession as never)
  vi.mocked(api.sessions.delete).mockResolvedValue({} as never)
  vi.mocked(api.plans.get).mockResolvedValue({ id: 'plan-1', name: 'Test Plan' } as never)
  Element.prototype.scrollIntoView = vi.fn()
})

test('shows delete button for a completed session', async () => {
  renderDetail()
  expect(await screen.findByText('Delete')).toBeInTheDocument()
})

test('delete button opens reason dialog', async () => {
  renderDetail()
  await screen.findByText('Delete')
  await userEvent.click(screen.getByText('Delete'))
  expect(screen.getByRole('heading', { name: /delete session/i })).toBeInTheDocument()
  expect(screen.getByPlaceholderText(/provider outage/i)).toBeInTheDocument()
})

test('delete dialog submits reason and navigates to sessions list', async () => {
  renderDetail()
  await screen.findByText('Delete')
  await userEvent.click(screen.getByText('Delete'))
  const textarea = screen.getByPlaceholderText(/provider outage/i)
  await userEvent.type(textarea, 'bad data')
  await userEvent.click(screen.getByRole('button', { name: 'Delete Session' }))
  await waitFor(() => {
    expect(api.sessions.delete).toHaveBeenCalledWith('sess-001', 'bad data')
  })
  expect(screen.getByText('Sessions List Page')).toBeInTheDocument()
})

test('delete button hidden for running sessions', async () => {
  vi.mocked(api.sessions.get).mockResolvedValue({ ...mockSession, status: 'running' } as never)
  renderDetail()
  await screen.findByText('Abort')
  expect(screen.queryByText('Delete')).not.toBeInTheDocument()
})
