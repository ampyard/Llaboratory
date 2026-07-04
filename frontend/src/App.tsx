import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import ToolLibrary from './pages/ToolLibrary'
import ToolDetail from './pages/ToolDetail'
import ToolBuilder from './pages/ToolBuilder'
import ModelConfigs from './pages/ModelConfigs'
import Plans from './pages/Plans'
import PlanBuilder from './pages/PlanBuilder'
import PlanReport from './pages/PlanReport'
import PlanStats from './pages/PlanStats'
import PlanVersions from './pages/PlanVersions'
import ToolStats from './pages/ToolStats'
import Sessions from './pages/Sessions'
import SessionDetail from './pages/SessionDetail'
import Batches from './pages/Batches'
import BatchDetail from './pages/BatchDetail'
import DataTransfer from './pages/DataTransfer'
import FactoryReset from './pages/FactoryReset'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="tools" element={<ToolLibrary />} />
          <Route path="tools/new" element={<ToolBuilder />} />
          <Route path="tools/:toolId" element={<ToolDetail />} />
          <Route path="tools/:toolId/stats" element={<ToolStats />} />
          <Route path="tools/:toolId/edit" element={<ToolBuilder />} />
          <Route path="models" element={<ModelConfigs />} />
          <Route path="plans" element={<Plans />} />
          <Route path="plans/new" element={<PlanBuilder />} />
          <Route path="plans/:planId" element={<PlanBuilder />} />
          <Route path="plans/:planId/stats" element={<PlanStats />} />
          <Route path="plans/:planId/report" element={<PlanReport />} />
          <Route path="plans/:planId/versions" element={<PlanVersions />} />
          <Route path="plans/:planId/runs/:batchId" element={<BatchDetail />} />
          <Route path="sessions" element={<Sessions />} />
          <Route path="sessions/:sessionId" element={<SessionDetail />} />
          <Route path="batches" element={<Batches />} />
          <Route path="data-transfer" element={<DataTransfer />} />
          <Route path="factory-reset" element={<FactoryReset />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
