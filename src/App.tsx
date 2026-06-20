import { Navigate, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import Discovery from './pages/Discovery'
import Onboarding from './pages/Onboarding'
import Chat from './pages/Chat'
import Contracts from './pages/Contracts'
import PortCalls from './pages/PortCalls'
import Audit from './pages/Audit'

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="discovery" element={<Discovery />} />
        <Route path="onboarding" element={<Onboarding />} />
        <Route path="chat" element={<Chat />} />
        <Route path="contracts" element={<Contracts />} />
        <Route path="port-calls" element={<PortCalls />} />
        <Route path="audit" element={<Audit />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
