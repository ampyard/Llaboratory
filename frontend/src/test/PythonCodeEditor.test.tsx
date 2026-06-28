import { render, screen, fireEvent } from '@testing-library/react'
import { vi } from 'vitest'
import PythonCodeEditor from '../components/PythonCodeEditor'

// Mock @uiw/react-codemirror — CodeMirror uses browser APIs jsdom doesn't provide
vi.mock('@uiw/react-codemirror', () => ({
  __esModule: true,
  default: (props: {
    value: string
    onChange: (val: string) => void
    'data-testid'?: string
  }) => {
    const dataTestId = props['data-testid']
    return (
      <div data-testid={dataTestId}>
        <textarea
          data-testid={dataTestId ? `${dataTestId}-textarea` : undefined}
          value={props.value}
          onChange={e => props.onChange(e.target.value)}
        />
      </div>
    )
  },
}))

describe('PythonCodeEditor', () => {
  it('renders without crashing', () => {
    render(<PythonCodeEditor value="" onChange={vi.fn()} data-testid="editor" />)
    expect(screen.getByTestId('editor')).toBeInTheDocument()
  })

  it('displays the initial value', () => {
    const code = 'def respond(args, context):\n    return {"result": "ok"}'
    render(<PythonCodeEditor value={code} onChange={vi.fn()} data-testid="editor" />)
    const textarea = screen.getByTestId('editor').querySelector('textarea')
    expect(textarea).toHaveValue(code)
  })

  it('calls onChange when user types', () => {
    const onChange = vi.fn()
    render(<PythonCodeEditor value="" onChange={onChange} data-testid="editor" />)
    const textarea = screen.getByTestId('editor').querySelector('textarea')!
    fireEvent.change(textarea, { target: { value: 'print("hello")' } })
    expect(onChange).toHaveBeenCalledWith('print("hello")')
  })

  it('renders with custom data-testid', () => {
    render(
      <PythonCodeEditor
        value=""
        onChange={vi.fn()}
        data-testid="my-custom-editor"
      />
    )
    expect(screen.getByTestId('my-custom-editor')).toBeInTheDocument()
  })

  it('renders multiline Python code correctly', () => {
    const code = [
      'def respond(args, context):',
      '    query = args.get("query", "")',
      '    # fetch results',
      '    return {"results": []}',
    ].join('\n')
    render(<PythonCodeEditor value={code} onChange={vi.fn()} data-testid="editor" />)
    const textarea = screen.getByTestId('editor').querySelector('textarea')
    expect(textarea).toHaveValue(code)
  })

  it('has rounded container styling', () => {
    render(<PythonCodeEditor value="" onChange={vi.fn()} data-testid="editor" />)
    expect(screen.getByTestId('editor')).toHaveClass('rounded-md')
  })
})
