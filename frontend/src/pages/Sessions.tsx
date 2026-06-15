import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { api } from '../api/client'
import StatusBadge from '../components/StatusBadge'
import type { Session } from '../types'

export default function Sessions() {
  const { data: sessions = [], isLoading } = useQuery({
    queryKey: ['sessions'],
    queryFn: () => api.sessions.list(),
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
          <h1 className="text-xl font-semibold">Sessions</h1>
          <p className="text-sm text-gray-500 mt-0.5">All test session runs</p>
        </div>
      </div>

      {isLoading && <p className="text-sm text-gray-400">Loading…</p>}

      {!isLoading && sessions.length === 0 && (
        <div className="border-2 border-dashed border-gray-200 rounded-xl p-12 text-center">
          <p className="text-gray-400 text-sm">No sessions yet. Run a plan to start a session.</p>
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        {sessions.map((session, i) => (
          <SessionRow key={session.id} session={session} border={i > 0} planInfo={versionMap[session.plan_version_id]} />
        ))}
      </div>
    </div>
  )
}

function SessionRow({
  session,
  border,
  planInfo,
}: {
  session: Session
  border: boolean
  planInfo?: { planName: string; versionNumber: number; planId: string }
}) {
  const totals = session.totals
  return (
    <div className={`flex items-center gap-4 px-4 py-3 hover:bg-gray-50 transition-colors ${border ? 'border-t border-gray-100' : ''}`}>
      <Link to={`/sessions/${session.id}`} className="flex items-center gap-4 flex-1 min-w-0">
        <StatusBadge status={session.status} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-mono text-gray-500 truncate">{session.id.slice(0, 8)}…</p>
          <p className="text-xs text-gray-400">
            {session.started_at ? new Date(session.started_at).toLocaleString() : 'Not started'}
          </p>
        </div>
      </Link>
      <div className="flex items-center gap-4 text-xs text-gray-400 shrink-0">
        {totals.turns != null && <span>{totals.turns} turns</span>}
        {totals.tool_calls != null && <span>{totals.tool_calls} calls</span>}
        {totals.cost_usd != null && totals.cost_usd > 0 && <span>${totals.cost_usd.toFixed(4)}</span>}
        {planInfo && (
          <Link
            to={`/plans/${planInfo.planId}/stats?versionId=${session.plan_version_id}`}
            onClick={e => e.stopPropagation()}
            className="text-xs text-indigo-500 hover:text-indigo-700 hover:underline whitespace-nowrap"
            title="View plan version"
          >
            {planInfo.planName} <span className="text-indigo-400">v{planInfo.versionNumber}</span>
          </Link>
        )}
      </div>
      <Link to={`/sessions/${session.id}`}>
        <ChevronRight className="w-4 h-4 text-gray-300 shrink-0" />
      </Link>
    </div>
  )
}
