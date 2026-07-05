import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { vi } from 'vitest'
import PlanBuilder from '../pages/PlanBuilder'
import { api } from '../api/client'

vi.mock('../api/client', () => ({
  api: {
    plans: { get: vi.fn(), create: vi.fn(), updateMeta: vi.fn(), addVersion: vi.fn() },
    tools: { list: vi.fn() },
    modelConfigs: { list: vi.fn() },
    sessions: { create: vi.fn(), run: vi.fn() },
  },
}))

function renderPlanBuilder(planId?: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const initialEntries = planId ? [`/plans/${planId}`] : ['/plans/new']
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={initialEntries}>
        <Routes>
          <Route path="/plans/new" element={<PlanBuilder />} />
          <Route path="/plans/:planId" element={<PlanBuilder />} />
          <Route path="/plans" element={<div>Plans Page</div>} />
          <Route path="/sessions/:sessionId" element={<div>Session Page</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

beforeEach(() => {
  vi.mocked(api.modelConfigs.list).mockResolvedValue([{
    id: 'mc1', name: 'GPT-4o', provider_kind: 'openai_compatible',
    base_url: 'https://api.openai.com/v1', model_snapshot: 'gpt-4o',
    api_key_env: 'OPENAI_API_KEY', params: {}, input_cost_per_1k: 0,
    output_cost_per_1k: 0, created_at: '2024-01-01T00:00:00Z',
  }] as never)
  vi.mocked(api.tools.list).mockResolvedValue([] as never)
})

test('renders timeout input with default 300 in new plan', async () => {
  renderPlanBuilder()
  const timeoutInput = await screen.findByDisplayValue('300')
  expect(timeoutInput).toBeInTheDocument()
  expect(timeoutInput).toHaveAttribute('type', 'number')
})

test('changing timeout updates the input value', async () => {
  renderPlanBuilder()
  const timeoutInput = await screen.findByDisplayValue('300')
  fireEvent.change(timeoutInput, { target: { value: '600' } })
  expect(timeoutInput).toHaveValue(600)
})

test('loads timeout from existing plan version', async () => {
  vi.mocked(api.plans.get).mockResolvedValue({
    id: 'p1', name: 'Test Plan', description: '',
    created_at: '2024-01-01T00:00:00Z',
    versions: [{
      id: 'pv1', plan_id: 'p1', version_number: 1,
      created_at: '2024-01-01T00:00:00Z',
      model_config_snapshot: {
        id: 'mc1', name: 'GPT-4o', provider_kind: 'openai_compatible',
        base_url: 'https://api.openai.com/v1', model_snapshot: 'gpt-4o',
        api_key_env: 'OPENAI_API_KEY', params: {},
        input_cost_per_1k: 0, output_cost_per_1k: 0, created_at: '2024-01-01T00:00:00Z',
      },
      system_prompt: 'You are helpful.', user_prompt: 'Hello',
      run_settings: {
        repetitions: 1, tool_order_strategy: 'fixed',
        max_turns: 10, max_tool_calls: 25, timeout_seconds: 120,
      },
      tool_versions: [],
    }],
  } as never)

  renderPlanBuilder('p1')
  const timeoutInput = await screen.findByDisplayValue('120')
  expect(timeoutInput).toBeInTheDocument()
})

test('sends timeout_seconds in run_settings when saving', async () => {
  vi.mocked(api.plans.create).mockResolvedValue({
    id: 'p2', name: 'New Plan', description: '',
    created_at: '2024-01-01T00:00:00Z',
    versions: [{
      id: 'pv2', plan_id: 'p2', version_number: 1,
      created_at: '2024-01-01T00:00:00Z',
      model_config_snapshot: {} as never,
      system_prompt: '', user_prompt: '',
      run_settings: {} as never, tool_versions: [],
    }],
  } as never)

  renderPlanBuilder()
  const nameInput = await screen.findByPlaceholderText('Tool-selection study v1')
  fireEvent.change(nameInput, { target: { value: 'Timeout Test' } })

  const timeoutInput = await screen.findByDisplayValue('300')
  fireEvent.change(timeoutInput, { target: { value: '450' } })

  const saveBtn = screen.getByText('Save Plan')
  fireEvent.click(saveBtn)

  await waitFor(() => {
    expect(vi.mocked(api.plans.create)).toHaveBeenCalledWith(expect.objectContaining({
      version: expect.objectContaining({
        run_settings: expect.objectContaining({
          timeout_seconds: 450,
        }),
      }),
    }))
  })
})
