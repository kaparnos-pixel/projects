import { Navigate, Route, Routes } from 'react-router-dom'
import RequireAuth from './auth/RequireAuth'
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
        <Route path="vendor" element={<VendorOverview />} />
        <Route path="vendor/marketplace" element={<Marketplace />} />
        <Route path="vendor/offers" element={<Offers />} />
        <Route path="vendor/da" element={<DATracking />} />
        <Route path="vendor/sof" element={<SOF />} />
        <Route path="subscription" element={<Subscription />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
