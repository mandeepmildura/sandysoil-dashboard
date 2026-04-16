import { useState, useEffect } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useAlerts } from '../hooks/useAlerts'
import { KCS_DEVICES } from '../config/devices'

const primary = [
  { to: '/', label: 'Home', icon: <GridIcon /> },
  ...KCS_DEVICES.map(d => ({ to: d.path, label: d.navLabel, icon: <RelayIcon /> })),
  { to: '/alerts', label: 'Alerts', icon: <BellIcon />, badge: true },
]

const overflow = [
  { to: '/admin', label: 'Admin', icon: <AdminIcon /> },
]

export default function BottomNav() {
  const { alerts } = useAlerts()
  const unreadCount = alerts.filter(a => !a.acknowledged).length
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()

  const [clock, setClock] = useState('')
  useEffect(() => {
    function tick() {
      setClock(new Date().toLocaleTimeString('en-AU', {
        timeZone: 'Australia/Melbourne',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
      }))
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [])

  function goTo(to) {
    setOpen(false)
    navigate(to)
  }

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div
          className="md:hidden fixed inset-0 z-40 bg-black/40"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Slide-up "More" sheet */}
      <div className={`md:hidden fixed bottom-14 inset-x-0 z-50 bg-[#304047] rounded-t-2xl transition-transform duration-200 ${open ? 'translate-y-0' : 'translate-y-full'}`}>
        <div className="px-2 pt-3 pb-4">
          <div className="w-8 h-1 bg-white/20 rounded-full mx-auto mb-3" />
          {clock && (
            <p className="text-center text-white/50 text-xs font-mono mb-3">{clock}</p>
          )}
          <div className="grid grid-cols-3 gap-1">
            {overflow.map(({ to, label, icon, badge }) => (
              <button
                key={to}
                onClick={() => goTo(to)}
                className="flex flex-col items-center justify-center py-3 gap-1 text-[11px] font-body font-medium text-white/70 active:bg-white/10 rounded-xl transition-colors relative"
              >
                <span className="w-6 h-6 relative">
                  {icon}
                  {badge && unreadCount > 0 && (
                    <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[8px] font-bold rounded-full w-3.5 h-3.5 flex items-center justify-center">
                      {unreadCount > 9 ? '9+' : unreadCount}
                    </span>
                  )}
                </span>
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Bottom bar */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-50 bg-[#304047] border-t border-white/10 flex">
        {primary.map(({ to, label, icon, badge }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center justify-center py-2 gap-0.5 text-[10px] font-body font-medium transition-colors ${
                isActive ? 'text-white' : 'text-white/50'
              }`
            }
          >
            <span className="w-5 h-5 relative">
              {icon}
              {badge && unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[8px] font-bold rounded-full w-3.5 h-3.5 flex items-center justify-center">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </span>
            {label}
          </NavLink>
        ))}

        {/* More button */}
        <button
          onClick={() => setOpen(o => !o)}
          className={`flex-1 flex flex-col items-center justify-center py-2 gap-0.5 text-[10px] font-body font-medium transition-colors ${open ? 'text-white' : 'text-white/50'}`}
        >
          <span className="w-5 h-5">
            <MoreIcon />
          </span>
          More
        </button>
      </nav>
    </>
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
function RelayIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="7" width="20" height="10" rx="2"/>
      <circle cx="8" cy="12" r="1.5" fill="currentColor"/>
      <circle cx="16" cy="12" r="1.5" fill="currentColor"/>
      <path d="M8 12h8"/>
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
function HistoryIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3v5h5"/><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8"/>
      <path d="M12 7v5l4 2"/>
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
function RulesIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v1m0 16v1M4.22 4.22l.7.7m14.16 14.16.7.7M3 12h1m16 0h1M4.22 19.78l.7-.7M18.36 5.64l.7-.7"/>
      <circle cx="12" cy="12" r="4"/>
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
function MoreIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="5" cy="12" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="19" cy="12" r="1" fill="currentColor"/>
    </svg>
  )
}
