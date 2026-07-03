import { useState, useRef, useEffect } from 'react'
import { Play, ChevronDown } from 'lucide-react'
import RunBatchDialog from './RunBatchDialog'

export default function RunSplitButton({
  onRunOnce,
  onRunBatch,
  defaultRepetitions,
  disabled,
}: {
  onRunOnce: () => void | Promise<void>
  onRunBatch: (name: string, repetitions: number) => void | Promise<void>
  defaultRepetitions: number
  disabled?: boolean
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [runningOnce, setRunningOnce] = useState(false)
  const [submittingBatch, setSubmittingBatch] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [menuOpen])

  async function handleRunOnce() {
    setRunningOnce(true)
    try {
      await onRunOnce()
    } finally {
      setRunningOnce(false)
    }
  }

  async function handleConfirmBatch(name: string, repetitions: number) {
    setSubmittingBatch(true)
    try {
      await onRunBatch(name, repetitions)
      setDialogOpen(false)
    } finally {
      setSubmittingBatch(false)
    }
  }

  return (
    <div className="relative inline-flex" ref={ref}>
      <button
        onClick={handleRunOnce}
        disabled={disabled || runningOnce}
        className="flex items-center gap-1.5 pl-3 pr-2.5 py-1.5 bg-green-600 text-white rounded-l-lg text-xs font-medium hover:bg-green-700 disabled:opacity-50 transition-colors"
      >
        <Play className="w-3.5 h-3.5" /> {runningOnce ? 'Starting…' : 'Run Once'}
      </button>
      <button
        onClick={() => setMenuOpen(o => !o)}
        disabled={disabled}
        title="More run options"
        className="flex items-center px-1.5 py-1.5 bg-green-600 text-white rounded-r-lg border-l border-green-700 hover:bg-green-700 disabled:opacity-50 transition-colors"
      >
        <ChevronDown className="w-3.5 h-3.5" />
      </button>

      {menuOpen && (
        <div className="absolute right-0 top-full mt-1 w-40 bg-white border border-gray-200 rounded-lg shadow-lg z-20 py-1">
          <button
            onClick={() => { setMenuOpen(false); setDialogOpen(true) }}
            className="w-full text-left px-3 py-2 text-xs text-gray-700 hover:bg-gray-50"
          >
            Run in batch…
          </button>
        </div>
      )}

      {dialogOpen && (
        <RunBatchDialog
          defaultRepetitions={defaultRepetitions}
          isPending={submittingBatch}
          onConfirm={handleConfirmBatch}
          onClose={() => setDialogOpen(false)}
        />
      )}
    </div>
  )
}
