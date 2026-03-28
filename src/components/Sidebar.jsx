import { NavLink } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useLiveTelemetry } from '../hooks/useLiveTelemetry'

const nav = [
  { to: '/',         label: 'Dashboard',  icon: <GridIcon /> },
  { to: '/zones',    label: 'Zones',      icon: <DropIcon /> },
  { to: '/calendar', label: 'Schedule',   icon: <CalIcon /> },
  { to: '/programs', label: 'Programs',   icon: <ListIcon /> },
  { to: '/pressure', label: 'Pressure',   icon: <GaugeIcon /> },
  { to: '/alerts',   label: 'Alerts',     icon: <BellIcon />, badge: true },
  { to: '/admin',    label: 'Admin',      icon: <AdminIcon /> },
]

export default function Sidebar({ session }) {
  const { data } = useLiveTelemetry(['farm/irrigation1/status', 'farm/irrigation1/sim/pressure'])
  const irr = data['farm/irrigation1/status'] ?? {}
  const sim = data['farm/irrigation1/sim/pressure'] ?? {}
  // Show simulated PSI when sim is running, otherwise show real device PSI
  const supplyPsi = sim.supply_psi ?? irr.supply_psi ?? '—'
  const online = irr.online ?? false

  return (
    <aside className="hidden md:flex w-56 min-h-screen bg-[#304047] flex-col shrink-0">
      {/* Logo */}
      <div className="px-5 py-6 border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-md gradient-primary flex items-center justify-center">
            <span className="text-white text-xs font-headline font-bold">SS</span>
          </div>
          <div>
            <p className="font-headline font-bold text-white text-sm leading-tight">Sandy Soil</p>
            <p className="text-white/50 text-xs">Automations</p>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        {nav.map(({ to, label, icon, badge }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-body font-medium transition-colors relative ${
                isActive
                  ? 'bg-white/15 text-white'
                  : 'text-white/60 hover:bg-white/10 hover:text-white'
              }`
            }
          >
            <span className="w-5 h-5 shrink-0">{icon}</span>
            {label}
            {badge && (
              <span className="ml-auto bg-red-500 text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
                2
              </span>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Live supply pressure */}
      <div className="px-4 py-3 border-t border-white/10">
        <p className="text-white/40 text-[10px] uppercase tracking-wider mb-1">Supply Pressure</p>
        <div className="flex items-center gap-2">
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${online ? 'bg-[#4caf50] animate-pulse' : 'bg-white/20'}`} />
          <span className="font-headline font-bold text-white text-lg leading-none">{supplyPsi}</span>
          {supplyPsi !== '—' && <span className="text-white/50 text-xs">PSI</span>}
        </div>
      </div>

      {/* Footer */}
      <div className="px-4 py-4 border-t border-white/10 space-y-2">
        {session?.user?.email && (
          <p className="text-white/40 text-[10px] truncate">{session.user.email}</p>
        )}
        <p className="text-white/30 text-xs">Mildura, VIC</p>
        <button
          onClick={() => supabase.auth.signOut()}
          className="text-white/40 hover:text-white/70 text-xs font-body transition-colors"
        >
          Sign out
        </button>
      </div>
    </aside>
  )
}

function GridIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
      <rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
    </svg>
  )
}
function DropIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2C12 2 5 10 5 15a7 7 0 0014 0C19 10 12 2 12 2z"/>
    </svg>
  )
}
function CalIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>
    </svg>
  )
}
function ListIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>
    </svg>
  )
}
function GaugeIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2a10 10 0 100 20A10 10 0 0012 2z"/><path d="M12 12l4-4"/>
      <circle cx="12" cy="12" r="1" fill="currentColor"/>
    </svg>
  )
}
function BellIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0"/>
    </svg>
  )
}
function AdminIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
    </svg>
  )
}
