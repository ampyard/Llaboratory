import { useQuery } from '@tanstack/react-query'
import { Outlet, NavLink } from 'react-router-dom'
import { LayoutDashboard, Wrench, Server, FlaskConical, Play, Layers, Download, RotateCcw } from 'lucide-react'
import { api } from '../api/client'
import pkg from '../../package.json'

const nav = [
  { to: '/tools', label: 'Tool Library', icon: Wrench },
  { to: '/models', label: 'Model Configs', icon: Server },
  { to: '/plans', label: 'Plans', icon: FlaskConical },
  { divider: true },
  { to: '/sessions', label: 'Sessions', icon: Play },
  { to: '/batches', label: 'Batch Runs', icon: Layers },
  { divider: true },
  { to: '/data-transfer', label: 'Export / Import', icon: Download },
  { to: '/factory-reset', label: 'Factory Reset', icon: RotateCcw },
] as const

export default function Layout() {
  const { data: plans } = useQuery({ queryKey: ['plans'], queryFn: api.plans.list, staleTime: 60_000 })
  const showOnboarding = !plans || plans.length === 0

  return (
    <div className="min-h-screen flex">
      {/* Sidebar */}
      <aside className="w-56 bg-white border-r border-gray-200 flex flex-col shrink-0">
        <div className="px-4 py-3 border-b border-gray-200 flex items-center gap-2.5">
          <img src="/logo-small.png" alt="Llaboratory" className="h-10 w-auto shrink-0" />
          <div className="flex items-baseline gap-1.5 min-w-0">
            <span className="font-bold text-gray-900 text-base tracking-tight truncate">Llaboratory</span>
            <span className="text-[11px] font-medium text-gray-400 shrink-0">v{pkg.version}</span>
          </div>
        </div>
        <nav className="flex-1 p-3 space-y-0.5">
          {showOnboarding && (
            <NavLink
              to="/"
              end
              className={({ isActive }) =>
                `flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-indigo-50 text-indigo-700'
                    : 'text-emerald-700 hover:bg-emerald-50 hover:text-emerald-800'
                }`
              }
            >
              <LayoutDashboard className="w-4 h-4 shrink-0" />
              Getting Started
            </NavLink>
          )}
          {nav.map((item, i) =>
            'divider' in item ? (
              <hr key={i} className="my-2 border-gray-200" />
            ) : (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-indigo-50 text-indigo-700'
                      : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                  }`
                }
              >
                <item.icon className="w-4 h-4 shrink-0" />
                {item.label}
              </NavLink>
            )
          )}
        </nav>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  )
}
