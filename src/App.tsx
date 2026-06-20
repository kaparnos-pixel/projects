import { Navigate, Route, Routes } from 'react-router-dom'
import RequireAuth from './auth/RequireAuth'
import RequireTier from './auth/RequireTier'
import RequireOwner from './auth/RequireOwner'
import Users from './pages/Users'
import Layout from './components/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Discovery from './pages/Discovery'
import Onboarding from './pages/Onboarding'
import Chat from './pages/Chat'
import Contracts from './pages/Contracts'
import PortCalls from './pages/PortCalls'
import Audit from './pages/Audit'
import Subscription from './pages/Subscription'
import VendorOverview from './pages/vendor/VendorOverview'
import Marketplace from './pages/vendor/Marketplace'
import Offers from './pages/vendor/Offers'
import DATracking from './pages/vendor/DATracking'
import SOF from './pages/vendor/SOF'
import PCM from './pages/finance/PCM'
import Purser from './pages/finance/Purser'

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="discovery" element={<Discovery />} />
        <Route path="onboarding" element={<Onboarding />} />
        <Route path="chat" element={<Chat />} />
        <Route path="contracts" element={<Contracts />} />
        <Route path="port-calls" element={<PortCalls />} />
        <Route path="audit" element={<Audit />} />
        <Route path="vendor" element={<RequireTier feature="vendor-dock"><VendorOverview /></RequireTier>} />
        <Route path="vendor/marketplace" element={<RequireTier feature="vendor-dock"><Marketplace /></RequireTier>} />
        <Route path="vendor/offers" element={<RequireTier feature="vendor-dock"><Offers /></RequireTier>} />
        <Route path="vendor/da" element={<RequireTier feature="vendor-dock"><DATracking /></RequireTier>} />
        <Route path="vendor/sof" element={<RequireTier feature="vendor-dock"><SOF /></RequireTier>} />
        <Route path="pcm" element={<RequireTier feature="pcm"><PCM /></RequireTier>} />
        <Route path="purser" element={<RequireTier feature="purser"><Purser /></RequireTier>} />
        <Route path="subscription" element={<Subscription />} />
        <Route path="admin/users" element={<RequireOwner><Users /></RequireOwner>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
