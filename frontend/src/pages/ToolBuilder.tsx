import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Plus, Trash2 } from 'lucide-react'
import { api } from '../api/client'
import PythonCodeEditor from '../components/PythonCodeEditor'

interface Param {
  name: string
  type: string
  description: string
  required: boolean
}

function paramsToSchema(params: Param[]): Record<string, unknown> {
  const props: Record<string, unknown> = {}
  const required: string[] = []
  for (const p of params) {
    props[p.name] = { type: p.type, description: p.description }
    if (p.required) required.push(p.name)
  }
  return { type: 'object', properties: props, required }
}

function schemaToParams(schema: Record<string, unknown>): Param[] {
  const props = (schema.properties as Record<string, Record<string, string>>) ?? {}
  const req = (schema.required as string[]) ?? []
  return Object.entries(props).map(([name, def]) => ({
    name,
    type: def.type ?? 'string',
    description: def.description ?? '',
    required: req.includes(name),
  }))
}

export default function ToolBuilder() {
  const { toolId } = useParams<{ toolId?: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const isEdit = !!toolId

  const { data: tool } = useQuery({
    queryKey: ['tools', toolId],
    queryFn: () => api.tools.get(toolId!),
    enabled: isEdit,
  })

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [tags, setTags] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [modelDesc, setModelDesc] = useState('')
  const [responseMode, setResponseMode] = useState<'static' | 'dynamic'>('static')
  const [params, setParams] = useState<Param[]>([])
  const [staticResponse, setStaticResponse] = useState('{\n  "result": "ok"\n}')
  const [dynamicCode, setDynamicCode] = useState('def respond(args, context):\n    return {"result": "ok"}')
  const [jsonError, setJsonError] = useState('')
  const [saving, setSaving] = useState(false)

  const [builtInBlocked, setBuiltInBlocked] = useState(false)

  useEffect(() => {
    if (tool) {
      if (tool.built_in) {
        setBuiltInBlocked(true)
        return
      }
      setName(tool.name)
      setDescription(tool.description)
      setTags(tool.tags.join(', '))
      const latest = tool.versions[tool.versions.length - 1]
      if (latest) {
        setDisplayName(latest.display_name)
        setModelDesc(latest.model_facing_description)
        setResponseMode(latest.response_mode === 'dynamic' ? 'dynamic' : 'static')
        setParams(schemaToParams(latest.parameter_schema))
        setStaticResponse(JSON.stringify(latest.static_response, null, 2))
        setDynamicCode(latest.dynamic_code ?? 'def respond(args, context):\n    return {"result": "ok"}')
      }
    }
  }, [tool])

  function validateJson(val: string): boolean {
    try { JSON.parse(val); setJsonError(''); return true }
    catch (e: unknown) { setJsonError((e as Error).message); return false }
  }

  async function handleSave() {
    if (!validateJson(staticResponse) && responseMode === 'static') return
    setSaving(true)
    try {
      const versionPayload = {
        display_name: displayName || name,
        model_facing_description: modelDesc,
        parameter_schema: paramsToSchema(params),
        response_mode: responseMode,
        static_response: responseMode === 'static' ? JSON.parse(staticResponse) : {},
        dynamic_code: responseMode === 'dynamic' ? dynamicCode : null,
      }
      if (isEdit) {
        await api.tools.updateMeta(toolId!, {
          name, description, tags: tags.split(',').map(t => t.trim()).filter(Boolean),
        })
        await api.tools.addVersion(toolId!, versionPayload)
      } else {
        await api.tools.create({
          name, description,
          tags: tags.split(',').map(t => t.trim()).filter(Boolean),
          version: versionPayload,
        })
      }
      qc.invalidateQueries({ queryKey: ['tools'] })
      navigate('/tools')
    } finally {
      setSaving(false)
    }
  }

  function addParam() {
    setParams(p => [...p, { name: '', type: 'string', description: '', required: false }])
  }
  function removeParam(i: number) {
    setParams(p => p.filter((_, idx) => idx !== i))
  }
  function updateParam(i: number, field: keyof Param, value: string | boolean) {
    setParams(p => p.map((param, idx) => idx === i ? { ...param, [field]: value } : param))
  }

  return (
    <div className="p-6 max-w-2xl">
      <button onClick={() => navigate('/tools')} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-5">
        <ArrowLeft className="w-4 h-4" /> Back
      </button>

      <h1 className="text-xl font-semibold mb-6">
        {isEdit ? `Edit Tool${tool ? ` — ${tool.name}` : ''}` : 'New Tool'}
      </h1>
      {builtInBlocked && (
        <div className="mb-4 p-4 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
          <strong>This is a built-in tool.</strong> Built-in tools cannot be edited directly.
          <button
            onClick={async () => {
              const cloned = await api.tools.clone(tool!.id)
              navigate(`/tools/${cloned.id}/edit`)
            }}
            className="ml-2 inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-amber-700 bg-amber-100 hover:bg-amber-200 rounded transition-colors"
          >
            Clone it instead
          </button>
        </div>
      )}
      {isEdit && !builtInBlocked && (
        <div className="mb-4 p-3 bg-blue-50 border border-blue-100 rounded-lg text-sm text-blue-700">
          Saving will create a new version. Existing plan versions remain unaffected.
        </div>
      )}

      <section className="bg-white border border-gray-200 rounded-xl p-5 mb-4">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Library Metadata</h2>
        <div className="space-y-3">
          <Field label="Tool name (library)">
            <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. web_search" />
          </Field>
          <Field label="Description (your notes)">
            <input className="input" value={description} onChange={e => setDescription(e.target.value)} placeholder="Optional notes" />
          </Field>
          <Field label="Tags (comma-separated)">
            <input className="input" value={tags} onChange={e => setTags(e.target.value)} placeholder="search, web" />
          </Field>
        </div>
      </section>

      <section className="bg-white border border-gray-200 rounded-xl p-5 mb-4">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Model-Facing Definition</h2>
        <div className="space-y-3">
          <Field label="Function name (model sees this)">
            <input className="input font-mono" value={displayName} onChange={e => setDisplayName(e.target.value)} placeholder="search_web" />
          </Field>
          <Field label="Description (model sees this)">
            <textarea className="input min-h-[80px] resize-y" value={modelDesc} onChange={e => setModelDesc(e.target.value)} placeholder="Search the web for information." />
          </Field>
        </div>
      </section>

      <section className="bg-white border border-gray-200 rounded-xl p-5 mb-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-700">Parameters</h2>
          <button onClick={addParam} className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-700">
            <Plus className="w-3.5 h-3.5" /> Add parameter
          </button>
        </div>
        {params.length === 0 && (
          <p className="text-sm text-gray-400">No parameters. Model can call this tool with no arguments.</p>
        )}
        <div className="space-y-2">
          {params.map((p, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_2fr_auto_auto] gap-2 items-center">
              <input className="input text-xs font-mono" placeholder="name" value={p.name} onChange={e => updateParam(i, 'name', e.target.value)} />
              <select className="input text-xs" value={p.type} onChange={e => updateParam(i, 'type', e.target.value)}>
                {['string', 'number', 'integer', 'boolean', 'array', 'object'].map(t => (
                  <option key={t}>{t}</option>
                ))}
              </select>
              <input className="input text-xs" placeholder="description" value={p.description} onChange={e => updateParam(i, 'description', e.target.value)} />
              <label className="flex items-center gap-1 text-xs text-gray-500 whitespace-nowrap">
                <input type="checkbox" checked={p.required} onChange={e => updateParam(i, 'required', e.target.checked)} className="rounded" />
                req
              </label>
              <button onClick={() => removeParam(i)} className="text-gray-400 hover:text-red-500">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="bg-white border border-gray-200 rounded-xl p-5 mb-6">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Response Mode</h2>
        <div className="flex gap-3 mb-4">
          {(['static', 'dynamic'] as const).map(mode => (
            <button
              key={mode}
              onClick={() => setResponseMode(mode)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                responseMode === mode
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
              }`}
            >
              {mode}
            </button>
          ))}
        </div>

        {responseMode === 'static' && (
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1 block">Static JSON response</label>
            <textarea
              className={`input font-mono text-xs min-h-[120px] resize-y ${jsonError ? 'border-red-400' : ''}`}
              value={staticResponse}
              onChange={e => { setStaticResponse(e.target.value); validateJson(e.target.value) }}
            />
            {jsonError && <p className="text-xs text-red-500 mt-1">{jsonError}</p>}
          </div>
        )}

        {responseMode === 'dynamic' && (
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1 block">
              Python — <code className="bg-gray-100 px-1 rounded">def respond(args, context)</code>
            </label>
            <PythonCodeEditor
              value={dynamicCode}
              onChange={setDynamicCode}
              minHeight="160px"
              data-testid="dynamic-code-editor"
            />
            <p className="text-xs text-amber-600 mt-1">Executes in-process without sandboxing. Only use code you authored.</p>
          </div>
        )}
      </section>

      <div className="flex gap-3">
        <button
          onClick={handleSave}
          disabled={saving || !name || !displayName}
          className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
        >
          {saving ? 'Saving…' : isEdit ? 'Save as New Version' : 'Create Tool'}
        </button>
        <button onClick={() => navigate('/tools')} className="px-4 py-2 text-gray-600 text-sm hover:text-gray-800">
          Cancel
        </button>
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

