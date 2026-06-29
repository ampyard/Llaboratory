import { fireEvent, render, screen } from '@testing-library/react'
import ToolCallSankey from '../components/charts/ToolCallSankey'

describe('ToolCallSankey', () => {
  it('renders tool names as node labels and flow links', () => {
    render(
      <ToolCallSankey
        sessions={[
          {
            tool_sequence: ['search_web', 'summarize_results'],
            tool_calls: { search_web: 1, summarize_results: 1 },
          },
        ]}
      />,
    )

    expect(screen.getByText('search_web')).toBeInTheDocument()
    expect(screen.getByText('summarize_results')).toBeInTheDocument()
    expect(document.querySelectorAll('path[data-link="true"]').length).toBeGreaterThan(0)
  })

  it('shows transition details on link hover', () => {
    const { container } = render(
      <ToolCallSankey
        sessions={[
          {
            tool_sequence: ['search_web', 'summarize_results'],
            tool_calls: { search_web: 1, summarize_results: 1 },
          },
        ]}
      />,
    )

    const link = container.querySelector('path[data-link="true"]')
    expect(link).not.toBeNull()

    fireEvent.mouseEnter(link!)

    expect(screen.getByText('search_web → summarize_results')).toBeInTheDocument()
    expect(screen.getByText('1 transition')).toBeInTheDocument()
  })
})
