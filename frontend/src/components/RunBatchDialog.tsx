import { useState } from 'react'
import { X, Play } from 'lucide-react'
import Modal from './Modal'

function defaultBatchName() {
  const stamp = new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(new Date())
  return `Batch – ${stamp}`
}

export default function RunBatchDialog({
  defaultRepetitions,
  isPending,
  onConfirm,
  onClose,
}: {
  defaultRepetitions: number
  isPending: boolean
  onConfirm: (name: string, repetitions: number) => void
  onClose: () => void
}) {
  const [name, setName] = useState(defaultBatchName())
  const [repetitions, setRepetitions] = useState(String(Math.max(defaultRepetitions, 1)))

  return (
    <Modal onClose={onClose}>
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-lg font-semibold">Run in Batch</h2>
        <button onClick={onClose}><X className="w-5 h-5 text-gray-400" /></button>
      </div>
      <div className="space-y-3">
        <div>
          <label className="text-xs font-medium text-gray-600 block mb-1">Batch name</label>
          <input
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-400"
            value={name}
            onChange={e => setName(e.target.value)}
            autoFocus
          />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-600 block mb-1">Repetitions</label>
          <input
            type="number"
            min="1"
            max="1000"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-400"
            value={repetitions}
            onChange={e => setRepetitions(e.target.value)}
          />
        </div>
      </div>
      <div className="flex gap-3 mt-5">
        <button
          onClick={() => onConfirm(name.trim(), parseInt(repetitions) || 1)}
          disabled={isPending || !name.trim()}
          className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
        >
          <Play className="w-4 h-4" /> {isPending ? 'Starting…' : 'OK'}
        </button>
        <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Cancel</button>
      </div>
    </Modal>
  )
}
