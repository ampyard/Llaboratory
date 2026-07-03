import { useQuery } from '@tanstack/react-query'
import { useParams, Link, useSearchParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, BarChart2, Download, FileText, Sparkles } from 'lucide-react'
import { api } from '../api/client'
import { ToolCallSankey, TerminationAndCost, HallucinationChart } from '../components/charts'

interface AnalysisSession {
  session_id: string
  status: string
  termination_reason: string | null
  started_at: string | null
  any_tool_called: boolean
  tool_calls: Record<string, number>
  tool_sequence: string[]
  hallucinated_tool_calls: number
  tool_errors: number
  turns: number
  total_tool_calls: number
  input_tokens: number
  output_tokens: number
  cost_usd: number
  wall_clock_ms: number
  first_tool: string | null
}

interface Analysis {
  plan_version_id: string
  session_count: number
  completed: number
  errored: number
  aborted: number
  no_tool_call_rate: number
  tool_selection_counts: Record<string, number>
  first_tool_distribution: Record<string, number>
  turns_stats: { mean: number; stdev: number; min: number; max: number }
  cost_usd_stats: { mean: number; stdev: number; min: number; max: number }
  total_tokens_stats: { mean: number; stdev: number; min: number; max: number }
  per_session: AnalysisSession[]
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

export default function PlanStats() {
  const { planId } = useParams<{ planId: string }>()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const versionIdParam = searchParams.get('versionId')
  const batchIdParam = searchParams.get('batchId')

  const { data: plan } = useQuery({
    queryKey: ['plans', planId],
    queryFn: () => api.plans.get(planId!),
    enabled: !!planId,
  })

  const targetVersion = versionIdParam
    ? plan?.versions.find(v => v.id === versionIdParam)
    : plan?.versions[plan.versions.length - 1]

  const { data: analysis, isLoading } = useQuery({
    queryKey: ['analysis', targetVersion?.id, batchIdParam],
    queryFn: () => api.analysis.planVersion(targetVersion!.id, batchIdParam ?? undefined) as unknown as Promise<Analysis>,
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
            {batchIdParam
              ? `Interactive results from this batch (${analysis?.session_count ?? 0} session(s))`
              : `Interactive results from all ${analysis?.session_count ?? 0} session(s)`}
            {batchIdParam && (
              <>
                {' · '}
                <Link
                  to={`/plans/${planId}/stats${versionIdParam ? `?versionId=${versionIdParam}` : ''}`}
                  className="text-indigo-500 hover:text-indigo-700 hover:underline"
                >
                  view all history
                </Link>
              </>
            )}
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
      ) : !analysis || analysis.session_count === 0 ? (
        <div className="border-2 border-dashed border-gray-200 rounded-2xl p-16 text-center">
          <BarChart2 className="w-10 h-10 text-gray-200 mx-auto mb-3" />
          <p className="text-gray-500 text-sm font-medium">No session data yet</p>
          <p className="text-gray-400 text-xs mt-1">Run some sessions on this plan version to see vibrant visualizations.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Chart Row: Termination Pie + Cost Histogram */}
          <ChartCard
            title="Session Outcomes & Cost"
            subtitle={`${analysis.session_count} sessions - ${analysis.completed} completed`}
          >
            <TerminationAndCost sessions={analysis.per_session} />
          </ChartCard>

          {/* Chart: Tool Call Flow (Sankey) */}
          <ChartCard
            title="Tool Call Flow"
            subtitle="Which tools did the model reach for, and in what order?"
          >
            <ToolCallSankey sessions={analysis.per_session} />
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
            <HallucinationChart sessions={analysis.per_session} />
          </div>

          {/* Quick Stats Strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-gradient-to-br from-indigo-500 to-violet-500 rounded-2xl p-4 text-white">
              <p className="text-xs font-medium opacity-80">Avg turns</p>
              <p className="text-xl font-bold mt-1">{analysis.turns_stats?.mean?.toFixed(1) ?? '-'}</p>
            </div>
            <div className="bg-gradient-to-br from-emerald-500 to-teal-500 rounded-2xl p-4 text-white">
              <p className="text-xs font-medium opacity-80">Avg cost</p>
              <p className="text-xl font-bold mt-1">${analysis.cost_usd_stats?.mean?.toFixed(5) ?? '-'}</p>
            </div>
            <div className="bg-gradient-to-br from-cyan-500 to-blue-500 rounded-2xl p-4 text-white">
              <p className="text-xs font-medium opacity-80">Avg tokens</p>
              <p className="text-xl font-bold mt-1">{Math.round(analysis.total_tokens_stats?.mean ?? 0).toLocaleString() || '-'}</p>
            </div>
            <div className="bg-gradient-to-br from-amber-500 to-orange-500 rounded-2xl p-4 text-white">
              <p className="text-xs font-medium opacity-80">No-tool rate</p>
              <p className="text-xl font-bold mt-1">{((analysis.no_tool_call_rate ?? 0) * 100).toFixed(0)}%</p>
            </div>
          </div>

          {/* Tool Selection Table */}
          {analysis.tool_selection_counts && Object.keys(analysis.tool_selection_counts).length > 0 && (
            <div className="bg-white border border-gray-200 rounded-2xl p-5">
              <h3 className="text-sm font-bold text-gray-800 mb-3">Tool Selection Frequency</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3">
                {Object.entries(analysis.tool_selection_counts)
                  .sort((a, b) => b[1] - a[1])
                  .map(([tool, count], i) => {
                    const pct = (count / analysis.session_count) * 100
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
      )}
    </div>
  )
}
