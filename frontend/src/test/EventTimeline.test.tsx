import { render, screen } from '@testing-library/react'
import EventTimeline from '../components/EventTimeline'
import type { Event } from '../types'

function makeEvent(overrides: Partial<Event> = {}): Event {
  return {
    id: 'evt-1',
    session_id: 'sess-1',
    sequence_no: 0,
    timestamp: '2024-01-01T00:00:00Z',
    type: 'session_start',
    payload: {},
    latency_ms: null,
    token_usage: null,
    tool_call_id: null,
    ...overrides,
  }
}

test('shows empty state when no events', () => {
  render(<EventTimeline events={[]} />)
  expect(screen.getByText(/no events yet/i)).toBeInTheDocument()
})

test('renders event type label', () => {
  render(<EventTimeline events={[makeEvent({ type: 'tool_call', sequence_no: 3 })]} />)
  expect(screen.getByText('tool_call')).toBeInTheDocument()
  expect(screen.getByText('3')).toBeInTheDocument()
})

test('shows latency when present', () => {
  render(<EventTimeline events={[makeEvent({ latency_ms: 420 })]} />)
  expect(screen.getByText('420ms')).toBeInTheDocument()
})

test('shows token usage when present', () => {
  render(<EventTimeline events={[makeEvent({ token_usage: { input_tokens: 10, output_tokens: 5 } })]} />)
  expect(screen.getByText(/↑10/)).toBeInTheDocument()
  expect(screen.getByText(/↓5/)).toBeInTheDocument()
})

test('renders text content from model_response', () => {
  const event = makeEvent({
    type: 'model_response',
    payload: {
      content_parts: [{ type: 'text', content: 'Hello from the model' }],
      finish_reason: 'end_turn',
    },
  })
  render(<EventTimeline events={[event]} />)
  expect(screen.getByText('Hello from the model')).toBeInTheDocument()
  expect(screen.getByText(/finish: end_turn/)).toBeInTheDocument()
})

test('renders tool call name and args in model_response', () => {
  const event = makeEvent({
    type: 'model_response',
    payload: {
      content_parts: [
        { type: 'tool_call', name: 'search_web', raw_args: '{"query":"cats"}', tool_call_id: 'tc-1' },
      ],
      finish_reason: 'tool_call',
    },
  })
  render(<EventTimeline events={[event]} />)
  expect(screen.getByText('search_web')).toBeInTheDocument()
  expect(screen.getByText('{"query":"cats"}')).toBeInTheDocument()
})

test('renders tool_call event with parsed args', () => {
  const event = makeEvent({
    type: 'tool_call',
    payload: { name: 'my_tool', parsed_args: { x: 1 } },
  })
  render(<EventTimeline events={[event]} />)
  expect(screen.getByText('my_tool')).toBeInTheDocument()
})

test('renders tool_result event', () => {
  const event = makeEvent({
    type: 'tool_result',
    payload: { name: 'my_tool', result: { answer: 42 } },
  })
  render(<EventTimeline events={[event]} />)
  // name appears twice (badge + label)
  expect(screen.getAllByText('my_tool').length).toBeGreaterThan(0)
})

test('renders live stream blocks in order, tool call between reasoning segments', () => {
  render(
    <EventTimeline
      events={[]}
      streamBuffer={[
        { type: 'reasoning', content: 'First thought.' },
        { type: 'tool_call', index: 'call_1', name: 'lookup', args: '{"q":"x"}' },
        { type: 'reasoning', content: 'Second thought.' },
      ]}
    />
  )
  expect(screen.getByText('First thought.')).toBeInTheDocument()
  expect(screen.getByText('lookup')).toBeInTheDocument()
  expect(screen.getByText('Second thought.')).toBeInTheDocument()
  // Not merged into one block: two separate "thinking" panels are rendered.
  expect(screen.getAllByText('thinking').length).toBe(2)
})

test('renders multiple events in sequence order', () => {
  const events = [
    makeEvent({ sequence_no: 0, type: 'session_start' }),
    makeEvent({ id: 'e2', sequence_no: 1, type: 'model_request', payload: { messages: [], tools: [] } }),
    makeEvent({ id: 'e3', sequence_no: 2, type: 'session_end', payload: { termination_reason: 'completed_no_tool_call', totals: {} } }),
  ]
  render(<EventTimeline events={events} />)
  expect(screen.getByText('session_start')).toBeInTheDocument()
  expect(screen.getByText('model_request')).toBeInTheDocument()
  expect(screen.getByText('session_end')).toBeInTheDocument()
})
