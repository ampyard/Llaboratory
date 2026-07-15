import { useQuery } from '@tanstack/react-query'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, BarChart2, Sparkles, Clock, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react'
import { api } from '../api/client'
import { ModelCallsChart } from '../components/charts'

interface PerModelStats {
  calls: number
  errors: number
  hallucinated: number
  sessions: number
  total_tokens: number
}

interface ToolCallRecord {
  session_id: string
  model_name: string
  timestamp: string | null
  tool_call_id: string | null
  args: Record<string, unknown> | null
  output: unknown
  status: 'success' | 'error' | 'hallucinated'
  latency_ms: number | null
}

interface ToolAnalysis {
  tool_id: string
  tool_name: string
  session_count: number
  tool_calls: number
  tool_errors: number
  hallucinated_tool_calls: number
  error_rate: number
  latency_ms: { mean: number; min: number; max: number }
  total_tokens_stats: { mean: number; stdev: number; min: number; max: number }
  per_model: Record<string, PerModelStats>
  per_session: Record<string, unknown>[]
  calls_history: ToolCallRecord[]
}

function ChartCard({ title, subtitle, children }: { title: string; subtitle?: string; children?: React.ReactNode }) {
  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-center gap-2.5 mb-4">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-pink-500 flex items-center justify-center">
          <Sparkles className="w-4 h-4 text-white" />
        </div>
        <div>
          <h3 className="text-sm font-bold text-gray-800 leading-tight">{title}</h3>
          {subtitle && <p className="text-xs text-gray-400">{subtitle}</p>}
        </div>
      </div>
      {children}
    </div>
  )
}

export default function ToolStats() {
  const { toolId } = useParams<{ toolId: string }>()

  const { data: stats, isLoading } = useQuery({
    queryKey: ['tool-stats', toolId],
    queryFn: async () => {
      const raw = await api.analysis.tool(toolId!)
      return raw as unknown as ToolAnalysis
    },
    enabled: !!toolId,
  })

  return (
    <div className="p-6 max-w-5xl">
      {/* Breadcrumb */}
      <div className="flex items-center gap-3 mb-6">
        <Link to="/tools" className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
          <ArrowLeft className="w-4 h-4" /> Tools
        </Link>
        <span className="text-gray-300">/</span>
        {toolId && (
          <Link to={`/tools/${toolId}`} className="text-sm font-mono text-gray-400 hover:text-gray-600">
            {stats?.tool_name ?? toolId.slice(0, 8)}
          </Link>
        )}
        <span className="text-gray-300">/</span>
        <span className="text-sm font-semibold text-indigo-600">Stats</span>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Tool Stats{' '}
            <span className="text-gray-300 font-normal text-lg">| {stats?.tool_name ?? '…'}</span>
          </h1>
          <p className="text-sm text-gray-400 mt-0.5">
            Usage analytics from {stats?.session_count ?? 0} session(s)
          </p>
        </div>
      </div>

      {!toolId || isLoading ? (
        <div className="flex flex-col items-center justify-center py-24">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-500/20 to-pink-500/20 animate-pulse mb-4" />
          <p className="text-sm text-gray-400">Loading analytics...</p>
        </div>
      ) : !stats || stats.session_count === 0 ? (
        <div className="border-2 border-dashed border-gray-200 rounded-2xl p-16 text-center">
          <BarChart2 className="w-10 h-10 text-gray-200 mx-auto mb-3" />
          <p className="text-gray-500 text-sm font-medium">No session data yet</p>
          <p className="text-gray-400 text-xs mt-1">Run some sessions that use this tool to see stats.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Chart: Calls by Model */}
          {stats.per_model && Object.keys(stats.per_model).length > 0 && (
            <ChartCard
              title="Model Usage"
              subtitle="Which models called this tool and how often"
            >
              <ModelCallsChart per_model={stats.per_model} />
            </ChartCard>
          )}

          {/* Quick Stats Strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-gradient-to-br from-indigo-500 to-violet-500 rounded-2xl p-4 text-white">
              <p className="text-xs font-medium opacity-80">Total Calls</p>
              <p className="text-xl font-bold mt-1">{stats.tool_calls.toLocaleString()}</p>
            </div>
            <div className="bg-gradient-to-br from-emerald-500 to-teal-500 rounded-2xl p-4 text-white">
              <p className="text-xs font-medium opacity-80">Sessions</p>
              <p className="text-xl font-bold mt-1">{stats.session_count}</p>
            </div>
            <div className="bg-gradient-to-br from-cyan-500 to-blue-500 rounded-2xl p-4 text-white">
              <p className="text-xs font-medium opacity-80">Models</p>
              <p className="text-xl font-bold mt-1">{Object.keys(stats.per_model).length}</p>
            </div>
            <div className="bg-gradient-to-br from-amber-500 to-orange-500 rounded-2xl p-4 text-white">
              <p className="text-xs font-medium opacity-80">Error Rate</p>
              <p className="text-xl font-bold mt-1">{((stats.error_rate ?? 0) * 100).toFixed(1)}%</p>
            </div>
          </div>

          {/* Latency */}
          {stats.latency_ms && (
            <div className="bg-white border border-gray-200 rounded-2xl p-5">
              <h3 className="text-sm font-bold text-gray-800 mb-3">Latency (ms)</h3>
              <div className="grid grid-cols-3 gap-4">
                {([
                  ['Mean', stats.latency_ms.mean],
                  ['Min', stats.latency_ms.min],
                  ['Max', stats.latency_ms.max],
                ] as [string, number][]).map(([label, value]) => (
                  <div key={label} className="bg-gray-50 rounded-lg p-3 text-center">
                    <p className="text-xs text-gray-400 mb-1">{label}</p>
                    <p className="text-lg font-semibold text-gray-900">{value?.toLocaleString() ?? '—'}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Token Usage */}
          {stats.total_tokens_stats && (
            <div className="bg-white border border-gray-200 rounded-2xl p-5">
              <h3 className="text-sm font-bold text-gray-800 mb-3">Token Usage</h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {([
                  ['Mean', stats.total_tokens_stats.mean],
                  ['Min', stats.total_tokens_stats.min],
                  ['Max', stats.total_tokens_stats.max],
                  ['Stdev', stats.total_tokens_stats.stdev],
                ] as [string, number | null][]).map(([label, value]) => (
                  <div key={label} className="bg-gray-50 rounded-lg p-3 text-center">
                    <p className="text-xs text-gray-400 mb-1">{label}</p>
                    <p className="text-lg font-semibold text-gray-900">
                      {value != null ? Math.round(value).toLocaleString() : '—'}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Per-model detail table */}
          {stats.per_model && Object.keys(stats.per_model).length > 0 && (
            <div className="bg-white border border-gray-200 rounded-2xl p-5">
              <h3 className="text-sm font-bold text-gray-800 mb-3">Model Breakdown</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-gray-400 border-b border-gray-100">
                      <th className="pb-2 pr-4">Model</th>
                      <th className="pb-2 pr-4 text-right">Calls</th>
                      <th className="pb-2 pr-4 text-right">Sessions</th>
                      <th className="pb-2 pr-4 text-right">Errors</th>
                      <th className="pb-2 pr-4 text-right">Hallucinated</th>
                      <th className="pb-2 text-right">Tokens</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(stats.per_model)
                      .sort((a, b) => b[1].calls - a[1].calls)
                      .map(([model, m]) => (
                        <tr key={model} className="border-b border-gray-50 hover:bg-gray-50">
                          <td className="py-2 pr-4 font-mono text-gray-700 font-medium">{model}</td>
                          <td className="py-2 pr-4 text-right">{m.calls}</td>
                          <td className="py-2 pr-4 text-right">{m.sessions}</td>
                          <td className="py-2 pr-4 text-right">
                            <span className={m.errors > 0 ? 'text-rose-500' : 'text-gray-400'}>{m.errors}</span>
                          </td>
                          <td className="py-2 pr-4 text-right">
                            <span className={m.hallucinated > 0 ? 'text-amber-500' : 'text-gray-400'}>{m.hallucinated}</span>
                          </td>
                          <td className="py-2 text-right">{m.total_tokens.toLocaleString()}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Per-session breakdown */}
          {stats.per_session && (stats.per_session as Record<string, unknown>[]).length > 0 && (
            <div className="bg-white border border-gray-200 rounded-2xl p-5">
              <h3 className="text-sm font-bold text-gray-800 mb-3">Sessions</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-gray-400 border-b border-gray-100">
                      <th className="pb-2 pr-4">Session</th>
                      <th className="pb-2 pr-4">Model</th>
                      <th className="pb-2 pr-4">Status</th>
                      <th className="pb-2 pr-4">Run at</th>
                      <th className="pb-2 pr-4 text-right">Calls</th>
                      <th className="pb-2 pr-4 text-right">Errors</th>
                      <th className="pb-2 pr-4 text-right">Latency (ms)</th>
                      <th className="pb-2 text-right">Tokens</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(stats.per_session as Record<string, unknown>[]).map((row: Record<string, unknown>) => (
                      <tr key={row.session_id as string} className="border-b border-gray-50 hover:bg-gray-50">
                        <td className="py-2 pr-4 font-mono text-gray-500">
                          <Link to={`/sessions/${row.session_id}`} className="hover:text-indigo-600">
                            {(row.session_id as string).slice(0, 8)}…
                          </Link>
                        </td>
                        <td className="py-2 pr-4 font-mono text-gray-600 text-[11px]">
                          {row.model_name as string ?? '—'}
                        </td>
                        <td className="py-2 pr-4">{row.status as string}</td>
                        <td className="py-2 pr-4 text-gray-500 whitespace-nowrap">
                          {row.started_at
                            ? new Intl.DateTimeFormat('en-US', {
                                month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                              }).format(new Date(row.started_at as string))
                            : '—'}
                        </td>
                        <td className="py-2 pr-4 text-right">{row.tool_calls as number}</td>
                        <td className="py-2 pr-4 text-right">{row.tool_errors as number}</td>
                        <td className="py-2 pr-4 text-right">
                          {row.latency_ms
                            ? (row.latency_ms as Record<string, number>).mean?.toFixed(0)
                            : '—'}
                        </td>
                        <td className="py-2 text-right">
                          {row.total_tokens != null ? (row.total_tokens as number).toLocaleString() : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {/* Call History */}
          {stats.calls_history && stats.calls_history.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-2xl p-5">
              <h3 className="text-sm font-bold text-gray-800 mb-1">Call History</h3>
              <p className="text-xs text-gray-400 mb-4">All past invocations, most recent first</p>
              <div className="space-y-3">
                {stats.calls_history.map((record, idx) => {
                  const statusColor =
                    record.status === 'success'
                      ? 'bg-emerald-100 text-emerald-700'
                      : record.status === 'error'
                      ? 'bg-rose-100 text-rose-700'
                      : 'bg-amber-100 text-amber-700'

                  const StatusIcon =
                    record.status === 'success'
                      ? CheckCircle2
                      : record.status === 'error'
                      ? XCircle
                      : AlertTriangle

                  return (
                    <div
                      key={idx}
                      className="border border-gray-100 rounded-xl p-4 hover:bg-gray-50 transition-colors"
                    >
                      {/* Header row */}
                      <div className="flex flex-wrap items-center gap-2 mb-3">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${statusColor}`}
                        >
                          <StatusIcon className="w-3 h-3" />
                          {record.status}
                        </span>
                        {record.model_name && (
                          <span className="text-xs font-mono text-gray-500">{record.model_name}</span>
                        )}
                        <Link
                          to={`/sessions/${record.session_id}`}
                          className="text-xs font-mono text-indigo-400 hover:text-indigo-600"
                        >
                          {record.session_id.slice(0, 8)}…
                        </Link>
                        <span className="ml-auto flex items-center gap-1 text-xs text-gray-400 shrink-0">
                          {record.latency_ms != null && (
                            <>
                              <Clock className="w-3 h-3" />
                              {record.latency_ms}ms
                            </>
                          )}
                          {record.timestamp && (
                            <span className="ml-2">
                              {new Intl.DateTimeFormat('en-US', {
                                month: 'short',
                                day: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                                second: '2-digit',
                              }).format(new Date(record.timestamp))}
                            </span>
                          )}
                        </span>
                      </div>

                      {/* Args */}
                      {record.args != null && (
                        <details className="group mb-2">
                          <summary className="cursor-pointer text-xs font-semibold text-gray-500 hover:text-gray-800 select-none list-none flex items-center gap-1">
                            <span className="group-open:hidden">▶</span>
                            <span className="hidden group-open:inline">▼</span>
                            Inputs
                          </summary>
                          <pre className="mt-1 text-xs text-gray-700 bg-gray-50 border border-gray-100 rounded-lg p-3 overflow-auto max-h-48 whitespace-pre-wrap">
                            {JSON.stringify(record.args, null, 2)}
                          </pre>
                        </details>
                      )}

                      {/* Output */}
                      {record.output != null && (
                        <details className="group">
                          <summary className="cursor-pointer text-xs font-semibold text-gray-500 hover:text-gray-800 select-none list-none flex items-center gap-1">
                            <span className="group-open:hidden">▶</span>
                            <span className="hidden group-open:inline">▼</span>
                            {record.status === 'error' ? 'Error' : 'Output'}
                          </summary>
                          <pre
                            className={`mt-1 text-xs border rounded-lg p-3 overflow-auto max-h-48 whitespace-pre-wrap ${
                              record.status === 'error'
                                ? 'text-rose-700 bg-rose-50 border-rose-100'
                                : 'text-gray-700 bg-gray-50 border-gray-100'
                            }`}
                          >
                            {typeof record.output === 'string'
                              ? record.output
                              : JSON.stringify(record.output, null, 2)}
                          </pre>
                        </details>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
