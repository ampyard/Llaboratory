import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2, X, Check, Play } from 'lucide-react'
import { api } from '../api/client'
import type { ModelConfig } from '../types'
import { ToastContainer, useToast } from '../components/Toast'

interface FormState {
  name: string; base_url: string; model_snapshot: string
  api_key_env: string; input_cost_per_1k: string; output_cost_per_1k: string
  temperature: string; max_tokens: string
}

const EMPTY: FormState = {
  name: '', base_url: 'https://openrouter.ai/api/v1', model_snapshot: '',
  api_key_env: '', input_cost_per_1k: '0', output_cost_per_1k: '0',
  temperature: '1', max_tokens: '4096',
}

export default function ModelConfigs() {
  const qc = useQueryClient()
  const { data: configs = [], isLoading } = useQuery({ queryKey: ['model-configs'], queryFn: api.modelConfigs.list })
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<ModelConfig | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY)
  const { toasts, showToast, closeToast } = useToast()

  const save = useMutation({
    mutationFn: async () => {
      const params: Record<string, unknown> = {}
      if (form.temperature) params.temperature = parseFloat(form.temperature)
      if (form.max_tokens) params.max_tokens = parseInt(form.max_tokens)
      const body = {
        name: form.name, base_url: form.base_url,
        model_snapshot: form.model_snapshot, api_key_env: form.api_key_env,
        input_cost_per_1k: parseFloat(form.input_cost_per_1k) || 0,
        output_cost_per_1k: parseFloat(form.output_cost_per_1k) || 0,
        params,
      }
      if (editing) return api.modelConfigs.update(editing.id, body)
      return api.modelConfigs.create(body)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['model-configs'] })
      setShowForm(false); setEditing(null); setForm(EMPTY)
    },
  })

  const del = useMutation({
    mutationFn: api.modelConfigs.delete,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['model-configs'] }),
  })

  const [testingId, setTestingId] = useState<string | null>(null)

  const test = useMutation({
    mutationFn: async (id: string) => {
      setTestingId(id)
      return api.modelConfigs.test(id)
    },
    onSuccess: (data) => {
      setTestingId(null)
      showToast('success', data.message)
    },
    onError: (error: Error) => {
      setTestingId(null)
      showToast('error', error.message)
    },
  })

  function openEdit(mc: ModelConfig) {
    const p = mc.params as Record<string, unknown>
    setForm({
      name: mc.name, base_url: mc.base_url, model_snapshot: mc.model_snapshot,
      api_key_env: mc.api_key_env,
      input_cost_per_1k: String(mc.input_cost_per_1k),
      output_cost_per_1k: String(mc.output_cost_per_1k),
      temperature: String(p.temperature ?? 1),
      max_tokens: String(p.max_tokens ?? 4096),
    })
    setEditing(mc); setShowForm(true)
  }

  return (
    <>
      <ToastContainer toasts={toasts} onClose={closeToast} />
      <div className="p-6 max-w-4xl">
        <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold">Model Configs</h1>
          <p className="text-sm text-gray-500 mt-0.5">Provider endpoints and parameters</p>
        </div>
        <button
          onClick={() => { setForm(EMPTY); setEditing(null); setShowForm(true) }}
          className="flex items-center gap-1.5 px-3 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors"
        >
          <Plus className="w-4 h-4" /> New Config
        </button>
      </div>

      {isLoading && <p className="text-sm text-gray-400">Loading…</p>}

      <div className="grid gap-3">
        {configs.map(mc => (
          <div key={mc.id} className="bg-white border border-gray-200 rounded-xl p-4 flex items-center gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-medium text-gray-900">{mc.name}</span>
                <span className="text-xs font-mono text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">{mc.model_snapshot}</span>
              </div>
              <p className="text-xs text-gray-400 truncate">{mc.base_url}</p>
              <div className="flex gap-3 mt-1 text-xs text-gray-400">
                {mc.api_key_env && <span>Key env: <code className="bg-gray-100 px-1 rounded text-gray-600">{mc.api_key_env}</code></span>}
                {mc.input_cost_per_1k > 0 && <span>In: ${mc.input_cost_per_1k}/1k</span>}
                {mc.output_cost_per_1k > 0 && <span>Out: ${mc.output_cost_per_1k}/1k</span>}
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => test.mutate(mc.id)}
                disabled={testingId === mc.id}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-medium hover:bg-green-700 disabled:opacity-50 transition-colors"
                title="Test configuration"
              >
                <Play className="w-3.5 h-3.5" /> {testingId === mc.id ? 'Testing…' : 'Test'}
              </button>
              <button onClick={() => openEdit(mc)} className="p-1.5 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded" title="Edit">
                <Pencil className="w-4 h-4" />
              </button>
              <button onClick={() => { if (confirm('Delete?')) del.mutate(mc.id) }} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded" title="Delete">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {showForm && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-semibold">{editing ? 'Edit Config' : 'New Model Config'}</h2>
              <button onClick={() => setShowForm(false)}><X className="w-5 h-5 text-gray-400" /></button>
            </div>
            <div className="space-y-3">
              {([
                ['name', 'Config name', 'GPT-4o Mini'],
                ['base_url', 'Base URL', 'https://openrouter.ai/api/v1'],
                ['model_snapshot', 'Model snapshot (exact ID)', 'openai/gpt-4o-mini'],
                ['api_key_env', 'API key env var name', 'OPENROUTER_API_KEY'],
                ['input_cost_per_1k', 'Input cost / 1k tokens ($)', '0.00015'],
                ['output_cost_per_1k', 'Output cost / 1k tokens ($)', '0.0006'],
                ['temperature', 'Temperature', '1'],
                ['max_tokens', 'Max tokens', '4096'],
              ] as [keyof FormState, string, string][]).map(([field, label, placeholder]) => (
                <div key={field}>
                  <label className="text-xs font-medium text-gray-600 block mb-1">{label}</label>
                  <input
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-400"
                    value={form[field]}
                    placeholder={placeholder}
                    onChange={e => setForm(f => ({ ...f, [field]: e.target.value }))}
                  />
                </div>
              ))}
            </div>
            <div className="flex gap-3 mt-5">
              <button
                onClick={() => save.mutate()}
                disabled={save.isPending || !form.name || !form.model_snapshot}
                className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
              >
                <Check className="w-4 h-4" /> {save.isPending ? 'Saving…' : 'Save'}
              </button>
              <button onClick={() => setShowForm(false)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Cancel</button>
            </div>
          </div>
        </div>
      )}
      </div>
    </>
  )
}
