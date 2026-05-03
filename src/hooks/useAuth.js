import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

// VITE_DEV_SKIP_AUTH bypasses Supabase auth entirely. It's intended only for
// local dev. Two guards make sure it never silently activates in production:
//   1. import.meta.env.DEV must be true (Vite sets this only for `vite dev`)
//   2. The hostname must be localhost / 127.0.0.1 / *.local
// Without both, the flag is ignored and a console warning is logged.
function isDevAuthBypassAllowed() {
  if (import.meta.env.VITE_DEV_SKIP_AUTH !== 'true') return false
  if (!import.meta.env.DEV) {
    console.error('[useAuth] VITE_DEV_SKIP_AUTH ignored — not a dev build')
    return false
  }
  const host = typeof window !== 'undefined' ? window.location.hostname : ''
  const isLocal = host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local')
  if (!isLocal) {
    console.error(`[useAuth] VITE_DEV_SKIP_AUTH ignored — host "${host}" is not local`)
    return false
  }
  console.warn('[useAuth] VITE_DEV_SKIP_AUTH active — auth is bypassed in dev')
  return true
}

const DEV_SESSION = isDevAuthBypassAllowed()
  ? { user: { id: 'dev', email: 'dev@local' } }
  : null

export function useAuth() {
  const [session, setSession] = useState(DEV_SESSION ?? undefined) // undefined = loading

  useEffect(() => {
    if (DEV_SESSION) return // skip Supabase in dev bypass mode

    let settled = false
    const finish = (s) => { settled = true; setSession(s) }

    supabase.auth.getSession()
      .then(({ data }) => finish(data.session ?? null))
      .catch(err => {
        console.error('[useAuth] getSession failed:', err)
        finish(null)
      })

    // Fallback: if Supabase never responds, fall through to Login
    // instead of hanging on the loading splash forever.
    const timeout = setTimeout(() => {
      if (!settled) {
        console.warn('[useAuth] getSession timeout — showing Login')
        finish(null)
      }
    }, 5000)

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session ?? null)
    })
    return () => {
      clearTimeout(timeout)
      subscription.unsubscribe()
    }
  }, [])

  return { session, loading: session === undefined }
}
