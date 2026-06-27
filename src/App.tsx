import { Navigate, Route, Routes } from 'react-router-dom'
import RequireAuth from './auth/RequireAuth'
import RequireOwner from './auth/RequireOwner'
import Layout from './components/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Voyages from './pages/Voyages'
import Voyage from './pages/Voyage'
import SubAgents from './pages/SubAgents'
import Principals from './pages/Principals'
import Inbox from './pages/Inbox'
import Repository from './pages/Repository'
import Audit from './pages/Audit'
import Contracts from './pages/Contracts'
import Services from './pages/Services'
import Users from './pages/Users'

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
        <Route path="voyages" element={<Voyages />} />
        <Route path="voyages/:id" element={<Voyage />} />
        <Route path="sub-agents" element={<SubAgents />} />
        <Route path="principals" element={<Principals />} />
        <Route path="inbox" element={<Inbox />} />
        <Route path="repository" element={<Repository />} />
        <Route path="audit" element={<Audit />} />
        <Route path="contracts" element={<Contracts />} />
        <Route path="services" element={<Services />} />
        <Route path="admin/users" element={<RequireOwner><Users /></RequireOwner>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
