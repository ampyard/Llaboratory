import { useQuery } from '@tanstack/react-query'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, BarChart2, Download } from 'lucide-react'
import { api } from '../api/client'

export default function PlanStats() {
  const { planId } = useParams<{ planId: string }>()

  const { data: plan } = useQuery({
    queryKey: ['plans', planId],
    queryFn: () => api.plans.get(planId!),
    enabled: !!planId,
  })

  const latest = plan?.versions[plan.versions.length - 1]

  const { data: analysis, isLoading } = useQuery({
    queryKey: ['analysis', latest?.id],
    queryFn: () => api.analysis.planVersion(latest!.id),
    enabled: !!latest,
  })

  return (
    <div className="p-6 max-w-4xl">
      <div className="flex items-center gap-3 mb-6">
        <Link to="/plans" className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
          <ArrowLeft className="w-4 h-4" /> Plans
        </Link>
        <span className="text-gray-300">/</span>
        <span className="text-sm font-mono text-gray-400">{plan?.name ?? planId?.slice(0, 8)}</span>
        <span className="text-gray-300">/</span>
        <span className="text-sm text-gray-600">Stats</span>
      </div>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold">Plan Stats</h1>
          {plan && (
            <p className="text-sm text-gray-500 mt-0.5">{plan.name}</p>
          )}
        </div>
        {latest && analysis && (
          <a
            href={api.analysis.exportCsvUrl(latest.id)}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 text-gray-600 rounded-lg text-xs font-medium hover:bg-gray-50"
          >
            <Download className="w-3.5 h-3.5" /> CSV
          </a>
        )}
      </div>

      {!planId || isLoading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : !analysis ? (
        <div className="border-2 border-dashed border-gray-200 rounded-xl p-12 text-center">
          <BarChart2 className="w-8 h-8 text-gray-300 mx-auto mb-2" />
          <p className="text-gray-400 text-sm">No session data yet for this plan.</p>
          <p className="text-gray-400 text-xs mt-1">Run some sessions to see stats here.</p>
        </div>
      ) : (() => {
        const s = analysis as Record<string, unknown>
        const sessionCount = s.session_count as number
        return (
          <div className="space-y-6">
            {/* Overview */}
            <div className="bg-white border border-gray-200 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-4">
                <BarChart2 className="w-4 h-4 text-indigo-600" />
                <h2 className="text-sm font-semibold text-gray-700">Overview</h2>
                <span className="text-xs text-gray-400">({sessionCount} session(s))</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {([
                  ['Completed', s.completed],
                  ['Errored', s.errored],
                  ['Aborted', s.aborted],
                  ['No tool call', `${((s.no_tool_call_rate as number) * 100).toFixed(0)}%`],
                ] as [string, unknown][]).map(([label, value]) => (
                  <div key={label} className="text-center bg-gray-50 rounded-lg p-3">
                    <p className="text-xs text-gray-400 mb-1">{label}</p>
                    <p className="text-lg font-semibold text-gray-900">{String(value)}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Averages */}
            {!!s.turns_stats && (
              <div className="bg-white border border-gray-200 rounded-xl p-4">
                <h2 className="text-sm font-semibold text-gray-700 mb-3">Averages</h2>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                  {([
                    ['Avg turns', s.turns_stats],
                    ['Avg cost', s.cost_usd_stats],
                    ['Avg total tokens', s.total_tokens_stats],
                  ] as [string, unknown][]).map(([label, stats]) =>
                    stats ? (
                      <div key={label} className="bg-gray-50 rounded-lg p-3">
                        <p className="text-xs text-gray-400 mb-2">{label}</p>
                        <div className="space-y-1">
                          <div className="flex justify-between text-sm">
                            <span className="text-gray-500">Mean</span>
                            <span className="font-semibold text-gray-900">
                              {label === 'Avg cost'
                                ? `$${((stats as Record<string, number>).mean ?? 0).toFixed(5)}`
                                : label === 'Avg total tokens'
                                ? Math.round((stats as Record<string, number>).mean ?? 0).toLocaleString()
                                : ((stats as Record<string, number>).mean ?? 0).toFixed(1)}
                            </span>
                          </div>
                          <div className="flex justify-between text-sm">
                            <span className="text-gray-500">Min</span>
                            <span className="text-gray-700">
                              {label === 'Avg cost'
                                ? `$${((stats as Record<string, number>).min ?? 0).toFixed(5)}`
                                : label === 'Avg total tokens'
                                ? Math.round((stats as Record<string, number>).min ?? 0).toLocaleString()
                                : ((stats as Record<string, number>).min ?? 0).toFixed(1)}
                            </span>
                          </div>
                          <div className="flex justify-between text-sm">
                            <span className="text-gray-500">Max</span>
                            <span className="text-gray-700">
                              {label === 'Avg cost'
                                ? `$${((stats as Record<string, number>).max ?? 0).toFixed(5)}`
                                : label === 'Avg total tokens'
                                ? Math.round((stats as Record<string, number>).max ?? 0).toLocaleString()
                                : ((stats as Record<string, number>).max ?? 0).toFixed(1)}
                            </span>
                          </div>
                        </div>
                      </div>
                    ) : null
                  )}
                </div>
              </div>
            )}

            {/* Tool Selection */}
            {!!s.tool_selection_counts && (
              <div className="bg-white border border-gray-200 rounded-xl p-4">
                <h2 className="text-sm font-semibold text-gray-700 mb-3">Tool Selection Frequency</h2>
                <div className="space-y-3">
                  {Object.entries(s.tool_selection_counts as Record<string, number>).map(([tool, count]) => (
                    <div key={tool}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm text-gray-700">{tool}</span>
                        <span className="text-xs text-gray-500">{count}</span>
                      </div>
                      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-indigo-500 rounded-full"
                          style={{ width: `${((count / sessionCount) * 100).toFixed(1)}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Per-session breakdown */}
            {!!s.per_session && (
              <div className="bg-white border border-gray-200 rounded-xl p-4">
                <h2 className="text-sm font-semibold text-gray-700 mb-3">Sessions</h2>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-gray-400 border-b border-gray-100">
                        <th className="pb-2 pr-4">Session</th>
                        <th className="pb-2 pr-4">Status</th>
                        <th className="pb-2 pr-4">Run at</th>
                        <th className="pb-2 pr-4 text-right">Turns</th>
                        <th className="pb-2 pr-4 text-right">Tool calls</th>
                        <th className="pb-2 pr-4 text-right">Cost</th>
                        <th className="pb-2 text-right">Tokens</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(s.per_session as Record<string, unknown>[]).map((row: Record<string, unknown>) => (
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
                          <td className="py-2 pr-4 text-right">{row.turns as number}</td>
                          <td className="py-2 pr-4 text-right">{row.total_tool_calls as number}</td>
                          <td className="py-2 pr-4 text-right">
                            {row.cost_usd != null ? `$${(row.cost_usd as number).toFixed(5)}` : '—'}
                          </td>
                          <td className="py-2 text-right">{row.total_tokens != null ? (row.total_tokens as number).toLocaleString() : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )
      })()}
    </div>
  )
}
