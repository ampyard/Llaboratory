import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Play, Search } from 'lucide-react'
import { api } from '../api/client'

export default function PlanBuilder() {
  const { planId } = useParams<{ planId?: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const isEdit = !!planId

  const { data: plan } = useQuery({
    queryKey: ['plans', planId],
    queryFn: () => api.plans.get(planId!),
    enabled: isEdit,
  })
  const { data: allTools = [] } = useQuery({ queryKey: ['tools'], queryFn: api.tools.list })
  const { data: modelConfigs = [] } = useQuery({ queryKey: ['model-configs'], queryFn: api.modelConfigs.list })
  const [toolSearch, setToolSearch] = useState('')

  const [planName, setPlanName] = useState('')
  const [planDesc, setPlanDesc] = useState('')
  const [selectedModelConfigId, setSelectedModelConfigId] = useState('')
  const [selectedToolVersionIds, setSelectedToolVersionIds] = useState<string[]>([])
  const [systemPrompt, setSystemPrompt] = useState('You are a helpful assistant.')
  const [userPrompt, setUserPrompt] = useState('')
  const [maxTurns, setMaxTurns] = useState('20')
  const [maxToolCalls, setMaxToolCalls] = useState('50')
  const [timeoutSeconds, setTimeoutSeconds] = useState('300')
  const [saving, setSaving] = useState(false)
  const [running, setRunning] = useState(false)

  const selectedModelConfig = modelConfigs.find(mc => mc.id === selectedModelConfigId)
  const selectedModelMissing = !!selectedModelConfigId && !selectedModelConfig

  useEffect(() => {
    if (plan) {
      setPlanName(plan.name)
      setPlanDesc(plan.description)
      const latest = plan.versions[plan.versions.length - 1]
      if (latest) {
        setSelectedModelConfigId(latest.model_config_snapshot.id ?? '')
        setSelectedToolVersionIds(latest.tool_versions.map(tv => tv.id))
        setSystemPrompt(latest.system_prompt)
        setUserPrompt(latest.user_prompt)
        setMaxTurns(String(latest.run_settings.max_turns))
        setMaxToolCalls(String(latest.run_settings.max_tool_calls))
        setTimeoutSeconds(String(latest.run_settings.timeout_seconds))
      }
    }
    if (!isEdit && modelConfigs.length > 0 && !selectedModelConfigId) {
      setSelectedModelConfigId(modelConfigs[0].id)
    }
  }, [plan, modelConfigs])

  function buildVersionPayload() {
    return {
      model_config_id: selectedModelConfigId,
      tool_version_ids: selectedToolVersionIds,
      system_prompt: systemPrompt,
      user_prompt: userPrompt,
      run_settings: {
        tool_order_strategy: 'fixed',
        max_turns: parseInt(maxTurns) || 20,
        max_tool_calls: parseInt(maxToolCalls) || 50,
        timeout_seconds: parseInt(timeoutSeconds) || 300,
      },
    }
  }

  async function handleSave() {
    setSaving(true)
    try {
      if (isEdit) {
        await api.plans.updateMeta(planId!, { name: planName, description: planDesc })
        await api.plans.addVersion(planId!, buildVersionPayload())
      } else {
        const created = await api.plans.create({
          name: planName, description: planDesc,
          version: buildVersionPayload(),
        })
        void created.id
      }
      qc.invalidateQueries({ queryKey: ['plans'] })
      navigate('/plans')
    } finally {
      setSaving(false)
    }
  }

  async function handleSaveAndRun() {
    setRunning(true)
    try {
      let savedPlan: Awaited<ReturnType<typeof api.plans.create>> | undefined
      if (isEdit) {
        await api.plans.updateMeta(planId!, { name: planName, description: planDesc })
        await api.plans.addVersion(planId!, buildVersionPayload())
        savedPlan = await api.plans.get(planId!)
      } else {
        savedPlan = await api.plans.create({
          name: planName, description: planDesc,
          version: buildVersionPayload(),
        })
      }
      const latest = savedPlan?.versions[savedPlan.versions.length - 1]
      if (!latest) return
      const session = await api.sessions.create(latest.id)
      await api.sessions.run(session.id)
      qc.invalidateQueries({ queryKey: ['plans', 'sessions'] })
      navigate(`/sessions/${session.id}`)
    } finally {
      setRunning(false)
    }
  }

  // Returns the selected version ID for a given tool (if any)
  function selectedVersionForTool(toolId: string): string | null {
    const tool = allTools.find(t => t.id === toolId)
    if (!tool) return null
    return tool.versions.find(v => selectedToolVersionIds.includes(v.id))?.id ?? null
  }

  function toggleTool(tool: typeof allTools[0]) {
    const currentlySelected = selectedVersionForTool(tool.id)
    if (currentlySelected) {
      // deselect
      setSelectedToolVersionIds(ids => ids.filter(id => id !== currentlySelected))
    } else {
      // select latest version by default
      const latest = tool.versions[tool.versions.length - 1]
      if (latest) setSelectedToolVersionIds(ids => [...ids, latest.id])
    }
  }

  function changeToolVersion(toolId: string, newVersionId: string) {
    const tool = allTools.find(t => t.id === toolId)
    if (!tool) return
    const allVersionIds = tool.versions.map(v => v.id)
    setSelectedToolVersionIds(ids => [
      ...ids.filter(id => !allVersionIds.includes(id)),
      newVersionId,
    ])
  }

  return (
    <div className="p-6 max-w-2xl">
      <button onClick={() => navigate('/plans')} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-5">
        <ArrowLeft className="w-4 h-4" /> Back
      </button>

      <h1 className="text-xl font-semibold mb-6">
        {isEdit ? `Edit Plan — ${plan?.name ?? ''}` : 'New Plan'}
      </h1>
      {isEdit && (
        <div className="mb-4 p-3 bg-blue-50 border border-blue-100 rounded-lg text-sm text-blue-700">
          Saving creates a new plan version. Existing sessions remain linked to their original version.
        </div>
      )}

      <section className="bg-white border border-gray-200 rounded-xl p-5 mb-4">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Plan Metadata</h2>
        <div className="space-y-3">
          <Field label="Plan name">
            <input className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-400" value={planName} onChange={e => setPlanName(e.target.value)} placeholder="Tool-selection study v1" />
          </Field>
          <Field label="Description">
            <input className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-400" value={planDesc} onChange={e => setPlanDesc(e.target.value)} placeholder="Optional notes" />
          </Field>
        </div>
      </section>

      <section className="bg-white border border-gray-200 rounded-xl p-5 mb-4">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Model</h2>
        {modelConfigs.length === 0 ? (
          <p className="text-sm text-amber-600">No model configs yet. <a href="/models" className="underline">Create one first.</a></p>
        ) : (
          <>
            {selectedModelMissing && (
              <p className="text-sm text-amber-600 mb-2">
                The model config originally used by this plan has been deleted. Select a new one before saving.
              </p>
            )}
            <select
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-400"
              value={selectedModelConfigId}
              onChange={e => setSelectedModelConfigId(e.target.value)}
            >
              {selectedModelMissing && (
                <option value={selectedModelConfigId} disabled>
                  Missing: {plan?.versions[plan.versions.length - 1]?.model_config_snapshot.name ?? 'Deleted config'}
                </option>
              )}
              {modelConfigs.map(mc => (
                <option key={mc.id} value={mc.id}>{mc.name} — {mc.model_snapshot}</option>
              ))}
            </select>
          </>
        )}
      </section>

      <section className="bg-white border border-gray-200 rounded-xl p-5 mb-4">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">
          Tools ({selectedToolVersionIds.length} selected)
        </h2>
        {allTools.length === 0 ? (
          <p className="text-sm text-amber-600">No tools in library yet. <a href="/tools/new" className="underline">Create one first.</a></p>
        ) : (
          <div className="relative mb-3">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent"
              placeholder="Search tools by name or description…"
              value={toolSearch}
              onChange={e => setToolSearch(e.target.value)}
            />
          </div>
        )}
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {(toolSearch
            ? allTools.filter(t =>
                t.name.toLowerCase().includes(toolSearch.toLowerCase()) ||
                t.description.toLowerCase().includes(toolSearch.toLowerCase())
              )
            : allTools
          ).map(tool => {
            if (tool.versions.length === 0) return null
            const selectedVersionId = selectedVersionForTool(tool.id)
            const isSelected = !!selectedVersionId
            const activeVersion = tool.versions.find(v => v.id === selectedVersionId)
              ?? tool.versions[tool.versions.length - 1]
            return (
              <div key={tool.id} className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${isSelected ? 'border-indigo-300 bg-indigo-50' : 'border-gray-200 hover:border-gray-300'}`}>
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => toggleTool(tool)}
                  className="rounded text-indigo-600 shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900">{tool.name}</p>
                  <p className="text-xs text-gray-400 font-mono">
                    fn: {activeVersion.display_name} · {activeVersion.response_mode}
                  </p>
                </div>
                {isSelected && tool.versions.length > 1 && (
                  <select
                    className="text-xs border border-indigo-200 bg-white rounded-lg px-2 py-1 focus:outline-none focus:border-indigo-400 shrink-0"
                    value={selectedVersionId ?? ''}
                    onChange={e => changeToolVersion(tool.id, e.target.value)}
                  >
                    {[...tool.versions].reverse().map(v => (
                      <option key={v.id} value={v.id}>
                        v{v.version_number}{v.id === tool.versions[tool.versions.length - 1].id ? ' (latest)' : ''}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )
          })}
        </div>
      </section>

      <section className="bg-white border border-gray-200 rounded-xl p-5 mb-4">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Prompts</h2>
        <div className="space-y-3">
          <Field label="System prompt">
            <textarea className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-400 min-h-[80px] resize-y" value={systemPrompt} onChange={e => setSystemPrompt(e.target.value)} />
          </Field>
          <Field label="User / starting prompt">
            <textarea className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-400 min-h-[80px] resize-y" value={userPrompt} onChange={e => setUserPrompt(e.target.value)} placeholder="What do you need help with?" />
          </Field>
        </div>
      </section>

      <section className="bg-white border border-gray-200 rounded-xl p-5 mb-6">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Run Settings</h2>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Max turns">
            <input type="number" min="1" max="100" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-400" value={maxTurns} onChange={e => setMaxTurns(e.target.value)} />
          </Field>
          <Field label="Max tool calls">
            <input type="number" min="1" max="200" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-400" value={maxToolCalls} onChange={e => setMaxToolCalls(e.target.value)} />
          </Field>
          <Field label="Timeout (seconds)">
            <input type="number" min="1" max="3600" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-indigo-400" value={timeoutSeconds} onChange={e => setTimeoutSeconds(e.target.value)} />
          </Field>
        </div>
      </section>

      <div className="flex gap-3">
        <button
          onClick={handleSaveAndRun}
          disabled={running || saving || !planName || !selectedModelConfigId || selectedModelMissing}
          className="flex items-center gap-1.5 px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50 transition-colors"
        >
          <Play className="w-4 h-4" /> {running ? 'Launching…' : 'Save & Run Once'}
        </button>
        <button
          onClick={handleSave}
          disabled={saving || running || !planName || !selectedModelConfigId || selectedModelMissing}
          className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
        >
          {saving ? 'Saving…' : 'Save Plan'}
        </button>
        <button onClick={() => navigate('/plans')} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Cancel</button>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      {children}
    </div>
  )
}
