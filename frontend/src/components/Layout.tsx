import { Outlet, NavLink } from 'react-router-dom'
import { Wrench, Server, FlaskConical, Play } from 'lucide-react'

const nav = [
  { to: '/tools', label: 'Tool Library', icon: Wrench },
  { to: '/models', label: 'Model Configs', icon: Server },
  { to: '/plans', label: 'Plans', icon: FlaskConical },
  { to: '/sessions', label: 'Sessions', icon: Play },
]

export default function Layout() {
  return (
    <div className="min-h-screen flex">
      {/* Sidebar */}
      <aside className="w-56 bg-white border-r border-gray-200 flex flex-col shrink-0">
        <div className="px-4 py-3 border-b border-gray-200 flex items-center gap-2.5">
          <img src="/logo-small.png" alt="Llaboratory" className="h-10 w-auto shrink-0" />
          <span className="font-bold text-gray-900 text-base tracking-tight">Llaboratory</span>
        </div>
        <nav className="flex-1 p-3 space-y-0.5">
          {nav.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-indigo-50 text-indigo-700'
                    : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                }`
              }
            >
              <Icon className="w-4 h-4 shrink-0" />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="px-4 py-3 border-t border-gray-200">
          <p className="text-xs text-gray-400">MVP v0.2.0</p>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  )
}
