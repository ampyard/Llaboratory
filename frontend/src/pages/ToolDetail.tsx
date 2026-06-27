import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { ArrowLeft, Sparkles, Copy, Pencil, Tag, BarChart2 } from 'lucide-react'
import { api } from '../api/client'
import type { ToolVersion } from '../types'

export default function ToolDetail() {
  const { toolId } = useParams<{ toolId: string }>()
  const navigate = useNavigate()
  const { data: tool, isLoading } = useQuery({
    queryKey: ['tools', toolId],
    queryFn: () => api.tools.get(toolId!),
    enabled: !!toolId,
  })

  const [selectedVersionIdx, setSelectedVersionIdx] = useState(-1)

  if (isLoading) return <div className="p-6 text-sm text-gray-400">Loading…</div>
  if (!tool) return <div className="p-6 text-sm text-red-500">Tool not found.</div>

  const idx = selectedVersionIdx >= 0 ? selectedVersionIdx : tool.versions.length - 1
  const version = tool.versions[idx]

  return (
    <div className="p-6 max-w-3xl">
      <button onClick={() => navigate('/tools')} className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-5">
        <ArrowLeft className="w-4 h-4" /> Back to Library
      </button>

      {/* Header */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 mb-4">
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h1 className="text-xl font-semibold text-gray-900">{tool.name}</h1>
              {tool.built_in && (
                <span className="flex items-center gap-0.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded shrink-0">
                  <Sparkles className="w-3 h-3" /> built-in
                </span>
              )}
            </div>
            {tool.description && <p className="text-sm text-gray-500 mb-2">{tool.description}</p>}
            <div className="flex items-center gap-2 text-xs text-gray-400">
              <span>{tool.versions.length} version{tool.versions.length !== 1 ? 's' : ''}</span>
              <span>·</span>
              <span>Created {new Date(tool.created_at).toLocaleDateString()}</span>
            </div>
            {tool.tags.length > 0 && (
              <div className="flex gap-1 mt-2">
                {tool.tags.map(t => (
                  <span key={t} className="flex items-center gap-1 text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">
                    <Tag className="w-3 h-3" /> {t}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0 ml-4">
            <div className="flex items-center gap-2">
              <Link
                to={`/tools/${tool.id}/stats`}
                className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
              >
                <BarChart2 className="w-3.5 h-3.5" /> Stats
              </Link>
              {tool.built_in ? (
                <Link
                  to={`/tools/${tool.id}/clone`}
                  onClick={async (e) => {
                    e.preventDefault()
                    const cloned = await api.tools.clone(tool.id)
                    navigate(`/tools/${cloned.id}/edit`)
                  }}
                  className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition-colors"
                >
                  <Copy className="w-3.5 h-3.5" /> Clone
                </Link>
              ) : (
                <Link
                  to={`/tools/${tool.id}/edit`}
                  className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition-colors"
                >
                  <Pencil className="w-3.5 h-3.5" /> Edit
                </Link>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Version selector */}
      {tool.versions.length > 1 && (
        <div className="flex items-center gap-2 mb-4">
          <span className="text-xs font-medium text-gray-500">Version:</span>
          <div className="flex gap-1">
            {tool.versions.map((v, i) => (
              <button
                key={v.id}
                onClick={() => setSelectedVersionIdx(i)}
                className={`px-2.5 py-1 text-xs font-medium rounded-lg border transition-colors ${
                  i === idx
                    ? 'bg-indigo-600 text-white border-indigo-600'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
                }`}
              >
                v{v.version_number}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Version detail */}
      {version && <VersionDetail version={version} />}
    </div>
  )
}

function VersionDetail({ version }: { version: ToolVersion }) {
  return (
    <div className="space-y-4">
      <section className="bg-white border border-gray-200 rounded-xl p-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Model-Facing Definition</h2>
        <div className="space-y-3">
          <DetailField label="Function name">
            <code className="text-sm bg-gray-100 px-2 py-0.5 rounded font-mono">{version.display_name}</code>
          </DetailField>
          <DetailField label="Description">
            <p className="text-sm text-gray-700 whitespace-pre-wrap">{version.model_facing_description || '—'}</p>
          </DetailField>
          <DetailField label="Response mode">
            <span className={`text-xs px-1.5 py-0.5 rounded font-mono ${
              version.response_mode === 'static' ? 'bg-blue-50 text-blue-600' :
              version.response_mode === 'dynamic' ? 'bg-purple-50 text-purple-600' :
              'bg-yellow-50 text-yellow-600'
            }`}>
              {version.response_mode}
            </span>
          </DetailField>
        </div>
      </section>

      <section className="bg-white border border-gray-200 rounded-xl p-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Parameter Schema</h2>
        <pre className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-xs font-mono overflow-x-auto max-h-64">
          {JSON.stringify(version.parameter_schema, null, 2)}
        </pre>
      </section>

      <section className="bg-white border border-gray-200 rounded-xl p-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">
          {version.response_mode === 'static' ? 'Static Response' : 'Dynamic Code'}
        </h2>
        {version.response_mode === 'static' ? (
          <pre className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-xs font-mono overflow-x-auto max-h-96">
            {JSON.stringify(version.static_response, null, 2)}
          </pre>
        ) : (
          <pre className="bg-gray-50 border border-gray-200 rounded-lg p-3 text-xs font-mono overflow-x-auto max-h-96">
            {version.dynamic_code || '—'}
          </pre>
        )}
      </section>

      {version.dynamic_code && version.dynamic_approved === 0 && (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700">
          This dynamic tool is pending approval and will not execute.
        </div>
      )}
    </div>
  )
}

function DetailField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
      {children}
    </div>
  )
}
