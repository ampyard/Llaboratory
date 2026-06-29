import { useQuery } from '@tanstack/react-query'
import { useParams, Link, useSearchParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, BarChart2, Download, FileText, Sparkles } from 'lucide-react'
import { api } from '../api/client'
import { ToolCallSankey, TerminationAndCost, HallucinationChart } from '../components/charts'

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

export default function PlanStats() {
  const { planId } = useParams<{ planId: string }>()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const versionIdParam = searchParams.get('versionId')

  const { data: plan } = useQuery({
    queryKey: ['plans', planId],
    queryFn: () => api.plans.get(planId!),
    enabled: !!planId,
  })

  const targetVersion = versionIdParam
    ? plan?.versions.find(v => v.id === versionIdParam)
    : plan?.versions[plan.versions.length - 1]

  const { data: analysis, isLoading } = useQuery({
    queryKey: ['analysis', targetVersion?.id],
    queryFn: () => api.analysis.planVersion(targetVersion!.id),
    enabled: !!targetVersion,
  })

  return (
    <div className="p-6 max-w-5xl">
      {/* Breadcrumb */}
      <div className="flex items-center gap-3 mb-6">
        <Link to="/plans" className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
          <ArrowLeft className="w-4 h-4" /> Plans
        </Link>
        <span className="text-gray-300">/</span>
        {planId && (
          <Link to={`/plans/${planId}/versions`} className="text-sm font-mono text-gray-400 hover:text-gray-600">
            {plan?.name ?? planId.slice(0, 8)}
          </Link>
        )}
        <span className="text-gray-300">/</span>
        <span className="text-sm font-semibold text-indigo-600">Visualization</span>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {plan?.name ?? 'Plan'}{' '}
            <span className="text-gray-300 font-normal text-lg"> | v{targetVersion?.version_number}</span>
          </h1>
          <p className="text-sm text-gray-400 mt-0.5">
            Interactive results from {(analysis as any)?.session_count ?? 0} session(s)
          </p>
        </div>
        <div className="flex items-center gap-2">
          {plan && plan.versions.length > 1 && (
            <select
              value={targetVersion?.id ?? ''}
              onChange={e => navigate(`/plans/${planId}/stats?versionId=${e.target.value}`)}
              className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 text-gray-600 bg-white hover:border-gray-300 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            >
              {[...plan.versions].reverse().map(v => (
                <option key={v.id} value={v.id}>
                  v{v.version_number}{v.version_number === plan.versions.length ? ' (latest)' : ''}
                </option>
              ))}
            </select>
          )}
          {targetVersion && analysis && (
            <>
              <Link
                to={`/plans/${planId}/report${versionIdParam ? `?versionId=${versionIdParam}` : ''}`}
                className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 text-gray-600 rounded-lg text-xs font-medium hover:bg-gray-50 transition-colors"
              >
                <FileText className="w-3.5 h-3.5" /> Report
              </Link>
              <a
                href={api.analysis.exportCsvUrl(targetVersion.id)}
                className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 text-gray-600 rounded-lg text-xs font-medium hover:bg-gray-50 transition-colors"
              >
                <Download className="w-3.5 h-3.5" /> CSV
              </a>
            </>
          )}
        </div>
      </div>

      {/* Loading / Empty */}
      {!planId || isLoading ? (
        <div className="flex flex-col items-center justify-center py-24">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-500/20 to-pink-500/20 animate-pulse mb-4" />
          <p className="text-sm text-gray-400">Loading analytics...</p>
        </div>
      ) : !analysis || (analysis as any).session_count === 0 ? (
        <div className="border-2 border-dashed border-gray-200 rounded-2xl p-16 text-center">
          <BarChart2 className="w-10 h-10 text-gray-200 mx-auto mb-3" />
          <p className="text-gray-500 text-sm font-medium">No session data yet</p>
          <p className="text-gray-400 text-xs mt-1">Run some sessions on this plan version to see vibrant visualizations.</p>
        </div>
      ) : (() => {
        const s = analysis as Record<string, unknown>
        const perSession = (s.per_session as Record<string, unknown>[]) ?? []
        const sessionCount = s.session_count as number

        return (
          <div className="space-y-6">
            {/* Chart Row: Termination Pie + Cost Histogram */}
            <ChartCard
              title="Session Outcomes & Cost"
              subtitle={`${sessionCount} sessions - ${(s.completed as number ?? 0)} completed`}
            >
              <TerminationAndCost sessions={perSession as any} />
            </ChartCard>

            {/* Chart: Tool Call Flow (Sankey) */}
            <ChartCard
              title="Tool Call Flow"
              subtitle="Which tools did the model reach for, and in what order?"
            >
              <ToolCallSankey sessions={perSession as any} />
            </ChartCard>

            {/* Chart: Hallucination / Error Analysis */}
            <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow">
              <div className="flex items-center gap-2.5 mb-4">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-rose-500 to-amber-500 flex items-center justify-center">
                  <Sparkles className="w-4 h-4 text-white" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-gray-800 leading-tight">Tool Reliability</h3>
                  <p className="text-xs text-gray-400">Valid calls vs errors - where does the model struggle?</p>
                </div>
              </div>
              <HallucinationChart sessions={perSession as any} />
            </div>

            {/* Quick Stats Strip */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {([
                {
                  label: 'Avg turns',
                  value: (s.turns_stats as any)?.mean?.toFixed(1) ?? '-',
                  color: 'from-indigo-500 to-violet-500',
                },
                {
                  label: 'Avg cost',
                  value: `$${(s.cost_usd_stats as any)?.mean?.toFixed(5) ?? '-'}`,
                  color: 'from-emerald-500 to-teal-500',
                },
                {
                  label: 'Avg tokens',
                  value: Math.round((s.total_tokens_stats as any)?.mean ?? 0).toLocaleString() || '-',
                  color: 'from-cyan-500 to-blue-500',
                },
                {
                  label: 'No-tool rate',
                  value: `${(((s.no_tool_call_rate as number) ?? 0) * 100).toFixed(0)}%`,
                  color: 'from-amber-500 to-orange-500',
                },
              ]).map(stat => (
                <div
                  key={stat.label}
                  className={`bg-gradient-to-br ${stat.color} rounded-2xl p-4 text-white`}
                >
                  <p className="text-xs font-medium opacity-80">{stat.label}</p>
                  <p className="text-xl font-bold mt-1">{stat.value}</p>
                </div>
              ))}
            </div>

            {/* Tool Selection Table */}
            {!!s.tool_selection_counts && Object.keys(s.tool_selection_counts as any).length > 0 && (
              <div className="bg-white border border-gray-200 rounded-2xl p-5">
                <h3 className="text-sm font-bold text-gray-800 mb-3">Tool Selection Frequency</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3">
                  {Object.entries(s.tool_selection_counts as Record<string, number>)
                    .sort((a, b) => b[1] - a[1])
                    .map(([tool, count], i) => {
                      const pct = (count / sessionCount) * 100
                      const colors = ['from-indigo-500 to-pink-500', 'from-cyan-500 to-blue-500', 'from-emerald-500 to-teal-500', 'from-amber-500 to-orange-500', 'from-violet-500 to-purple-500']
                      const grad = colors[i % colors.length]
                      return (
                        <div key={tool}>
                          <div className="flex items-center justify-between mb-1.5">
                            <span className="text-sm font-semibold text-gray-700 font-mono">{tool}</span>
                            <span className="text-xs text-gray-400">{count} calls ({pct.toFixed(0)}%)</span>
                          </div>
                          <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden">
                            <div
                              className={`h-full bg-gradient-to-r ${grad} rounded-full transition-all duration-500`}
                              style={{ width: `${Math.min(pct, 100)}%` }}
                            />
                          </div>
                        </div>
                      )
                    })}
                </div>
              </div>
            )}
          </div>
        )
      })()}
    </div>
  )
}
