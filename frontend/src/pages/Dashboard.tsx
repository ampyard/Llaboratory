import { useQuery } from '@tanstack/react-query'
import { Navigate, Link } from 'react-router-dom'
import { Check, Wrench, Server, FlaskConical } from 'lucide-react'
import { api } from '../api/client'

export default function Dashboard() {
  const { data: tools, isLoading: toolsLoading } = useQuery({ queryKey: ['tools'], queryFn: api.tools.list })
  const { data: modelConfigs, isLoading: modelsLoading } = useQuery({ queryKey: ['modelConfigs'], queryFn: api.modelConfigs.list })
  const { data: plans, isLoading: plansLoading } = useQuery({ queryKey: ['plans'], queryFn: api.plans.list })

  if (plansLoading || toolsLoading || modelsLoading) return null

  if (plans && plans.length > 0) return <Navigate to="/tools" replace />

  const steps = [
    {
      label: 'Create a tool',
      description: 'Define a fake tool your model will be able to call during a session.',
      done: !!tools && tools.length > 0,
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
        <h1 className="text-xl font-semibold">Welcome to Llaboratory</h1>
        <p className="text-sm text-gray-500 mt-0.5">Get set up in three steps, then run your first plan.</p>
      </div>

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
    </div>
  )
}
