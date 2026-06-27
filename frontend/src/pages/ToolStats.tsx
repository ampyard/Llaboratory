import { useQuery } from '@tanstack/react-query'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, BarChart2, Wrench } from 'lucide-react'
import { api } from '../api/client'

export default function ToolStats() {
  const { toolId } = useParams<{ toolId: string }>()

  const { data: stats, isLoading } = useQuery({
    queryKey: ['tool-stats', toolId],
    queryFn: () => api.analysis.tool(toolId!),
    enabled: !!toolId,
  })

  return (
    <div className="p-6 max-w-4xl">
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
        <span className="text-sm text-gray-600">Stats</span>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold">Tool Stats</h1>
          {stats?.tool_name && <p className="text-sm text-gray-500 mt-0.5">{stats.tool_name}</p>}
        </div>
      </div>

      {!toolId || isLoading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : !stats || stats.session_count === 0 ? (
        <div className="border-2 border-dashed border-gray-200 rounded-xl p-12 text-center">
          <BarChart2 className="w-8 h-8 text-gray-300 mx-auto mb-2" />
          <p className="text-gray-400 text-sm">No session data yet for this tool.</p>
          <p className="text-gray-400 text-xs mt-1">Run some sessions that use this tool to see stats.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Overview */}
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-4">
              <BarChart2 className="w-4 h-4 text-indigo-600" />
              <h2 className="text-sm font-semibold text-gray-700">Overview</h2>
              <span className="text-xs text-gray-400">({stats.session_count} session(s))</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {([
                ['Total Calls', stats.tool_calls],
                ['Errors', stats.tool_errors],
                ['Hallucinated', stats.hallucinated_tool_calls],
                ['Error Rate', `${((stats.error_rate as number) * 100).toFixed(1)}%`],
              ] as [string, unknown][]).map(([label, value]) => (
                <div key={label} className="text-center bg-gray-50 rounded-lg p-3">
                  <p className="text-xs text-gray-400 mb-1">{label}</p>
                  <p className="text-lg font-semibold text-gray-900">{String(value)}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Latency */}
          {stats.latency_ms && (
            <div className="bg-white border border-gray-200 rounded-xl p-4">
              <h2 className="text-sm font-semibold text-gray-700 mb-3">Latency (ms)</h2>
              <div className="grid grid-cols-3 gap-4">
                {([
                  ['Mean', (stats.latency_ms as Record<string, number>).mean],
                  ['Min', (stats.latency_ms as Record<string, number>).min],
                  ['Max', (stats.latency_ms as Record<string, number>).max],
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
            <div className="bg-white border border-gray-200 rounded-xl p-4">
              <h2 className="text-sm font-semibold text-gray-700 mb-3">Token Usage</h2>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {([
                  ['Mean', (stats.total_tokens_stats as Record<string, number>).mean],
                  ['Min', (stats.total_tokens_stats as Record<string, number>).min],
                  ['Max', (stats.total_tokens_stats as Record<string, number>).max],
                  ['Stdev', (stats.total_tokens_stats as Record<string, number>).stdev],
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

          {/* Per-session breakdown */}
          {stats.per_session && (stats.per_session as Record<string, unknown>[]).length > 0 && (
            <div className="bg-white border border-gray-200 rounded-xl p-4">
              <h2 className="text-sm font-semibold text-gray-700 mb-3">Sessions</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-gray-400 border-b border-gray-100">
                      <th className="pb-2 pr-4">Session</th>
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
        </div>
      )}
    </div>
  )
}
