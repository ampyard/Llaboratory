import CodeMirror from '@uiw/react-codemirror'
import { python } from '@codemirror/lang-python'
import { oneDark } from '@codemirror/theme-one-dark'

interface PythonCodeEditorProps {
  value: string
  onChange: (value: string) => void
  minHeight?: string
  'data-testid'?: string
}

export default function PythonCodeEditor({
  value,
  onChange,
  minHeight = '160px',
  'data-testid': dataTestId,
}: PythonCodeEditorProps) {
  return (
    <div
      data-testid={dataTestId}
      className="rounded-md overflow-hidden border border-gray-200"
      style={{ minHeight }}
    >
      <CodeMirror
        value={value}
        onChange={onChange}
        extensions={[python()]}
        theme={oneDark}
        minHeight={minHeight}
        maxHeight="600px"
        basicSetup={{
          lineNumbers: true,
          foldGutter: true,
          highlightActiveLine: true,
          highlightSelectionMatches: true,
          autocompletion: true,
          indentOnInput: true,
          bracketMatching: true,
          closeBrackets: true,
          tabSize: 4,
        }}
      />
    </div>
  )
}
