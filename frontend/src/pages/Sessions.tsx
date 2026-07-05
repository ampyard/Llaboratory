import { useState, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { ChevronRight, Trash2, X, FileText } from 'lucide-react'
import { api } from '../api/client'
import StatusBadge from '../components/StatusBadge'
import type { Session } from '../types'

export default function Sessions() {
  const queryClient = useQueryClient()
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

  const [deleting, setDeleting] = useState<string | null>(null)

  return (
    <div className="p-6 max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold">Sessions</h1>
          <p className="text-sm text-gray-500 mt-0.5">All test session runs</p>
        </div>
        <Link
          to="/sessions/audit-logs"
          className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 text-gray-600 rounded-lg text-xs font-medium hover:bg-gray-50 transition-colors"
        >
          <FileText className="w-3.5 h-3.5" /> Audit Log
        </Link>
      </div>

      {isLoading && <p className="text-sm text-gray-400">Loading…</p>}

      {!isLoading && sessions.length === 0 && (
        <div className="border-2 border-dashed border-gray-200 rounded-xl p-12 text-center">
          <p className="text-gray-400 text-sm">No sessions yet. Run a plan to start a session.</p>
        </div>
      )}

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        {sessions.map((session, i) => (
          <SessionRow
            key={session.id}
            session={session}
            border={i > 0}
            planInfo={versionMap[session.plan_version_id]}
            onDelete={() => setDeleting(session.id)}
          />
        ))}
      </div>

      {deleting && (
        <DeleteDialog
          sessionId={deleting}
          onClose={() => setDeleting(null)}
          onDeleted={() => {
            setDeleting(null)
            queryClient.invalidateQueries({ queryKey: ['sessions'] })
          }}
        />
      )}
    </div>
  )
}

function DeleteDialog({ sessionId, onClose, onDeleted }: { sessionId: string; onClose: () => void; onDeleted: () => void }) {
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleDelete() {
    setSaving(true)
    try {
      await api.sessions.delete(sessionId, reason)
      onDeleted()
    } catch {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl p-6 max-w-md w-full mx-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-gray-800">Delete Session</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-4 h-4" />
          </button>
        </div>
        <p className="text-sm text-gray-500 mb-4">
          A snapshot of this session and its events will be preserved in the audit log.
          This action cannot be undone.
        </p>
        <label className="block text-xs font-medium text-gray-600 mb-1.5">
          Reason for deletion <span className="text-gray-400">(optional)</span>
        </label>
        <textarea
          value={reason}
          onChange={e => setReason(e.target.value)}
          placeholder="e.g., session was affected by a provider outage"
          rows={3}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
        <div className="flex items-center justify-end gap-2 mt-4">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800"
          >
            Cancel
          </button>
          <button
            onClick={handleDelete}
            disabled={saving}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50"
          >
            {saving ? 'Deleting…' : 'Delete Session'}
          </button>
        </div>
      </div>
    </div>
  )
}

function SessionRow({
  session,
  border,
  planInfo,
  onDelete,
}: {
  session: Session
  border: boolean
  planInfo?: { planName: string; versionNumber: number; planId: string }
  onDelete: () => void
}) {
  const totals = session.totals
  const canDelete = session.status !== 'running'
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
        {session.batch_id && planInfo && (
          <Link
            to={`/plans/${planInfo.planId}/runs/${session.batch_id}`}
            onClick={e => e.stopPropagation()}
            className="text-xs text-gray-400 hover:text-indigo-600 hover:underline whitespace-nowrap"
            title="View the batch run this trial belongs to"
          >
            trial #{session.batch_index + 1}
          </Link>
        )}
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
      <div className="flex items-center gap-1">
        <button
          onClick={e => { e.stopPropagation(); onDelete() }}
          disabled={!canDelete}
          className="p-1.5 text-gray-300 hover:text-red-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          title={canDelete ? 'Delete session' : 'Cannot delete a running session'}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
        <Link to={`/sessions/${session.id}`}>
          <ChevronRight className="w-4 h-4 text-gray-300 shrink-0" />
        </Link>
      </div>
    </div>
  )
}
