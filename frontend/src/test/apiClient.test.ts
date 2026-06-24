/**
 * Tests for the API client — verifies URL construction, method selection,
 * and error handling without making real network requests.
 */
import { beforeEach, vi } from 'vitest'

// We test the URL/method shape by intercepting fetch
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

function okResponse(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status < 400,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as Response)
}

beforeEach(() => mockFetch.mockReset())

// Dynamic import so the stub is in place before the module loads
async function getApi() {
  const { api } = await import('../api/client')
  return api
}

describe('tools API', () => {
  test('list calls GET /api/tools', async () => {
    mockFetch.mockReturnValue(okResponse([]))
    const api = await getApi()
    await api.tools.list()
    expect(mockFetch).toHaveBeenCalledWith('/api/tools', expect.objectContaining({ headers: expect.any(Object) }))
  })

  test('create calls POST /api/tools with body', async () => {
    mockFetch.mockReturnValue(okResponse({ id: '1' }))
    const api = await getApi()
    const body = { name: 'search', version: {} }
    await api.tools.create(body)
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/tools')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual(body)
  })

  test('delete calls DELETE /api/tools/:id', async () => {
    mockFetch.mockReturnValue(okResponse(null, 204))
    const api = await getApi()
    await api.tools.delete('abc')
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/tools/abc')
    expect(init.method).toBe('DELETE')
  })

  test('addVersion calls POST /api/tools/:id/versions', async () => {
    mockFetch.mockReturnValue(okResponse({ id: 'v2' }))
    const api = await getApi()
    await api.tools.addVersion('tool-1', { display_name: 'v2' })
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/tools/tool-1/versions')
    expect(init.method).toBe('POST')
  })
})

describe('plans API', () => {
  test('clone calls POST /api/plans/:id/clone', async () => {
    mockFetch.mockReturnValue(okResponse({ id: 'plan-clone' }))
    const api = await getApi()
    await api.plans.clone('plan-1')
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/plans/plan-1/clone')
    expect(init.method).toBe('POST')
  })

  test('updateMeta calls PATCH /api/plans/:id with body', async () => {
    mockFetch.mockReturnValue(okResponse({ id: 'plan-1' }))
    const api = await getApi()
    const body = { name: 'new name', description: 'new desc' }
    await api.plans.updateMeta('plan-1', body)
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/plans/plan-1')
    expect(init.method).toBe('PATCH')
    expect(JSON.parse(init.body)).toEqual(body)
  })
})

describe('sessions API', () => {
  test('list with no params calls /api/sessions', async () => {
    mockFetch.mockReturnValue(okResponse([]))
    const api = await getApi()
    await api.sessions.list()
    expect(mockFetch.mock.calls[0][0]).toBe('/api/sessions')
  })

  test('list with plan_version_id appends query param', async () => {
    mockFetch.mockReturnValue(okResponse([]))
    const api = await getApi()
    await api.sessions.list({ plan_version_id: 'pv-1' })
    expect(mockFetch.mock.calls[0][0]).toBe('/api/sessions?plan_version_id=pv-1')
  })

  test('run calls POST /api/sessions/:id/run', async () => {
    mockFetch.mockReturnValue(okResponse({ status: 'running' }))
    const api = await getApi()
    await api.sessions.run('sess-1')
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/sessions/sess-1/run')
    expect(init.method).toBe('POST')
  })

  test('abort calls POST /api/sessions/:id/abort', async () => {
    mockFetch.mockReturnValue(okResponse({ status: 'aborted' }))
    const api = await getApi()
    await api.sessions.abort('sess-1')
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe('/api/sessions/sess-1/abort')
    expect(init.method).toBe('POST')
  })
})

describe('error handling', () => {
  test('throws on 4xx response with status code', async () => {
    mockFetch.mockReturnValue(okResponse({ detail: 'Not found' }, 404))
    const api = await getApi()
    await expect(api.tools.get('missing')).rejects.toThrow('404')
  })

  test('throws on 5xx response', async () => {
    mockFetch.mockReturnValue(okResponse('Internal Server Error', 500))
    const api = await getApi()
    await expect(api.tools.list()).rejects.toThrow('500')
  })
})

describe('analysis API', () => {
  test('exportCsvUrl returns correct URL', async () => {
    const api = await getApi()
    expect(api.analysis.exportCsvUrl('pv-123')).toBe('/api/analysis/plan-version/pv-123/export.csv')
  })
})
