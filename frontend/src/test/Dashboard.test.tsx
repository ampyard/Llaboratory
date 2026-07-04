import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { vi } from 'vitest'
import Dashboard from '../pages/Dashboard'
import { api } from '../api/client'

vi.mock('../api/client', () => ({
  api: {
    tools: { list: vi.fn() },
    modelConfigs: { list: vi.fn() },
    plans: { list: vi.fn() },
    seed: { preview: vi.fn() },
  },
}))

function renderDashboard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/tools" element={<div>Tool Library Page</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

beforeEach(() => {
  vi.mocked(api.tools.list).mockResolvedValue([])
  vi.mocked(api.modelConfigs.list).mockResolvedValue([])
  vi.mocked(api.plans.list).mockResolvedValue([])
})

test('shows onboarding checklist when there are no plans', async () => {
  renderDashboard()
  expect(await screen.findByText('Welcome to Llaboratory')).toBeInTheDocument()
  expect(screen.getByText('Create a tool')).toBeInTheDocument()
  expect(screen.getByText('Configure a model')).toBeInTheDocument()
  expect(screen.getByText('Build & run a plan')).toBeInTheDocument()
})

test('marks tool step done once a tool exists', async () => {
  vi.mocked(api.tools.list).mockResolvedValue([{ id: 't1' }] as never)
  renderDashboard()
  await screen.findByText('Welcome to Llaboratory')
  expect(screen.queryByText('Create tool')).not.toBeInTheDocument()
})

test('marks model step done once a model config exists', async () => {
  vi.mocked(api.modelConfigs.list).mockResolvedValue([{ id: 'm1' }] as never)
  renderDashboard()
  await screen.findByText('Welcome to Llaboratory')
  expect(screen.queryByText('Configure model')).not.toBeInTheDocument()
})

test('redirects to /tools once a plan exists', async () => {
  vi.mocked(api.plans.list).mockResolvedValue([{ id: 'p1' }] as never)
  renderDashboard()
  await waitFor(() => expect(screen.getByText('Tool Library Page')).toBeInTheDocument())
  expect(screen.queryByText('Welcome to Llaboratory')).not.toBeInTheDocument()
})
