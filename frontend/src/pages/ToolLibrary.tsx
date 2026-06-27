import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { Plus, Pencil, Trash2, Tag, Copy, Sparkles, Search, Eye, BarChart2 } from 'lucide-react'
import { api } from '../api/client'
import type { Tool } from '../types'

export default function ToolLibrary() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const { data: tools = [], isLoading } = useQuery({ queryKey: ['tools'], queryFn: api.tools.list })
  const del = useMutation({
    mutationFn: api.tools.delete,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tools'] }),
  })
  const clone = useMutation({
    mutationFn: api.tools.clone,
    onSuccess: (t) => {
      qc.invalidateQueries({ queryKey: ['tools'] })
      navigate(`/tools/${t.id}/edit`)
    },
  })

  const filtered = search
    ? tools.filter(t =>
        t.name.toLowerCase().includes(search.toLowerCase()) ||
        t.description.toLowerCase().includes(search.toLowerCase())
      )
    : tools

  return (
    <div className="p-6 max-w-5xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Tool Library</h1>
          <p className="text-sm text-gray-500 mt-0.5">Fake tools for probing model behaviour</p>
        </div>
        <Link
          to="/tools/new"
          className="flex items-center gap-1.5 px-3 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors"
        >
          <Plus className="w-4 h-4" />
          New Tool
        </Link>
      </div>

      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:border-transparent"
          placeholder="Search tools by name or description…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {isLoading && <p className="text-sm text-gray-400">Loading…</p>}

      {!isLoading && filtered.length === 0 && (
        <div className="border-2 border-dashed border-gray-200 rounded-xl p-12 text-center">
          <p className="text-gray-400 text-sm">
            {search ? 'No tools match your search.' : 'No tools yet. Create your first fake tool.'}
          </p>
          {search ? (
            <button onClick={() => setSearch('')} className="mt-3 text-sm text-indigo-600 hover:text-indigo-700">
              Clear search
            </button>
          ) : (
            <Link to="/tools/new" className="mt-3 inline-flex items-center gap-1 text-sm text-indigo-600 hover:text-indigo-700">
              <Plus className="w-4 h-4" /> Create tool
            </Link>
          )}
        </div>
      )}

      <div className="grid gap-3">
        {filtered.map(tool => (
          <ToolCard key={tool.id} tool={tool} onDelete={() => del.mutate(tool.id)} onClone={() => clone.mutate(tool.id)} />
        ))}
      </div>
    </div>
  )
}

function ToolCard({ tool, onDelete, onClone }: { tool: Tool; onDelete: () => void; onClone: () => void }) {
  const latest = tool.versions[tool.versions.length - 1]
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 flex items-start gap-4 hover:border-gray-300 transition-colors">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <Link to={`/tools/${tool.id}`} className="font-medium text-gray-900 hover:text-indigo-600 transition-colors">{tool.name}</Link>
          {tool.built_in && (
            <span className="flex items-center gap-0.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded">
              <Sparkles className="w-3 h-3" /> built-in
            </span>
          )}
          <span className="text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">
            v{tool.versions.length}
          </span>
          {latest && (
            <span className={`text-xs px-1.5 py-0.5 rounded font-mono ${
              latest.response_mode === 'static' ? 'bg-blue-50 text-blue-600' :
              latest.response_mode === 'dynamic' ? 'bg-purple-50 text-purple-600' :
              'bg-yellow-50 text-yellow-600'
            }`}>
              {latest.response_mode}
            </span>
          )}
        </div>
        {tool.description && <p className="text-sm text-gray-500 mb-1">{tool.description}</p>}
        {latest && (
          <p className="text-xs text-gray-400 font-mono truncate">
            fn: {latest.display_name}(…)
          </p>
        )}
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
      <div className="flex items-center gap-2 shrink-0">
        <Link
          to={`/tools/${tool.id}/stats`}
          className="p-1.5 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded transition-colors"
          title="View stats"
        >
          <BarChart2 className="w-4 h-4" />
        </Link>
        <Link
          to={`/tools/${tool.id}`}
          className="p-1.5 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded transition-colors"
          title="View details"
        >
          <Eye className="w-4 h-4" />
        </Link>
        {tool.built_in ? (
          <button
            onClick={onClone}
            className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition-colors"
            title="Clone this built-in tool to make it your own"
          >
            <Copy className="w-3.5 h-3.5" /> Clone
          </button>
        ) : (
          <>
            <Link
              to={`/tools/${tool.id}/edit`}
              className="p-1.5 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded transition-colors"
              title="Edit / new version"
            >
              <Pencil className="w-4 h-4" />
            </Link>
            <button
              onClick={() => {
                if (confirm(`Delete "${tool.name}"?`)) onDelete()
              }}
              className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </>
        )}
      </div>
    </div>
  )
}
