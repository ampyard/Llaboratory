import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import ModelConfigs from '../pages/ModelConfigs'
import { api } from '../api/client'

// Mock the API client
vi.mock('../api/client', () => ({
  api: {
    modelConfigs: {
      list: vi.fn(),
      test: vi.fn(),
      delete: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}))

const mockConfigs = [
  {
    id: 'mc-1',
    name: 'GPT-4o Mini',
    base_url: 'https://openrouter.ai/api/v1',
    model_snapshot: 'openai/gpt-4o-mini',
    api_key_env: 'OPENROUTER_API_KEY',
    input_cost_per_1k: 0.00015,
    output_cost_per_1k: 0.0006,
    params: { temperature: 1, max_tokens: 4096 },
    created_at: '2024-01-01T00:00:00Z',
  },
  {
    id: 'mc-2',
    name: 'Claude Sonnet',
    base_url: 'https://api.anthropic.com/v1',
    model_snapshot: 'claude-sonnet-4',
    api_key_env: 'ANTHROPIC_API_KEY',
    input_cost_per_1k: 0.003,
    output_cost_per_1k: 0.015,
    params: { temperature: 1, max_tokens: 4096 },
    created_at: '2024-01-01T00:00:00Z',
  },
]

function renderWithProvider() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <ModelConfigs />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(api.modelConfigs.list).mockResolvedValue(mockConfigs)
})

test('renders model configs list', async () => {
  renderWithProvider()

  await waitFor(() => {
    expect(screen.getByText('GPT-4o Mini')).toBeInTheDocument()
    expect(screen.getByText('Claude Sonnet')).toBeInTheDocument()
  })

  expect(screen.getByText('openai/gpt-4o-mini')).toBeInTheDocument()
  expect(screen.getByText('claude-sonnet-4')).toBeInTheDocument()
})

test('shows test button for each config', async () => {
  renderWithProvider()

  await waitFor(() => {
    expect(screen.getAllByText('Test')).toHaveLength(2)
  })
})

test('test button shows loading state when testing', async () => {
  const user = userEvent.setup()
  vi.mocked(api.modelConfigs.test).mockImplementation(
    () => new Promise(() => {}) // Never resolves
  )

  renderWithProvider()

  await waitFor(() => {
    expect(screen.getAllByText('Test')).toHaveLength(2)
  })

  const testButtons = screen.getAllByText('Test')
  await user.click(testButtons[0])

  expect(screen.getByText('Testing…')).toBeInTheDocument()
})

test('shows success toast on successful test', async () => {
  const user = userEvent.setup()
  vi.mocked(api.modelConfigs.test).mockResolvedValue({
    success: true,
    message: 'Model configuration test successful',
    response: 'test successful',
    token_usage: { input_tokens: 10, output_tokens: 5 },
  })

  renderWithProvider()

  await waitFor(() => {
    expect(screen.getAllByText('Test')).toHaveLength(2)
  })

  const testButtons = screen.getAllByText('Test')
  await user.click(testButtons[0])

  await waitFor(() => {
    expect(screen.getByText('Model configuration test successful')).toBeInTheDocument()
  })
})

test('shows error toast on failed test', async () => {
  const user = userEvent.setup()
  vi.mocked(api.modelConfigs.test).mockRejectedValue(
    new Error('Provider error: Auth failure — check your API key env var')
  )

  renderWithProvider()

  await waitFor(() => {
    expect(screen.getAllByText('Test')).toHaveLength(2)
  })

  const testButtons = screen.getAllByText('Test')
  await user.click(testButtons[0])

  await waitFor(() => {
    expect(
      screen.getByText('Provider error: Auth failure — check your API key env var')
    ).toBeInTheDocument()
  })
})

test('test button calls API with correct config id', async () => {
  const user = userEvent.setup()
  vi.mocked(api.modelConfigs.test).mockResolvedValue({
    success: true,
    message: 'Model configuration test successful',
    response: 'test successful',
    token_usage: { input_tokens: 10, output_tokens: 5 },
  })

  renderWithProvider()

  await waitFor(() => {
    expect(screen.getAllByText('Test')).toHaveLength(2)
  })

  const testButtons = screen.getAllByText('Test')
  await user.click(testButtons[1]) // Click second test button

  await waitFor(() => {
    expect(api.modelConfigs.test).toHaveBeenCalledWith('mc-2')
  })
})

test('displays config details correctly', async () => {
  renderWithProvider()

  await waitFor(() => {
    expect(screen.getByText('GPT-4o Mini')).toBeInTheDocument()
  })

  expect(screen.getByText('https://openrouter.ai/api/v1')).toBeInTheDocument()
  expect(screen.getByText(/OPENROUTER_API_KEY/)).toBeInTheDocument()
  expect(screen.getByText(/In: \$0.00015\/1k/)).toBeInTheDocument()
  expect(screen.getByText(/Out: \$0.0006\/1k/)).toBeInTheDocument()
})

test('shows empty state when no configs', async () => {
  vi.mocked(api.modelConfigs.list).mockResolvedValue([])

  renderWithProvider()

  await waitFor(() => {
    expect(screen.queryByText('GPT-4o Mini')).not.toBeInTheDocument()
  })
})
