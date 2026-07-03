import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { api } from '../api/client'
import StatusBadge from '../components/StatusBadge'
import type { RunBatch } from '../types'

export default function Batches() {
  const { data: batches = [], isLoading } = useQuery({
    queryKey: ['run-batches'],
    queryFn: () => api.runBatches.list(),
    refetchInterval: 3000,
  })

  const { data: plans = [] } = useQuery({ queryKey: ['plans'], queryFn: api.plans.list })

  const versionMap = useMemo(() => {
    const map: Record<string, { planName: string; versionNumber: number; planId: string }> = {}
    for (const plan of plans) {
      for (const v of plan.versions) {
        map[v.id] = { planName: plan.name, versionNumber: v.version_number, planId: plan.id }
      }
    }
    return map
  }, [plans])

  return (
    <div className="p-6 max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold">Batch Runs</h1>
          <p className="text-sm text-gray-500 mt-0.5">All repeated-run (N-repetition) trials</p>
        </div>
      </div>

      {isLoading && <p className="text-sm text-gray-400">Loading…</p>}

      {!isLoading && batches.length === 0 && (
        <div className="border-2 border-dashed border-gray-200 rounded-xl p-12 text-center">
          <p className="text-gray-400 text-sm">No batch runs yet. Run a plan with repetitions &gt; 1 to start one.</p>
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        {batches.map((batch, i) => (
          <BatchRow key={batch.id} batch={batch} border={i > 0} planInfo={versionMap[batch.plan_version_id]} />
        ))}
      </div>
    </div>
  )
}

function BatchRow({
  batch,
  border,
  planInfo,
}: {
  batch: RunBatch
  border: boolean
  planInfo?: { planName: string; versionNumber: number; planId: string }
}) {
  return (
    <div className={`flex items-center gap-4 px-4 py-3 hover:bg-gray-50 transition-colors ${border ? 'border-t border-gray-100' : ''}`}>
      <Link to={`/plans/${planInfo?.planId ?? ''}/runs/${batch.id}`} className="flex items-center gap-4 flex-1 min-w-0">
        <StatusBadge status={batch.status} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-700 truncate">{batch.name || batch.id.slice(0, 8) + '…'}</p>
          <p className="text-xs text-gray-400">
            {new Date(batch.created_at).toLocaleString()}
          </p>
        </div>
      </Link>
      <div className="flex items-center gap-4 text-xs text-gray-400 shrink-0">
        <span>{batch.requested_repetitions} repetition(s)</span>
        {planInfo && (
          <Link
            to={`/plans/${planInfo.planId}/stats?versionId=${batch.plan_version_id}&batchId=${batch.id}`}
            onClick={e => e.stopPropagation()}
            className="text-xs text-indigo-500 hover:text-indigo-700 hover:underline whitespace-nowrap"
            title="View plan version"
          >
            {planInfo.planName} <span className="text-indigo-400">v{planInfo.versionNumber}</span>
          </Link>
        )}
      </div>
      <Link to={`/plans/${planInfo?.planId ?? ''}/runs/${batch.id}`}>
        <ChevronRight className="w-4 h-4 text-gray-300 shrink-0" />
      </Link>
    </div>
  )
}
