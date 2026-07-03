import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, StopCircle, BarChart2, Loader2 } from 'lucide-react'
import { api } from '../api/client'
import StatusBadge from '../components/StatusBadge'

export default function BatchDetail() {
  const { planId, batchId } = useParams<{ planId: string; batchId: string }>()
  const qc = useQueryClient()

  const { data: batch, isLoading } = useQuery({
    queryKey: ['run-batches', batchId],
    queryFn: () => api.runBatches.get(batchId!),
    enabled: !!batchId,
    refetchInterval: (query) =>
      query.state.data?.status === 'pending' || query.state.data?.status === 'running' ? 1500 : false,
  })

  const { data: plan } = useQuery({
    queryKey: ['plans', planId],
    queryFn: () => api.plans.get(planId!),
    enabled: !!planId,
  })

  const abortMut = useMutation({
    mutationFn: () => api.runBatches.abort(batchId!),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['run-batches', batchId] }),
  })

  const isActive = batch?.status === 'pending' || batch?.status === 'running'
  const version = plan?.versions.find(v => v.id === batch?.plan_version_id)

  const completedSessions = batch?.sessions.filter(s => s.status === 'completed') ?? []
  const avg = (vals: number[]) => vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null
  const avgTurns = avg(completedSessions.map(s => s.totals.turns ?? 0))
  const avgCost = avg(completedSessions.map(s => s.totals.cost_usd ?? 0))
  const totalCost = completedSessions.reduce((sum, s) => sum + (s.totals.cost_usd ?? 0), 0)

  return (
    <div className="p-6 max-w-4xl">
      <div className="flex items-center gap-3 mb-6">
        <Link to="/plans" className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
          <ArrowLeft className="w-4 h-4" /> Plans
        </Link>
        <span className="text-gray-300">/</span>
        <span className="text-sm font-mono text-gray-400">{plan?.name ?? planId?.slice(0, 8)}</span>
        <span className="text-gray-300">/</span>
        <span className="text-sm text-gray-600">{batch?.name || 'Batch Run'}</span>
      </div>

      {isLoading && <p className="text-sm text-gray-400">Loading…</p>}

      {batch && (
        <>
          <div className="flex items-start justify-between mb-6">
            <div>
              <div className="flex items-center gap-3 mb-1">
                <h1 className="text-xl font-semibold">{batch.name || 'Batch Run'}</h1>
                <StatusBadge status={batch.status} />
              </div>
              <p className="text-sm text-gray-500">
                {version && (
                  <>
                    <Link to={`/plans/${planId}/versions`} className="text-indigo-500 hover:underline">
                      v{version.version_number}
                    </Link>
                    {' · '}
                    <span className="font-mono">{version.model_config_snapshot.model_snapshot}</span>
                    {' · '}
                  </>
                )}
                {batch.completed_count} / {batch.requested_repetitions} session(s) done
                {batch.running_count > 0 && <span className="text-blue-600"> · {batch.running_count} running</span>}
              </p>
            </div>
            {isActive && (
              <button
                onClick={() => abortMut.mutate()}
                disabled={abortMut.isPending}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600 text-white rounded-lg text-xs font-medium hover:bg-red-700 disabled:opacity-50"
              >
                <StopCircle className="w-3.5 h-3.5" /> Abort Batch
              </button>
            )}
          </div>

          <div className="w-full bg-gray-100 rounded-full h-2 mb-6 overflow-hidden">
            <div
              className="bg-indigo-600 h-2 rounded-full transition-all"
              style={{ width: `${(batch.completed_count / Math.max(batch.requested_repetitions, 1)) * 100}%` }}
            />
          </div>

          {version && (
            <Link
              to={`/plans/${planId}/stats?versionId=${version.id}&batchId=${batch.id}`}
              className="inline-flex items-center gap-1.5 mb-6 px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-medium hover:bg-indigo-700"
            >
              <BarChart2 className="w-3.5 h-3.5" /> View Stats
            </Link>
          )}

          {completedSessions.length > 0 && (
            <div className="grid grid-cols-3 gap-3 mb-6">
              <div className="bg-white border border-gray-200 rounded-xl p-3 text-center">
                <p className="text-xs text-gray-400 mb-1">Avg turns</p>
                <p className="text-lg font-semibold text-gray-900">{avgTurns?.toFixed(1) ?? '—'}</p>
              </div>
              <div className="bg-white border border-gray-200 rounded-xl p-3 text-center">
                <p className="text-xs text-gray-400 mb-1">Avg cost</p>
                <p className="text-lg font-semibold text-gray-900">${avgCost?.toFixed(5) ?? '—'}</p>
              </div>
              <div className="bg-white border border-gray-200 rounded-xl p-3 text-center">
                <p className="text-xs text-gray-400 mb-1">Total cost</p>
                <p className="text-lg font-semibold text-gray-900">${totalCost.toFixed(5)}</p>
              </div>
            </div>
          )}

          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <h2 className="text-sm font-semibold text-gray-700 mb-3">Sessions</h2>
            <div className="space-y-1.5">
              {batch.sessions.map((s) => {
                const isRunning = s.status === 'running'
                return (
                  <Link
                    key={s.id}
                    to={`/sessions/${s.id}`}
                    className={`flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors ${
                      isRunning
                        ? 'bg-blue-50 ring-1 ring-blue-300 hover:bg-blue-100 animate-glow-ring'
                        : 'hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      {isRunning && <Loader2 className="w-3.5 h-3.5 text-blue-600 animate-spin shrink-0" />}
                      <span className="text-gray-600">#{s.batch_index + 1}</span>
                      <StatusBadge status={s.status} />
                      {s.termination_reason && (
                        <span className="text-xs text-gray-400">{s.termination_reason}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-gray-400">
                      {s.status === 'completed' && (
                        <>
                          <span>{s.totals.turns ?? 0} turns</span>
                          <span>${(s.totals.cost_usd ?? 0).toFixed(5)}</span>
                        </>
                      )}
                      <span className="font-mono">{s.id.slice(0, 8)}…</span>
                    </div>
                  </Link>
                )
              })}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
