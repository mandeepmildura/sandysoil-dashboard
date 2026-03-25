import { Routes, Route, Navigate } from 'react-router-dom'
import Sidebar from './components/Sidebar'
import BottomNav from './components/BottomNav'
import Login          from './pages/Login'
import Dashboard      from './pages/Dashboard'
import Zones          from './pages/Zones'
import ZoneDetail     from './pages/ZoneDetail'
import Calendar       from './pages/Calendar'
import ScheduleRules  from './pages/ScheduleRules'
import Programs       from './pages/Programs'
import PressureAnalysis from './pages/PressureAnalysis'
import Alerts         from './pages/Alerts'
import AdminConsole   from './pages/AdminConsole'
import { useAuth }    from './hooks/useAuth'

export default function App() {
  const { session, loading } = useAuth()

  if (loading) {
    return (
      <div className="min-h-screen bg-[#f9f9f9] flex items-center justify-center">
        <div className="flex items-center gap-3">
          <div className="w-2 h-2 rounded-full bg-[#0d631b] animate-pulse" />
          <span className="text-sm font-body text-[#40493d]">Loading…</span>
        </div>
      </div>
    )
  }

  if (!session) {
    return <Login />
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar session={session} />
      <main className="flex-1 flex flex-col min-h-screen overflow-hidden pb-16 md:pb-0">
        <Routes>
          <Route path="/"           element={<Dashboard />} />
          <Route path="/zones"      element={<Zones />} />
          <Route path="/zones/:id"  element={<ZoneDetail />} />
          <Route path="/calendar"   element={<Calendar />} />
          <Route path="/rules"      element={<ScheduleRules />} />
          <Route path="/programs"   element={<Programs />} />
          <Route path="/pressure"   element={<PressureAnalysis />} />
          <Route path="/alerts"     element={<Alerts />} />
          <Route path="/admin"      element={<AdminConsole />} />
          <Route path="*"           element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <BottomNav />
    </div>
  )
}
