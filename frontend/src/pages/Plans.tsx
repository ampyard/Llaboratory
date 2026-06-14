import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Plus, Play, Trash2, ChevronRight, BarChart2 } from 'lucide-react'
import { api } from '../api/client'
import type { Plan } from '../types'

export default function Plans() {
  const qc = useQueryClient()
  const { data: plans = [], isLoading } = useQuery({ queryKey: ['plans'], queryFn: api.plans.list })
  const del = useMutation({ mutationFn: api.plans.delete, onSuccess: () => qc.invalidateQueries({ queryKey: ['plans'] }) })

  return (
    <div className="p-6 max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold">Testing Plans</h1>
          <p className="text-sm text-gray-500 mt-0.5">Tools + model + prompts assembled into reusable experiments</p>
        </div>
        <Link to="/plans/new" className="flex items-center gap-1.5 px-3 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors">
          <Plus className="w-4 h-4" /> New Plan
        </Link>
      </div>

      {isLoading && <p className="text-sm text-gray-400">Loading…</p>}

      {!isLoading && plans.length === 0 && (
        <div className="border-2 border-dashed border-gray-200 rounded-xl p-12 text-center">
          <p className="text-gray-400 text-sm">No plans yet. Build your first testing plan.</p>
          <Link to="/plans/new" className="mt-3 inline-flex items-center gap-1 text-sm text-indigo-600 hover:text-indigo-700">
            <Plus className="w-4 h-4" /> Create plan
          </Link>
        </div>
      )}

      <div className="grid gap-3">
        {plans.map(plan => <PlanCard key={plan.id} plan={plan} onDelete={() => del.mutate(plan.id)} />)}
      </div>
    </div>
  )
}

function PlanCard({ plan, onDelete }: { plan: Plan; onDelete: () => void }) {
  const latest = plan.versions[plan.versions.length - 1]
  const qc = useQueryClient()

  async function runSession() {
    if (!latest) return
    const session = await api.sessions.create(latest.id)
    await api.sessions.run(session.id)
    qc.invalidateQueries({ queryKey: ['sessions'] })
    window.location.href = `/sessions/${session.id}`
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 flex items-start gap-4 hover:border-gray-300 transition-colors">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <Link to={`/plans/${plan.id}`} className="font-medium text-gray-900 hover:text-indigo-600">
            {plan.name}
          </Link>
          <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">v{plan.versions.length}</span>
        </div>
        {plan.description && <p className="text-sm text-gray-500 mb-2">{plan.description}</p>}
        {latest && (
          <div className="flex gap-3 text-xs text-gray-400">
            <span>{latest.tool_versions.length} tool(s)</span>
            <span>·</span>
            <span className="font-mono">{latest.model_config_snapshot.model_snapshot}</span>
            <span>·</span>
            <span>{latest.run_settings.max_turns} turns max</span>
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={runSession}
          disabled={!latest}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-medium hover:bg-green-700 disabled:opacity-50 transition-colors"
        >
          <Play className="w-3.5 h-3.5" /> Run
        </button>
        <Link
          to={`/plans/${plan.id}/stats`}
          className="p-1.5 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded"
        >
          <BarChart2 className="w-4 h-4" />
        </Link>
        <Link to={`/plans/${plan.id}`} className="p-1.5 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded">
          <ChevronRight className="w-4 h-4" />
        </Link>
        <button onClick={() => { if (confirm(`Delete "${plan.name}"?`)) onDelete() }} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded">
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}
