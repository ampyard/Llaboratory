import { useState, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Download, Upload, FileUp, Check, AlertTriangle,
  RefreshCw, Wrench, Server, FlaskConical,
} from 'lucide-react'
import { api } from '../api/client'
import type { ExportConflict, ImportResult } from '../types'

type EntityType = 'tools' | 'model_configs' | 'plans'

export default function DataTransfer() {
  const qc = useQueryClient()

  // ── Export state ──
  const [exportAll, setExportAll] = useState(true)
  const [selectedTools, setSelectedTools] = useState<Record<string, boolean>>({})
  const [selectedMCs, setSelectedMCs] = useState<Record<string, boolean>>({})
  const [selectedPlans, setSelectedPlans] = useState<Record<string, boolean>>({})
  const [exporting, setExporting] = useState(false)

  // ── Import state ──
  const [file, setFile] = useState<File | null>(null)
  const [checking, setChecking] = useState(false)
  const [importing, setImporting] = useState(false)
  const [checkResult, setCheckResult] = useState<{
    has_conflicts: boolean
    conflicts: ExportConflict[]
  } | null>(null)
  const [importResult, setImportResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [renameMap, setRenameMap] = useState<Record<string, Record<string, string>>>({
    tools: {},
    model_configs: {},
    plans: {},
  })
  const fileRef = useRef<HTMLInputElement>(null)
  const [showComplete, setShowComplete] = useState(false)

  const { data: tools = [] } = useQuery({ queryKey: ['tools'], queryFn: api.tools.list })
  const { data: mcs = [] } = useQuery({ queryKey: ['model-configs'], queryFn: api.modelConfigs.list })
  const { data: plans = [] } = useQuery({ queryKey: ['plans'], queryFn: api.plans.list })

  // ── Export ──

  function toggleEntityType(type: EntityType, checked: boolean) {
    if (type === 'tools') {
      const next: Record<string, boolean> = {}
      if (!checked) tools.forEach(t => next[t.id] = true)
      setSelectedTools(next)
    } else if (type === 'model_configs') {
      const next: Record<string, boolean> = {}
      if (!checked) mcs.forEach(m => next[m.id] = true)
      setSelectedMCs(next)
    } else {
      const next: Record<string, boolean> = {}
      if (!checked) plans.forEach(p => next[p.id] = true)
      setSelectedPlans(next)
    }
  }

  function toggleAll() {
    const next = !exportAll
    setExportAll(next)
    if (!next) {
      const allTools: Record<string, boolean> = {}
      const allMCs: Record<string, boolean> = {}
      const allPlans: Record<string, boolean> = {}
      tools.forEach(t => allTools[t.id] = true)
      mcs.forEach(m => allMCs[m.id] = true)
      plans.forEach(p => allPlans[p.id] = true)
      setSelectedTools(allTools)
      setSelectedMCs(allMCs)
      setSelectedPlans(allPlans)
    } else {
      setSelectedTools({})
      setSelectedMCs({})
      setSelectedPlans({})
    }
  }

  async function handleExport() {
    setExporting(true)
    setError(null)
    try {
      const body: { tool_ids?: string[]; model_config_ids?: string[]; plan_ids?: string[] } = {}
      if (!exportAll) {
        const tIds = Object.entries(selectedTools).filter(([, v]) => v).map(([k]) => k)
        const mIds = Object.entries(selectedMCs).filter(([, v]) => v).map(([k]) => k)
        const pIds = Object.entries(selectedPlans).filter(([, v]) => v).map(([k]) => k)
        if (tIds.length > 0) body.tool_ids = tIds
        if (mIds.length > 0) body.model_config_ids = mIds
        if (pIds.length > 0) body.plan_ids = pIds
      }
      await api.export.download(body)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setExporting(false)
    }
  }

  // ── Import ──

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] || null
    setFile(f)
    setCheckResult(null)
    setImportResult(null)
    setError(null)
    setRenameMap({ tools: {}, model_configs: {}, plans: {} })
  }

  async function handleCheck() {
    if (!file) return
    setChecking(true)
    setError(null)
    setCheckResult(null)
    setImportResult(null)
    try {
      const result = await api.import.check(file)
      setCheckResult(result)
      if (result.has_conflicts) {
        const renames: Record<string, Record<string, string>> = {
          tools: {},
          model_configs: {},
          plans: {},
        }
        for (const c of result.conflicts) {
          renames[c.type + 's'][c.name] = c.name + ' (imported)'
        }
        setRenameMap(renames)
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setChecking(false)
    }
  }

  async function handleImport() {
    if (!file) return
    setImporting(true)
    setError(null)
    setImportResult(null)
    try {
      const result = await api.import.run(file, renameMap)
      setImportResult(result)
      if (result.success) {
        setFile(null)
        setCheckResult(null)
        if (fileRef.current) fileRef.current.value = ''
        setShowComplete(true)
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setImporting(false)
    }
  }

  function closeComplete() {
    setShowComplete(false)
    setImportResult(null)
    qc.clear()
  }

  function setRename(type: EntityType, oldName: string, newName: string) {
    setRenameMap(m => ({
      ...m,
      [type]: { ...m[type], [oldName]: newName },
    }))
  }

  // ── Selection helpers ──

  const allToolsSelected = tools.length > 0 && tools.every(t => selectedTools[t.id])
  const allMCsSelected = mcs.length > 0 && mcs.every(m => selectedMCs[m.id])
  const allPlansSelected = plans.length > 0 && plans.every(p => selectedPlans[p.id])

  return (
    <div className="p-6 max-w-4xl">
      <div className="mb-6">
        <h1 className="text-xl font-semibold">Data Transfer</h1>
        <p className="text-sm text-gray-500 mt-0.5">Export or import tools, model configs, and plans.</p>
      </div>

      {error && (
        <div className="mb-4 flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg px-4 py-3">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {/* ── Export Section ── */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 mb-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Download className="w-5 h-5 text-indigo-600" />
            <h2 className="text-lg font-semibold">Export</h2>
          </div>
          <button
            onClick={toggleAll}
            className="text-xs text-indigo-600 hover:text-indigo-800 font-medium"
          >
            {exportAll ? 'Select specific items' : 'Export all'}
          </button>
        </div>

        <div className="space-y-4">
          {/* Tools */}
          <div>
            <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-1.5">
              <input
                type="checkbox"
                checked={exportAll || allToolsSelected}
                onChange={e => { if (!exportAll) toggleEntityType('tools', e.target.checked) }}
                disabled={exportAll}
                className="rounded border-gray-300 text-indigo-600"
              />
              <Wrench className="w-4 h-4" />
              Tools ({tools.length})
            </label>
            {!exportAll && (
              <div className="ml-5 space-y-1 max-h-40 overflow-y-auto">
                {tools.map(t => (
                  <label key={t.id} className="flex items-center gap-2 text-xs text-gray-600">
                    <input
                      type="checkbox"
                      checked={!!selectedTools[t.id]}
                      onChange={e => setSelectedTools(s => ({ ...s, [t.id]: e.target.checked }))}
                      className="rounded border-gray-300 text-indigo-600"
                    />
                    {t.name}
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* Model Configs */}
          <div>
            <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-1.5">
              <input
                type="checkbox"
                checked={exportAll || allMCsSelected}
                onChange={e => { if (!exportAll) toggleEntityType('model_configs', e.target.checked) }}
                disabled={exportAll}
                className="rounded border-gray-300 text-indigo-600"
              />
              <Server className="w-4 h-4" />
              Model Configs ({mcs.length})
            </label>
            {!exportAll && (
              <div className="ml-5 space-y-1 max-h-40 overflow-y-auto">
                {mcs.map(m => (
                  <label key={m.id} className="flex items-center gap-2 text-xs text-gray-600">
                    <input
                      type="checkbox"
                      checked={!!selectedMCs[m.id]}
                      onChange={e => setSelectedMCs(s => ({ ...s, [m.id]: e.target.checked }))}
                      className="rounded border-gray-300 text-indigo-600"
                    />
                    {m.name}
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* Plans */}
          <div>
            <label className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-1.5">
              <input
                type="checkbox"
                checked={exportAll || allPlansSelected}
                onChange={e => { if (!exportAll) toggleEntityType('plans', e.target.checked) }}
                disabled={exportAll}
                className="rounded border-gray-300 text-indigo-600"
              />
              <FlaskConical className="w-4 h-4" />
              Plans ({plans.length})
            </label>
            {!exportAll && (
              <div className="ml-5 space-y-1 max-h-40 overflow-y-auto">
                {plans.map(p => (
                  <label key={p.id} className="flex items-center gap-2 text-xs text-gray-600">
                    <input
                      type="checkbox"
                      checked={!!selectedPlans[p.id]}
                      onChange={e => setSelectedPlans(s => ({ ...s, [p.id]: e.target.checked }))}
                      className="rounded border-gray-300 text-indigo-600"
                    />
                    {p.name}
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>

        <button
          onClick={handleExport}
          disabled={exporting}
          className="mt-4 flex items-center gap-1.5 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
        >
          <Download className="w-4 h-4" />
          {exporting ? 'Exporting…' : 'Download Export ZIP'}
        </button>
      </div>

      {/* ── Import Section ── */}
      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <Upload className="w-5 h-5 text-indigo-600" />
          <h2 className="text-lg font-semibold">Import</h2>
        </div>

        <p className="text-sm text-gray-500 mb-3">
          Upload a previously exported ZIP archive. The system will check for naming conflicts before importing.
        </p>

        {/* File picker */}
        <div className="flex items-center gap-3 mb-4">
          <label className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50 cursor-pointer transition-colors">
            <FileUp className="w-4 h-4" />
            Choose file
            <input
              ref={fileRef}
              type="file"
              accept=".zip"
              className="hidden"
              onChange={handleFileChange}
            />
          </label>
          {file && <span className="text-sm text-gray-600">{file.name}</span>}
        </div>

        {file && !checkResult && !importResult && (
          <button
            onClick={handleCheck}
            disabled={checking}
            className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
          >
            {checking ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            {checking ? 'Checking…' : 'Check for conflicts'}
          </button>
        )}

        {/* Check result */}
        {checkResult && !importResult && (
          <div className="mt-4">
            {checkResult.has_conflicts ? (
              <div>
                <div className="flex items-center gap-2 text-sm font-medium text-amber-700 mb-3">
                  <AlertTriangle className="w-4 h-4" />
                  Naming conflicts found — rename the incoming items before importing
                </div>
                <div className="space-y-2 mb-4">
                  {checkResult.conflicts.map((c, i) => {
                    const type = (c.type + 's') as EntityType
                    return (
                      <div key={i} className="flex items-center gap-2">
                        <span className="text-xs text-gray-400 w-24 shrink-0">{c.type.replace('_', ' ')}</span>
                        <input
                          className="flex-1 border border-gray-200 rounded px-2 py-1 text-sm focus:outline-none focus:border-indigo-400"
                          value={renameMap[type][c.name] || c.name}
                          onChange={e => setRename(type, c.name, e.target.value)}
                        />
                      </div>
                    )
                  })}
                </div>
                <button
                  onClick={handleImport}
                  disabled={importing}
                  className="flex items-center gap-1.5 px-4 py-2 bg-amber-600 text-white rounded-lg text-sm font-medium hover:bg-amber-700 disabled:opacity-50 transition-colors"
                >
                  {importing ? 'Importing…' : 'Import with these names'}
                </button>
              </div>
            ) : (
              <div>
                <div className="flex items-center gap-2 text-sm font-medium text-green-700 mb-3">
                  <Check className="w-4 h-4" />
                  No naming conflicts — ready to import
                </div>
                <button
                  onClick={handleImport}
                  disabled={importing}
                  className="flex items-center gap-1.5 px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50 transition-colors"
                >
                  {importing ? 'Importing…' : 'Import'}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Import error */}
        {!importing && error && (
          <div className="mt-4">
            <div className="flex items-center gap-2 text-sm font-medium text-amber-700 mb-2">
              <AlertTriangle className="w-4 h-4" />
              Import failed
            </div>
            <p className="text-xs text-amber-600 ml-6">{error}</p>
          </div>
        )}

        {/* Import failed — conflicts */}
        {importResult && !importResult.success && !importing && (
          <div className="mt-4">
            <div className="flex items-center gap-2 text-sm font-medium text-amber-700 mb-2">
              <AlertTriangle className="w-4 h-4" />
              Import failed — conflicts still exist
            </div>
            {(importResult.conflicts ?? []).map((c, i) => (
              <p key={i} className="text-xs text-amber-600 ml-6">{c.message}</p>
            ))}
          </div>
        )}
      </div>

      {/* ── Importing overlay ── */}
      {importing && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-xl p-8 flex flex-col items-center gap-4">
            <RefreshCw className="w-8 h-8 text-indigo-600 animate-spin" />
            <p className="text-sm font-medium text-gray-700">Importing data…</p>
            <p className="text-xs text-gray-400">This may take a moment</p>
          </div>
        </div>
      )}

      {/* ── Import complete modal ── */}
      {showComplete && importResult?.success && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6">
            <div className="flex flex-col items-center gap-3 mb-5">
              <div className="p-3 bg-green-100 rounded-full">
                <Check className="w-8 h-8 text-green-600" />
              </div>
              <h2 className="text-xl font-semibold text-gray-900">Import Complete</h2>
            </div>
            <div className="space-y-1 text-sm text-gray-600 mb-6">
              <p>Tools: {String(importResult.imported_tools)} ({String(importResult.imported_tool_versions)} versions)</p>
              <p>Model configs: {String(importResult.imported_model_configs)}</p>
              <p>Plans: {String(importResult.imported_plans)} ({String(importResult.imported_plan_versions)} versions)</p>
              {importResult.imported_run_batches != null && <p>Run batches: {String(importResult.imported_run_batches)}</p>}
              {importResult.imported_sessions != null && <p>Sessions: {String(importResult.imported_sessions)}</p>}
              {importResult.imported_events != null && <p>Events: {String(importResult.imported_events)}</p>}
            </div>
            <div className="flex justify-end gap-3">
              <button
                onClick={closeComplete}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors"
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
