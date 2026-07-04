import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { AlertTriangle, Trash2, Check, RefreshCw } from 'lucide-react'
import { api } from '../api/client'

export default function FactoryReset() {
  const [confirmed, setConfirmed] = useState(false)
  const [showComplete, setShowComplete] = useState(false)
  const navigate = useNavigate()
  const qc = useQueryClient()

  const reset = useMutation({
    mutationFn: api.factoryReset,
    onSuccess: () => {
      qc.clear()
      setShowComplete(true)
    },
  })

  return (
    <div className="p-6 max-w-2xl">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-red-700">Factory Reset</h1>
        <p className="text-sm text-gray-500 mt-0.5">Remove all user-created data and start fresh.</p>
      </div>

      <div className="bg-white border border-red-200 rounded-xl p-5">
        <div className="flex items-start gap-3 mb-4">
          <div className="p-2 bg-red-100 rounded-full shrink-0">
            <AlertTriangle className="w-5 h-5 text-red-600" />
          </div>
          <div>
            <h2 className="font-semibold text-gray-900 mb-1">What this does</h2>
            <ul className="text-sm text-gray-600 space-y-1 list-disc list-inside">
              <li>Deletes all <strong>plans</strong>, sessions, and batch runs</li>
              <li>Deletes all <strong>model configs</strong></li>
              <li>Deletes all <strong>tools</strong></li>
            </ul>
          </div>
        </div>

        <p className="text-sm text-red-600 font-medium mb-4">
          This action cannot be undone. Consider exporting your data first.
        </p>

        <label className="flex items-center gap-2 mb-4 text-sm text-gray-700">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={e => setConfirmed(e.target.checked)}
            className="rounded border-gray-300 text-red-600"
          />
          I understand this will permanently delete all user-created data.
        </label>

        <button
          onClick={() => reset.mutate()}
          disabled={!confirmed || reset.isPending}
          className="flex items-center gap-1.5 px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50 transition-colors"
        >
          {reset.isPending ? (
            <>
              <RefreshCw className="w-4 h-4 animate-spin" /> Resetting…
            </>
          ) : (
            <>
              <Trash2 className="w-4 h-4" /> Factory Reset
            </>
          )}
        </button>

        {reset.isError && (
          <div className="mt-4 flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg px-4 py-3">
            <AlertTriangle className="w-4 h-4" />
            Reset failed: {(reset.error as Error).message}
          </div>
        )}
      </div>

      {/* Progress overlay */}
      {reset.isPending && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-xl p-8 flex flex-col items-center gap-4">
            <RefreshCw className="w-8 h-8 text-indigo-600 animate-spin" />
            <p className="text-sm font-medium text-gray-700">Resetting…</p>
          </div>
        </div>
      )}

      {/* Complete modal */}
      {showComplete && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <div className="flex flex-col items-center gap-3 mb-5">
              <div className="p-3 bg-green-100 rounded-full">
                <Check className="w-8 h-8 text-green-600" />
              </div>
              <h2 className="text-xl font-semibold text-gray-900">Success</h2>
              <p className="text-sm text-gray-500 text-center">Factory reset complete.</p>
            </div>
            <div className="flex justify-center">
              <button
                onClick={() => navigate('/', { replace: true })}
                className="px-6 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors"
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
