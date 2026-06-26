import { useState, useEffect, useRef } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, StopCircle, Play } from 'lucide-react'
import { api } from '../api/client'
import StatusBadge from '../components/StatusBadge'
import EventTimeline from '../components/EventTimeline'
import type { Event } from '../types'

export default function SessionDetail() {
  const { sessionId } = useParams<{ sessionId: string }>()

  const { data: session, refetch } = useQuery({
    queryKey: ['sessions', sessionId],
    queryFn: () => api.sessions.get(sessionId!),
    refetchInterval: (query) => query.state.data?.status === 'running' ? 2000 : false,
  })

  const { data: plan } = useQuery({
    queryKey: ['plans', session?.plan_version.plan_id],
    queryFn: () => api.plans.get(session!.plan_version.plan_id),
    enabled: !!session?.plan_version.plan_id,
  })

  const [liveEvents, setLiveEvents] = useState<Event[]>([])
  const [streaming, setStreaming] = useState(false)
  const [streamBuffer, setStreamBuffer] = useState<{ reasoning: string; text: string } | null>(null)
  const esRef = useRef<EventSource | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!sessionId || !session) return
    if (session.status !== 'running') return

    const es = new EventSource(`/api/sessions/${sessionId}/stream`)
    esRef.current = es
    setStreaming(true)

    es.addEventListener('message', (e) => {
      const data = JSON.parse(e.data)

      if (data.type === 'stream_delta') {
        const { kind, data: payload } = data
        if (kind === 'reasoning_delta') {
          setStreamBuffer(prev => ({
            reasoning: (prev?.reasoning ?? '') + (payload as string),
            text: prev?.text ?? '',
          }))
        } else if (kind === 'text_delta') {
          setStreamBuffer(prev => ({
            reasoning: prev?.reasoning ?? '',
            text: (prev?.text ?? '') + (payload as string),
          }))
        }
        return
      }

      // When a full model_response arrives, clear the live buffer (the real event replaces it)
      if (data.type === 'model_response') {
        setStreamBuffer(null)
      }

      setLiveEvents(prev => [...prev, {
        id: `live-${data.sequence_no}`,
        session_id: sessionId!,
        sequence_no: data.sequence_no,
        timestamp: new Date().toISOString(),
        type: data.type,
        payload: data.payload ?? {},
        latency_ms: data.latency_ms ?? null,
        token_usage: data.token_usage ?? null,
        tool_call_id: data.tool_call_id ?? null,
      }])
    })

    es.addEventListener('done', () => {
      setStreaming(false)
      setStreamBuffer(null)
      es.close()
      refetch()
    })

    es.onerror = () => {
      setStreaming(false)
      es.close()
    }

    return () => { es.close() }
  }, [session?.status, sessionId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [liveEvents])

  const [starting, setStarting] = useState(false)

  async function handleRun() {
    if (!sessionId) return
    setStarting(true)
    try {
      await api.sessions.run(sessionId)
      refetch()
    } finally {
      setStarting(false)
    }
  }

  async function handleAbort() {
    if (!sessionId) return
    await api.sessions.abort(sessionId)
    refetch()
  }

  const isRunning = session?.status === 'running'
  const isPending = session?.status === 'pending'
  const events = session?.events ?? []
  const displayEvents = events.length > 0 ? events : liveEvents
  const totals = session?.totals ?? {}

  return (
    <div className="p-6 max-w-4xl">
      <div className="flex items-center gap-3 mb-5">
        <Link to="/sessions" className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
          <ArrowLeft className="w-4 h-4" /> Sessions
        </Link>
        <span className="text-gray-300">/</span>
        <span className="text-sm font-mono text-gray-400">{sessionId?.slice(0, 8)}…</span>
      </div>

      <div className="flex items-start gap-4 mb-6">
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-2">
            {session && <StatusBadge status={session.status} />}
            {streaming && (
              <span className="flex items-center gap-1.5 text-xs text-blue-600">
                <span className="w-1.5 h-1.5 bg-blue-600 rounded-full animate-pulse" />
                streaming
              </span>
            )}
          </div>
          {session?.plan_version && (
            <div className="space-y-0.5">
              <p className="text-sm text-gray-500">
                Plan:{' '}
                <Link
                  to={`/plans/${session.plan_version.plan_id}/stats?versionId=${session.plan_version.id}`}
                  className="text-indigo-500 hover:text-indigo-700 hover:underline"
                >
                  {plan?.name ?? '…'} <span className="text-indigo-400">(v{session.plan_version.version_number})</span>
                </Link>
              </p>
              <p className="text-sm text-gray-500">
                Model: <span className="font-mono">{session.plan_version.model_config_snapshot.model_snapshot}</span>
                {' · '}
                {session.plan_version.tool_versions.length} tool(s)
              </p>
              {session.termination_reason && (
                <p className="text-sm text-gray-500">
                  Termination Reason: <span className="text-gray-400">{session.termination_reason}</span>
                </p>
              )}
            </div>
          )}
        </div>

        <div className="flex gap-2 shrink-0">
          {isPending && (
            <button
              onClick={handleRun}
              disabled={starting}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-medium hover:bg-green-700 disabled:opacity-50"
            >
              <Play className="w-3.5 h-3.5" /> {starting ? 'Starting…' : 'Start Session'}
            </button>
          )}
          {isRunning && (
            <button
              onClick={handleAbort}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-red-600 text-white rounded-lg text-xs font-medium hover:bg-red-700"
            >
              <StopCircle className="w-3.5 h-3.5" /> Abort
            </button>
          )}
        </div>
      </div>

      {/* Totals */}
      {Object.keys(totals).length > 0 && (
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 mb-6">
          {[
            ['Turns', totals.turns],
            ['Tool calls', totals.tool_calls],
            ['In tokens', totals.input_tokens],
            ['Out tokens', totals.output_tokens],
            ['Cost', totals.cost_usd != null ? `$${(totals.cost_usd as number).toFixed(5)}` : '—'],
            ['Duration', totals.wall_clock_ms != null ? `${((totals.wall_clock_ms as number) / 1000).toFixed(1)}s` : '—'],
          ].map(([label, value]) => (
            <div key={label as string} className="bg-white border border-gray-200 rounded-xl p-3 text-center">
              <p className="text-xs text-gray-400 mb-1">{label}</p>
              <p className="text-lg font-semibold text-gray-900">{value ?? '—'}</p>
            </div>
          ))}
        </div>
      )}

      {/* Prompts */}
      {session?.plan_version && (
        <div className="bg-white border border-gray-200 rounded-xl p-4 mb-4 space-y-3">
          {session.plan_version.system_prompt && (
            <div>
              <p className="text-xs font-medium text-gray-500 mb-1">System prompt</p>
              <p className="text-sm text-gray-700 whitespace-pre-wrap">{session.plan_version.system_prompt}</p>
            </div>
          )}
          <div>
            <p className="text-xs font-medium text-gray-500 mb-1">User prompt</p>
            <p className="text-sm text-gray-700 whitespace-pre-wrap">{session.plan_version.user_prompt}</p>
          </div>
        </div>
      )}

      {/* Events */}
      <div className="bg-white border border-gray-200 rounded-xl p-4">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">
          Event Timeline
          <span className="ml-2 text-xs font-normal text-gray-400">({displayEvents.length} events)</span>
        </h2>
        <EventTimeline events={displayEvents} streamBuffer={streamBuffer} />
        <div ref={bottomRef} />
      </div>

    </div>
  )
}
