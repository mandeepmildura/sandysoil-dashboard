import { NavLink } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useLiveTelemetry } from '../hooks/useLiveTelemetry'
import { useAlerts } from '../hooks/useAlerts'
import { useLatestSupplyPsi } from '../hooks/useLatestSupplyPsi'
import { KCS_DEVICES } from '../config/devices'
import { isAdmin } from '../lib/role'

const mainNav = [
  { to: '/',         label: 'Dashboard', icon: DashIcon },
  { to: '/zones',    label: 'Zones',     icon: LayersIcon },
  { to: '/calendar', label: 'Schedule',  icon: CalIcon },
  { to: '/pressure', label: 'Pressure',  icon: SpeedIcon },
]

const alertsNav = { to: '/alerts', label: 'Alerts', icon: BellIcon, badge: true }
const adminNav  = { to: '/admin',  label: 'Admin',  icon: SettingsIcon }

export default function Sidebar({ session }) {
  const admin = isAdmin(session)
  const { data } = useLiveTelemetry(['farm/irrigation1/status'])
  const irr = data['farm/irrigation1/status'] ?? {}
  const online = irr.online ?? false

  const { alerts } = useAlerts()
  const unreadCount = alerts.filter(a => !a.acknowledged).length

  const { psi: dbPsi } = useLatestSupplyPsi()

  const mqttPsi = irr.supply_psi
  const supplyPsi = (mqttPsi != null && mqttPsi > 0) ? mqttPsi : dbPsi ?? mqttPsi ?? '—'

  const userEmail = session?.user?.email ?? 'User'
  const initials = userEmail.split('@')[0].slice(0, 2).toUpperCase()

  return (
    <aside className="hidden md:flex sticky top-0 h-screen w-64 bg-[#485860] flex-col shrink-0 shadow-2xl">
      {/* Title */}
      <div className="px-6 py-8">
        <h1 className="font-headline font-bold text-xl text-white tracking-tight leading-tight">Sandy Soil</h1>
        <p className="text-white/50 text-xs mt-0.5">Automations</p>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-2 space-y-1 overflow-y-auto">
        {mainNav.map(item => <NavItem key={item.to} {...item} />)}

        {/* Devices group — admin only */}
        {admin && (
          <div className="pt-4">
            <p className="px-4 pb-1 ml-2 mr-4 text-[10px] uppercase tracking-widest text-white/40 font-bold">Devices</p>
            {KCS_DEVICES.map(d => (
              <NavItem key={d.path} to={d.path} label={d.name} icon={RelayIcon} />
            ))}
          </div>
        )}

        <div className="pt-4">
          <NavItem {...alertsNav} badgeCount={unreadCount} />
          {admin && <NavItem {...adminNav} />}
        </div>
      </nav>

      {/* Live supply pressure chip */}
      <div className="px-4 mb-2">
        <div className="bg-white/5 rounded-xl px-4 py-3">
          <p className="text-white/40 text-[10px] uppercase tracking-widest font-bold mb-1">Supply Pressure</p>
          <div className="flex items-center gap-2">
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${online ? 'bg-[#4caf50] animate-pulse' : 'bg-white/20'}`} />
            <span className="font-headline font-bold text-white text-lg leading-none">{supplyPsi}</span>
            {supplyPsi !== '—' && <span className="text-white/50 text-xs">PSI</span>}
          </div>
        </div>
      </div>

      {/* User footer */}
      <div className="px-4 pb-4">
        <div className="bg-white/5 rounded-xl p-3 flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-[#0d631b] flex items-center justify-center text-white font-headline font-bold text-xs shrink-0">
            {initials}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold text-white truncate leading-tight">{userEmail}</p>
            <button
              onClick={() => supabase.auth.signOut()}
              className="text-white/40 hover:text-white/70 text-[11px] font-body transition-colors"
            >
              Sign out
            </button>
          </div>
        </div>
      </div>
    </aside>
  )
}

function NavItem({ to, label, icon: Icon, badgeCount = 0 }) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      className={({ isActive }) =>
        `flex items-center gap-3 py-3 px-4 ml-2 mr-4 rounded-lg text-sm transition-all ${
          isActive
            ? 'bg-white/10 text-white font-bold scale-95'
            : 'text-slate-300 hover:text-white hover:bg-white/5 font-body font-medium'
        }`
      }
    >
      <Icon />
      <span className="flex-1">{label}</span>
      {badgeCount > 0 && (
        <span className="bg-red-500 text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center shrink-0">
          {badgeCount > 9 ? '9+' : badgeCount}
        </span>
      )}
    </NavLink>
  )
}

// Icons — outlined stroke style, 20px
const iconProps = { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' }

function DashIcon() {
  return (
    <svg {...iconProps}>
      <rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/>
      <rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>
    </svg>
  )
}
function LayersIcon() {
  return (
    <svg {...iconProps}>
      <path d="M12 2l9 5-9 5-9-5 9-5zM3 12l9 5 9-5M3 17l9 5 9-5"/>
    </svg>
  )
}
function CalIcon() {
  return (
    <svg {...iconProps}>
      <rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>
    </svg>
  )
}
function SpeedIcon() {
  return (
    <svg {...iconProps}>
      <path d="M12 3a9 9 0 10.001 0zM12 12l4-4"/>
      <circle cx="12" cy="12" r="1" fill="currentColor"/>
    </svg>
  )
}
function BellIcon() {
  return (
    <svg {...iconProps}>
      <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0"/>
    </svg>
  )
}
function RelayIcon() {
  return (
    <svg {...iconProps}>
      <rect x="2" y="7" width="20" height="10" rx="2"/>
      <circle cx="8" cy="12" r="1.5" fill="currentColor"/>
      <circle cx="16" cy="12" r="1.5" fill="currentColor"/>
      <path d="M8 12h8"/>
    </svg>
  )
}
function SettingsIcon() {
  return (
    <svg {...iconProps}>
      <circle cx="12" cy="12" r="3"/>
      <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09a1.65 1.65 0 001.51-1 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>
    </svg>
  )
}
