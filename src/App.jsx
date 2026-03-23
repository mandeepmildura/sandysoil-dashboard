import { Routes, Route } from 'react-router-dom'
import Sidebar from './components/Sidebar'
import Dashboard      from './pages/Dashboard'
import Zones          from './pages/Zones'
import ZoneDetail     from './pages/ZoneDetail'
import Calendar       from './pages/Calendar'
import ScheduleRules  from './pages/ScheduleRules'
import Programs       from './pages/Programs'
import PressureAnalysis from './pages/PressureAnalysis'
import Alerts         from './pages/Alerts'
import AdminConsole   from './pages/AdminConsole'

export default function App() {
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 flex flex-col min-h-screen overflow-hidden">
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
        </Routes>
      </main>
    </div>
  )
}
