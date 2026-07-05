import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { vi } from 'vitest'
import Sessions from '../pages/Sessions'
import { api } from '../api/client'

vi.mock('../api/client', () => ({
  api: {
    sessions: {
      list: vi.fn(),
      delete: vi.fn(),
    },
    plans: { list: vi.fn() },
  },
}))

function renderSessions() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/sessions']}>
        <Routes>
          <Route path="/sessions" element={<Sessions />} />
          <Route path="/sessions/audit-logs" element={<div>Audit Logs Page</div>} />
          <Route path="/sessions/:sessionId" element={<div>Session Detail Page</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

const mockSessions = [
  {
    id: 'sess-001',
    plan_version_id: 'pv-1',
    batch_id: null,
    batch_index: 0,
    started_at: '2025-06-01T10:00:00Z',
    ended_at: '2025-06-01T10:05:00Z',
    status: 'completed' as const,
    termination_reason: 'max_turns',
    tool_order_used: [],
    totals: { turns: 5, tool_calls: 3, cost_usd: 0.002 },
  },
  {
    id: 'sess-002',
    plan_version_id: 'pv-2',
    batch_id: null,
    batch_index: 0,
    started_at: null,
    ended_at: null,
    status: 'running' as const,
    termination_reason: null,
    tool_order_used: [],
    totals: {},
  },
]

beforeEach(() => {
  vi.mocked(api.sessions.list).mockResolvedValue(mockSessions as never)
  vi.mocked(api.plans.list).mockResolvedValue([])
})

test('renders session list with delete buttons', async () => {
  renderSessions()
  await screen.findByText(/sess-001/)
  expect(screen.getByText(/sess-001/)).toBeInTheDocument()
  const deleteButtons = screen.getAllByTitle('Delete session')
  expect(deleteButtons).toHaveLength(1)
})

test('renders Audit Log link in header', async () => {
  renderSessions()
  await screen.findByText('Audit Log')
  expect(screen.getByText('Audit Log')).toBeInTheDocument()
})

test('shows delete dialog on trash click', async () => {
  renderSessions()
  await screen.findByText(/sess-001/)
  const deleteBtn = screen.getAllByTitle('Delete session')[0]
  await userEvent.click(deleteBtn)
  expect(screen.getByRole('heading', { name: /delete session/i })).toBeInTheDocument()
  expect(screen.getByPlaceholderText(/provider outage/i)).toBeInTheDocument()
})

test('delete dialog calls api.sessions.delete with reason', async () => {
  vi.mocked(api.sessions.delete).mockResolvedValue({} as never)
  renderSessions()
  await screen.findByText(/sess-001/)
  const deleteBtn = screen.getAllByTitle('Delete session')[0]
  await userEvent.click(deleteBtn)
  const textarea = screen.getByPlaceholderText(/provider outage/i)
  await userEvent.type(textarea, 'test removal reason')
  const confirmBtn = screen.getByRole('button', { name: 'Delete Session' })
  await userEvent.click(confirmBtn)
  await waitFor(() => {
    expect(api.sessions.delete).toHaveBeenCalledWith('sess-001', 'test removal reason')
  })
})

test('running session delete button is disabled', async () => {
  renderSessions()
  const disabledBtn = await screen.findByTitle('Cannot delete a running session')
  expect(disabledBtn).toBeDisabled()
})

test('navigates to audit logs page on link click', async () => {
  renderSessions()
  await screen.findByText('Audit Log')
  await userEvent.click(screen.getByText('Audit Log'))
  expect(screen.getByText('Audit Logs Page')).toBeInTheDocument()
})
