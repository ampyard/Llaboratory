import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { ArrowLeft, FileText, Trash2 } from 'lucide-react'
import { api } from '../api/client'
import type { AuditLog } from '../types'

export default function AuditLogs() {
  const [expanded, setExpanded] = useState<string | null>(null)

  const { data: logs = [], isLoading } = useQuery({
    queryKey: ['audit-logs'],
    queryFn: () => api.sessions.auditLogs(),
  })

  return (
    <div className="p-6 max-w-4xl">
      <div className="flex items-center gap-3 mb-6">
        <Link to="/sessions" className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
          <ArrowLeft className="w-4 h-4" /> Sessions
        </Link>
        <span className="text-gray-300">/</span>
        <span className="text-sm font-semibold text-indigo-600">Audit Log</span>
      </div>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold">Audit Log</h1>
          <p className="text-sm text-gray-500 mt-0.5">Record of all deleted sessions with snapshots and reasons</p>
        </div>
      </div>

      {isLoading && <p className="text-sm text-gray-400">Loading…</p>}

      {!isLoading && logs.length === 0 && (
        <div className="border-2 border-dashed border-gray-200 rounded-xl p-12 text-center">
          <Trash2 className="w-10 h-10 text-gray-200 mx-auto mb-3" />
          <p className="text-gray-500 text-sm font-medium">No audit records yet</p>
          <p className="text-gray-400 text-xs mt-1">Deleted sessions will appear here with their event snapshots.</p>
        </div>
      )}

      <div className="space-y-3">
        {logs.map(log => (
          <AuditLogCard key={log.id} log={log} expanded={expanded === log.id} onToggle={() => setExpanded(expanded === log.id ? null : log.id)} />
        ))}
      </div>
    </div>
  )
}

function AuditLogCard({ log, expanded, onToggle }: { log: AuditLog; expanded: boolean; onToggle: () => void }) {
  const sessionId = (log.snapshot?.session as Record<string, unknown>)?.id as string | undefined
  const events = (log.snapshot?.events as Record<string, unknown>[]) ?? []
  const session = log.snapshot?.session as Record<string, unknown> | undefined

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <button onClick={onToggle} className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 text-left">
        <div className="w-8 h-8 rounded-lg bg-red-50 flex items-center justify-center shrink-0">
          <Trash2 className="w-4 h-4 text-red-400" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-700">
            Session <span className="font-mono">{sessionId?.slice(0, 8) ?? log.entity_id.slice(0, 8)}…</span>
          </p>
          {log.reason && (
            <p className="text-xs text-gray-400 truncate mt-0.5">{log.reason}</p>
          )}
        </div>
        <div className="text-right shrink-0">
          <p className="text-xs text-gray-400">{new Date(log.created_at).toLocaleString()}</p>
          <p className="text-xs text-gray-400 mt-0.5">{events.length} events</p>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-gray-100 px-4 py-3 space-y-3">
          {log.reason && (
            <div>
              <p className="text-xs font-medium text-gray-500 mb-0.5">Reason</p>
              <p className="text-sm text-gray-700">{log.reason}</p>
            </div>
          )}

          {session && (
            <div>
              <p className="text-xs font-medium text-gray-500 mb-1">Session Snapshot</p>
              <pre className="text-xs text-gray-600 bg-gray-50 rounded-lg p-3 overflow-x-auto max-h-60">
                {JSON.stringify(session, null, 2)}
              </pre>
            </div>
          )}

          {events.length > 0 && (
            <div>
              <div className="flex items-center gap-1.5 mb-1">
                <FileText className="w-3.5 h-3.5 text-gray-400" />
                <p className="text-xs font-medium text-gray-500">Events ({events.length})</p>
              </div>
              <pre className="text-xs text-gray-600 bg-gray-50 rounded-lg p-3 overflow-x-auto max-h-80">
                {JSON.stringify(events, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
