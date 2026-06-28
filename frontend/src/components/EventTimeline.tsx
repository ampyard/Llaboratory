import type { Event } from '../types'

const EVENT_COLORS: Record<string, string> = {
  session_start: 'text-gray-500',
  model_request: 'text-blue-600',
  model_response: 'text-indigo-600',
  tool_call: 'text-amber-600',
  tool_result: 'text-green-600',
  tool_error: 'text-red-600',
  hallucinated_tool_call: 'text-orange-600',
  loop_guard_triggered: 'text-red-500',
  abort: 'text-red-700',
  session_end: 'text-gray-500',
}

function EventCard({ event }: { event: Event }) {
  const color = EVENT_COLORS[event.type] ?? 'text-gray-600'
  return (
    <div className="flex gap-3 py-3 border-b border-gray-100 last:border-0">
      <div className="w-6 h-6 rounded-full bg-gray-100 flex items-center justify-center shrink-0 mt-0.5">
        <span className="text-xs text-gray-500 font-mono">{event.sequence_no}</span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className={`text-xs font-semibold font-mono ${color}`}>{event.type}</span>
          {event.latency_ms != null && (
            <span className="text-xs text-gray-400">{event.latency_ms}ms</span>
          )}
          {event.token_usage && (
            <span className="text-xs text-gray-400">
              ↑{event.token_usage.input_tokens ?? 0} ↓{event.token_usage.output_tokens ?? 0} tok
            </span>
          )}
          <span className="text-xs text-gray-300 ml-auto shrink-0">
            {new Date(event.timestamp).toLocaleTimeString()}
          </span>
        </div>
        <EventPayload event={event} />
      </div>
    </div>
  )
}

function EventPayload({ event }: { event: Event }) {
  const p = event.payload

  if (event.type === 'model_response') {
    const parts = (p.content_parts as Array<Record<string, unknown>>) ?? []
    const rawResponse = p.raw_response as unknown[] | undefined
    return (
      <div className="space-y-1">
        {parts.map((part, i) => {
          if (part.type === 'reasoning') {
            return (
              <div key={i} className="bg-purple-50 border border-purple-100 rounded p-2">
                <p className="text-xs font-semibold text-purple-500 mb-1">thinking</p>
                <p className="text-xs text-purple-700 whitespace-pre-wrap">{part.content as string}</p>
              </div>
            )
          }
          if (part.type === 'text') {
            return (
              <p key={i} className="text-sm text-gray-700 whitespace-pre-wrap">
                {part.content as string}
              </p>
            )
          }
          if (part.type === 'tool_call') {
            return (
              <div key={i} className="bg-amber-50 rounded p-2 text-xs font-mono">
                <span className="text-amber-700 font-semibold">{part.name as string}</span>
                <span className="text-gray-500 ml-2">{part.raw_args as string}</span>
              </div>
            )
          }
          return null
        })}
        <p className="text-xs text-gray-400">finish: {p.finish_reason as string}</p>
        {rawResponse && (
          <details className="group mt-1">
            <summary className="cursor-pointer text-xs font-medium text-indigo-500 hover:text-indigo-700 select-none">
              <span className="ml-1 group-open:hidden">▶ Raw response ({rawResponse.length} chunk{rawResponse.length !== 1 ? 's' : ''})</span>
              <span className="ml-1 hidden group-open:inline">▼ Raw response ({rawResponse.length} chunk{rawResponse.length !== 1 ? 's' : ''})</span>
            </summary>
            <pre className="mt-1 text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded p-2 overflow-auto max-h-64 whitespace-pre-wrap">
              {JSON.stringify(rawResponse, null, 2)}
            </pre>
          </details>
        )}
      </div>
    )
  }

  if (event.type === 'tool_call') {
    return (
      <div className="bg-amber-50 rounded p-2 text-xs font-mono">
        <span className="text-amber-700 font-semibold">{p.name as string}</span>
        <pre className="mt-1 text-gray-600 overflow-auto max-h-32 whitespace-pre-wrap">
          {JSON.stringify(p.parsed_args, null, 2)}
        </pre>
      </div>
    )
  }

  if (event.type === 'tool_result') {
    return (
      <div className="bg-green-50 rounded p-2 text-xs font-mono">
        <span className="text-green-700 font-semibold">{p.name as string}</span>
        <pre className="mt-1 text-gray-600 overflow-auto max-h-32 whitespace-pre-wrap">
          {JSON.stringify(p.result, null, 2)}
        </pre>
      </div>
    )
  }

  if (event.type === 'tool_error' || event.type === 'hallucinated_tool_call') {
    return (
      <div className="bg-red-50 rounded p-2 text-xs">
        <span className="text-red-600">{JSON.stringify(p)}</span>
      </div>
    )
  }

  if (event.type === 'model_request') {
    const msgs = (p.messages as unknown[]) ?? []
    const rawPayload = p.raw_payload as Record<string, unknown> | undefined
    return (
      <div className="space-y-2">
        <p className="text-xs text-gray-500">{msgs.length} message(s) · {(p.tools as unknown[])?.length ?? 0} tool(s)</p>
        {rawPayload && (
          <details className="group">
            <summary className="cursor-pointer text-xs font-medium text-blue-500 hover:text-blue-700 select-none">
              <span className="ml-1 group-open:hidden">▶ Raw request payload</span>
              <span className="ml-1 hidden group-open:inline">▼ Raw request payload</span>
            </summary>
            <pre className="mt-1 text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded p-2 overflow-auto max-h-64 whitespace-pre-wrap">
              {JSON.stringify(rawPayload, null, 2)}
            </pre>
          </details>
        )}
      </div>
    )
  }

  return (
    <pre className="text-xs text-gray-500 overflow-auto max-h-24 whitespace-pre-wrap">
      {JSON.stringify(p, null, 2)}
    </pre>
  )
}

interface StreamBuffer {
  reasoning: string
  text: string
}

function LiveStreamCard({ buffer }: { buffer: StreamBuffer }) {
  const hasContent = buffer.reasoning || buffer.text
  return (
    <div className="flex gap-3 py-3">
      <div className="w-6 h-6 rounded-full bg-indigo-50 border border-indigo-200 flex items-center justify-center shrink-0 mt-0.5">
        <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-pulse" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs font-semibold font-mono text-indigo-400">model_response</span>
          <span className="text-xs text-indigo-300 animate-pulse">streaming…</span>
        </div>
        {hasContent ? (
          <div className="space-y-1">
            {buffer.reasoning && (
              <div className="bg-purple-50 border border-purple-100 rounded p-2">
                <p className="text-xs font-semibold text-purple-500 mb-1">thinking</p>
                <p className="text-xs text-purple-700 whitespace-pre-wrap">{buffer.reasoning}</p>
              </div>
            )}
            {buffer.text && (
              <p className="text-sm text-gray-700 whitespace-pre-wrap">{buffer.text}</p>
            )}
          </div>
        ) : (
          <p className="text-xs text-gray-400 italic">Waiting for model…</p>
        )}
      </div>
    </div>
  )
}

export default function EventTimeline({
  events,
  streamBuffer,
}: {
  events: Event[]
  streamBuffer?: { reasoning: string; text: string } | null
}) {
  if (events.length === 0 && !streamBuffer) {
    return <p className="text-sm text-gray-400 py-4 text-center">No events yet.</p>
  }
  return (
    <div className="divide-y divide-gray-100">
      {events.map(ev => (
        <EventCard key={ev.id} event={ev} />
      ))}
      {streamBuffer && <LiveStreamCard buffer={streamBuffer} />}
    </div>
  )
}
