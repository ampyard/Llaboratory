import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, BarChart2, ChevronDown, ChevronRight } from 'lucide-react'
import { api } from '../api/client'
import RunSplitButton from '../components/RunSplitButton'
import type { PlanVersion } from '../types'

export default function PlanVersions() {
  const { planId } = useParams<{ planId: string }>()
  const { data: plan, isLoading } = useQuery({
    queryKey: ['plans', planId],
    queryFn: () => api.plans.get(planId!),
    enabled: !!planId,
  })

  const versions = plan ? [...plan.versions].reverse() : []

  return (
    <div className="p-6 max-w-4xl">
      <div className="flex items-center gap-3 mb-6">
        <Link to="/plans" className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
          <ArrowLeft className="w-4 h-4" /> Plans
        </Link>
        <span className="text-gray-300">/</span>
        <span className="text-sm font-mono text-gray-400">{plan?.name ?? planId?.slice(0, 8)}</span>
        <span className="text-gray-300">/</span>
        <span className="text-sm text-gray-600">Versions</span>
      </div>

      <div className="mb-6">
        <h1 className="text-xl font-semibold">Version History</h1>
        {plan && (
          <p className="text-sm text-gray-500 mt-0.5">
            {plan.name} · {plan.versions.length} version(s)
          </p>
        )}
      </div>

      {isLoading && <p className="text-sm text-gray-400">Loading…</p>}

      <div className="space-y-3">
        {versions.map((v, i) => (
          <VersionCard key={v.id} version={v} isLatest={i === 0} planId={planId!} />
        ))}
      </div>
    </div>
  )
}

function VersionCard({
  version,
  isLatest,
  planId,
}: {
  version: PlanVersion
  isLatest: boolean
  planId: string
}) {
  const [expanded, setExpanded] = useState(isLatest)
  const qc = useQueryClient()
  const navigate = useNavigate()

  async function runOnce() {
    const session = await api.sessions.create(version.id)
    await api.sessions.run(session.id)
    qc.invalidateQueries({ queryKey: ['sessions'] })
    navigate(`/sessions/${session.id}`)
  }

  async function runBatch(name: string, repetitions: number) {
    const batch = await api.runBatches.create(version.id, repetitions, name)
    qc.invalidateQueries({ queryKey: ['sessions'] })
    navigate(`/plans/${planId}/runs/${batch.id}`)
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <div
        className="flex items-center gap-3 p-4 cursor-pointer hover:bg-gray-50 transition-colors"
        onClick={() => setExpanded(e => !e)}
      >
        {expanded
          ? <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />
          : <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />}

        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className="text-sm font-semibold text-gray-900">v{version.version_number}</span>
          {isLatest && (
            <span className="text-xs bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded">latest</span>
          )}
          <span className="text-xs text-gray-400">
            {new Intl.DateTimeFormat('en-US', {
              month: 'short', day: 'numeric', year: 'numeric',
              hour: '2-digit', minute: '2-digit',
            }).format(new Date(version.created_at))}
          </span>
        </div>

        <div className="flex items-center gap-4 text-xs text-gray-400 shrink-0">
          <span>{version.tool_versions.length} tool(s)</span>
          <span className="font-mono">{version.model_config_snapshot.model_snapshot}</span>
          <span>{version.run_settings.max_turns} turns max</span>
        </div>

        <div
          className="flex items-center gap-2 shrink-0 ml-4"
          onClick={e => e.stopPropagation()}
        >
          <RunSplitButton
            onRunOnce={runOnce}
            onRunBatch={runBatch}
            defaultRepetitions={version.run_settings.repetitions}
          />
          <Link
            to={`/plans/${planId}/stats?versionId=${version.id}`}
            className="p-1.5 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded"
            title="View stats for this version"
          >
            <BarChart2 className="w-4 h-4" />
          </Link>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-gray-100 p-4 space-y-4 bg-gray-50">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <p className="text-xs font-medium text-gray-500 mb-1">System prompt</p>
              <pre className="text-xs text-gray-700 bg-white border border-gray-200 rounded-lg p-3 whitespace-pre-wrap break-words max-h-40 overflow-y-auto font-sans">
                {version.system_prompt || <span className="text-gray-400 italic">none</span>}
              </pre>
            </div>
            <div>
              <p className="text-xs font-medium text-gray-500 mb-1">User prompt</p>
              <pre className="text-xs text-gray-700 bg-white border border-gray-200 rounded-lg p-3 whitespace-pre-wrap break-words max-h-40 overflow-y-auto font-sans">
                {version.user_prompt || <span className="text-gray-400 italic">none</span>}
              </pre>
            </div>
          </div>

          <div>
            <p className="text-xs font-medium text-gray-500 mb-2">Run settings</p>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              {([
                ['Repetitions', version.run_settings.repetitions],
                ['Max turns', version.run_settings.max_turns],
                ['Max tool calls', version.run_settings.max_tool_calls],
                ['Timeout (s)', version.run_settings.timeout_seconds],
                ['Tool order', version.run_settings.tool_order_strategy],
              ] as [string, string | number][]).map(([label, value]) => (
                <div key={label} className="bg-white border border-gray-200 rounded-lg p-2 text-center">
                  <p className="text-xs text-gray-400">{label}</p>
                  <p className="text-sm font-medium text-gray-800 mt-0.5 break-all">{value}</p>
                </div>
              ))}
            </div>
          </div>

          {version.tool_versions.length > 0 && (
            <div>
              <p className="text-xs font-medium text-gray-500 mb-2">
                Tools ({version.tool_versions.length})
              </p>
              <div className="flex flex-wrap gap-1.5">
                {version.tool_versions.map(tv => (
                  <span
                    key={tv.id}
                    className="text-xs bg-white border border-gray-200 text-gray-700 px-2 py-1 rounded-full"
                  >
                    {tv.display_name}{' '}
                    <span className="text-gray-400">v{tv.version_number}</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          <div>
            <p className="text-xs font-medium text-gray-500 mb-2">Model</p>
            <div className="flex flex-wrap items-center gap-3 text-xs text-gray-600">
              <span className="font-mono bg-white border border-gray-200 px-2 py-1 rounded">
                {version.model_config_snapshot.model_snapshot}
              </span>
              <span className="text-gray-400">
                provider: {version.model_config_snapshot.provider_kind}
              </span>
              <span className="text-gray-400">
                in: ${version.model_config_snapshot.input_cost_per_1k}/1k · out: ${version.model_config_snapshot.output_cost_per_1k}/1k
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
