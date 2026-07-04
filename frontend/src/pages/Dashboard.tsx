import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Navigate, Link } from 'react-router-dom'
import { Check, Wrench, Server, FlaskConical, Sparkles, Eye, X } from 'lucide-react'
import { api } from '../api/client'
import type { SeedToolPreview } from '../types'

export default function Dashboard() {
  const qc = useQueryClient()
  const { data: tools, isLoading: toolsLoading } = useQuery({ queryKey: ['tools'], queryFn: api.tools.list })
  const { data: modelConfigs, isLoading: modelsLoading } = useQuery({ queryKey: ['modelConfigs'], queryFn: api.modelConfigs.list })
  const { data: plans, isLoading: plansLoading } = useQuery({ queryKey: ['plans'], queryFn: api.plans.list })
  const [seeding, setSeeding] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const { data: sampleTools } = useQuery({
    queryKey: ['seed-preview'],
    queryFn: api.seed.preview,
    enabled: showPreview,
    staleTime: 300_000,
  })

  if (plansLoading || toolsLoading || modelsLoading) return null

  if (plans && plans.length > 0) return <Navigate to="/tools" replace />

  const hasTools = !!tools && tools.length > 0

  async function loadSamples() {
    setSeeding(true)
    try {
      await api.seed()
      await qc.invalidateQueries({ queryKey: ['tools'] })
    } finally {
      setSeeding(false)
    }
  }

  const steps = [
    {
      label: 'Create a tool',
      description: 'Define a fake tool your model will be able to call during a session.',
      done: hasTools,
      to: '/tools/new',
      cta: 'Create tool',
      icon: Wrench,
    },
    {
      label: 'Configure a model',
      description: 'Set up the model that will run against your tools.',
      done: !!modelConfigs && modelConfigs.length > 0,
      to: '/models',
      cta: 'Configure model',
      icon: Server,
    },
    {
      label: 'Build & run a plan',
      description: 'Assemble tools + model + prompts into a plan, then run it.',
      done: false,
      to: '/plans/new',
      cta: 'Create plan',
      icon: FlaskConical,
    },
  ]

  return (
    <div className="p-6 max-w-2xl">
      <div className="mb-6">
        <div className="flex items-center gap-3">
          <img src="/logo-small.png" alt="Llaboratory" className="h-10 w-auto" />
          <h1 className="text-xl font-semibold">Welcome to Llaboratory</h1>
        </div>
        <div className="mt-3 bg-gradient-to-r from-indigo-50 via-white to-purple-50 border border-indigo-100 rounded-xl p-4">
          <p className="text-sm text-gray-600 leading-relaxed">
            This is a research sandbox for studying how different LLMs reason about and call tools. 
            Craft fake tools, wire in any model, and observe how each model behaves.
          </p>
          <div className="grid grid-cols-[1fr_auto_1fr_auto_1fr] items-center gap-2 text-xs font-medium text-gray-400 mt-3">
            <div className="flex flex-col items-center gap-1.5 p-2 rounded-lg bg-white/60 border border-indigo-100">
              <Wrench className="w-4 h-4 text-indigo-500" />
              <span className="text-center">Define fake tools</span>
            </div>
            <span className="text-indigo-300 font-bold text-lg">→</span>
            <div className="flex flex-col items-center gap-1.5 p-2 rounded-lg bg-white/60 border border-indigo-100">
              <Server className="w-4 h-4 text-indigo-500" />
              <span className="text-center">Pick a model</span>
            </div>
            <span className="text-indigo-300 font-bold text-lg">→</span>
            <div className="flex flex-col items-center gap-1.5 p-2 rounded-lg bg-white/60 border border-indigo-100">
              <FlaskConical className="w-4 h-4 text-indigo-500" />
              <span className="text-center">Run &amp; compare</span>
            </div>
          </div>
          <p className="text-xs text-gray-400 mt-2">
            Get set up in three steps below, then run your first experiment.
          </p>
        </div>
      </div>

      {/* Load built-in tools option */}
      {!hasTools && (
        <div className="bg-gradient-to-r from-indigo-50 to-purple-50 border border-indigo-100 rounded-xl p-4 mb-4 flex items-center gap-4">
          <div className="p-2 bg-indigo-100 rounded-lg shrink-0">
            <Sparkles className="w-5 h-5 text-indigo-600" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-indigo-900">Load built-in sample tools</p>
            <p className="text-xs text-indigo-600 mt-0.5">
              Get started quickly with 9 whimsical pre-made tools to experiment with.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => setShowPreview(true)}
              className="px-3 py-1.5 border border-indigo-200 text-indigo-700 rounded-lg text-sm font-medium hover:bg-indigo-50 transition-colors flex items-center gap-1.5"
            >
              <Eye className="w-3.5 h-3.5" />
              Preview
            </button>
            <button
              onClick={loadSamples}
              disabled={seeding}
              className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            >
              {seeding ? 'Loading…' : 'Load samples'}
            </button>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {steps.map((step, i) => (
          <div
            key={step.label}
            className={`flex items-start gap-4 rounded-xl border p-4 ${
              step.done ? 'border-gray-200 bg-gray-50' : 'border-gray-200 bg-white'
            }`}
          >
            <div
              className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-sm font-medium ${
                step.done ? 'bg-green-100 text-green-700' : 'bg-indigo-100 text-indigo-700'
              }`}
            >
              {step.done ? <Check className="w-4 h-4" /> : i + 1}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <step.icon className="w-4 h-4 text-gray-400" />
                <span className="font-medium text-gray-900">{step.label}</span>
              </div>
              <p className="text-sm text-gray-500 mt-0.5">{step.description}</p>
            </div>
            {!step.done && (
              <Link
                to={step.to}
                className="shrink-0 px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors"
              >
                {step.cta}
              </Link>
            )}
          </div>
        ))}
      </div>

      {/* Sample tools preview modal */}
      {showPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowPreview(false)}>
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full mx-4 max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
              <h2 className="font-semibold text-gray-900">Sample Fake Tools</h2>
              <button onClick={() => setShowPreview(false)} className="p-1 rounded-lg hover:bg-gray-100 transition-colors">
                <X className="w-4 h-4 text-gray-400" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-5 space-y-3">
              {sampleTools?.map(tool => (
                <ToolCard key={tool.name} tool={tool} />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function ToolCard({ tool }: { tool: SeedToolPreview }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className="border border-gray-200 rounded-lg p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-900">{tool.name}</p>
          <p className="text-xs text-gray-500 mt-0.5">{tool.description}</p>
        </div>
        <button
          onClick={() => setExpanded(e => !e)}
          className="shrink-0 text-xs text-indigo-600 hover:text-indigo-700 font-medium"
        >
          {expanded ? 'Collapse' : 'Schema'}
        </button>
      </div>
      {expanded && (
        <pre className="mt-2 bg-gray-50 rounded-lg p-2.5 text-xs text-gray-600 overflow-x-auto max-h-48">
          {JSON.stringify(tool.parameter_schema, null, 2)}
        </pre>
      )}
    </div>
  )
}
