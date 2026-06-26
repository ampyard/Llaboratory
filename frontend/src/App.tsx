import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout'
import ToolLibrary from './pages/ToolLibrary'
import ToolDetail from './pages/ToolDetail'
import ToolBuilder from './pages/ToolBuilder'
import ModelConfigs from './pages/ModelConfigs'
import Plans from './pages/Plans'
import PlanBuilder from './pages/PlanBuilder'
import PlanReport from './pages/PlanReport'
import PlanStats from './pages/PlanStats'
import PlanVersions from './pages/PlanVersions'
import Sessions from './pages/Sessions'
import SessionDetail from './pages/SessionDetail'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Navigate to="/tools" replace />} />
          <Route path="tools" element={<ToolLibrary />} />
          <Route path="tools/new" element={<ToolBuilder />} />
          <Route path="tools/:toolId" element={<ToolDetail />} />
          <Route path="tools/:toolId/edit" element={<ToolBuilder />} />
          <Route path="models" element={<ModelConfigs />} />
          <Route path="plans" element={<Plans />} />
          <Route path="plans/new" element={<PlanBuilder />} />
          <Route path="plans/:planId" element={<PlanBuilder />} />
          <Route path="plans/:planId/stats" element={<PlanStats />} />
          <Route path="plans/:planId/report" element={<PlanReport />} />
          <Route path="plans/:planId/versions" element={<PlanVersions />} />
          <Route path="sessions" element={<Sessions />} />
          <Route path="sessions/:sessionId" element={<SessionDetail />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
