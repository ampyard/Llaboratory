import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import ModelConfigs from '../pages/ModelConfigs'
import { api } from '../api/client'

vi.mock('../api/client', () => ({
  api: {
    modelConfigs: { list: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
  },
}))

function renderModelConfigs() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ModelConfigs />
      </MemoryRouter>
    </QueryClientProvider>
  )
}

const mockConfig = {
  id: 'mc1', name: 'GPT-4o', provider_kind: 'openai_compatible',
  base_url: 'https://api.openai.com/v1', model_snapshot: 'gpt-4o',
  api_key_env: 'OPENAI_API_KEY',
  params: { temperature: 0.7, max_tokens: 4096, reasoning_effort: 'medium' },
  input_cost_per_1k: 0.15, output_cost_per_1k: 0.6,
  created_at: '2024-01-01T00:00:00Z',
}

beforeEach(() => {
  vi.mocked(api.modelConfigs.list).mockResolvedValue([mockConfig] as never)
})

test('renders reasoning effort select with default "Let the server choose"', async () => {
  renderModelConfigs()

  const newBtn = await screen.findByText('New Config')
  fireEvent.click(newBtn)

  const select = screen.getByLabelText('Reasoning effort')
  expect(select).toBeInTheDocument()
  expect(select).toHaveValue('')
})

test('can select reasoning effort values', async () => {
  renderModelConfigs()

  const newBtn = await screen.findByText('New Config')
  fireEvent.click(newBtn)

  const select = screen.getByLabelText('Reasoning effort') as HTMLSelectElement

  fireEvent.change(select, { target: { value: 'low' } })
  expect(select).toHaveValue('low')

  fireEvent.change(select, { target: { value: 'medium' } })
  expect(select).toHaveValue('medium')

  fireEvent.change(select, { target: { value: 'high' } })
  expect(select).toHaveValue('high')

  fireEvent.change(select, { target: { value: '' } })
  expect(select).toHaveValue('')
})

test('sends reasoning_effort in params when creating a config', async () => {
  vi.mocked(api.modelConfigs.create).mockResolvedValue({ id: 'new' } as never)
  renderModelConfigs()

  const newBtn = await screen.findByText('New Config')
  fireEvent.click(newBtn)

  fireEvent.change(screen.getByPlaceholderText('GPT-4o Mini'), { target: { value: 'Test Model' } })
  fireEvent.change(screen.getByPlaceholderText('openai/gpt-4o-mini'), { target: { value: 'test-model' } })

  const select = screen.getByLabelText('Reasoning effort')
  fireEvent.change(select, { target: { value: 'high' } })

  fireEvent.click(screen.getByText('Save'))

  await waitFor(() => {
    expect(vi.mocked(api.modelConfigs.create)).toHaveBeenCalledWith(expect.objectContaining({
      params: expect.objectContaining({ reasoning_effort: 'high' }),
    }))
  })
})

test('omits reasoning_effort from params when "Let the server choose"', async () => {
  vi.mocked(api.modelConfigs.create).mockResolvedValue({ id: 'new' } as never)
  renderModelConfigs()

  const newBtn = await screen.findByText('New Config')
  fireEvent.click(newBtn)

  fireEvent.change(screen.getByPlaceholderText('GPT-4o Mini'), { target: { value: 'Test Model' } })
  fireEvent.change(screen.getByPlaceholderText('openai/gpt-4o-mini'), { target: { value: 'test-model' } })

  fireEvent.click(screen.getByText('Save'))

  await waitFor(() => {
    expect(vi.mocked(api.modelConfigs.create)).toHaveBeenCalledWith(expect.objectContaining({
      params: expect.not.objectContaining({ reasoning_effort: expect.anything() }),
    }))
  })
})

test('loads reasoning_effort from existing config when editing', async () => {
  renderModelConfigs()

  const configName = await screen.findByText('GPT-4o')
  expect(configName).toBeInTheDocument()

  const [, editBtn] = screen.getAllByRole('button')
  fireEvent.click(editBtn)

  const select = screen.getByLabelText('Reasoning effort')
  expect(select).toHaveValue('medium')
})

test('renders the provider API style selector defaulting to Chat Completions', async () => {
  renderModelConfigs()
  fireEvent.click(await screen.findByText('New Config'))

  const styleSelect = screen.getByLabelText('API style')
  expect(styleSelect).toBeInTheDocument()
  expect(styleSelect).toHaveValue('openai_compatible')
})

test('sends provider_kind when creating a Responses API config', async () => {
  vi.mocked(api.modelConfigs.create).mockResolvedValue({ id: 'new' } as never)
  renderModelConfigs()
  fireEvent.click(await screen.findByText('New Config'))

  fireEvent.change(screen.getByPlaceholderText('GPT-4o Mini'), { target: { value: 'Test Model' } })
  fireEvent.change(screen.getByPlaceholderText('openai/gpt-4o-mini'), { target: { value: 'test-model' } })

  const styleSelect = screen.getByLabelText('API style') as HTMLSelectElement
  fireEvent.change(styleSelect, { target: { value: 'responses_api' } })
  expect(styleSelect).toHaveValue('responses_api')

  fireEvent.click(screen.getByText('Save'))

  await waitFor(() => {
    expect(vi.mocked(api.modelConfigs.create)).toHaveBeenCalledWith(expect.objectContaining({
      provider_kind: 'responses_api',
    }))
  })
})
