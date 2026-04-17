import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const DEV_SESSION = import.meta.env.VITE_DEV_SKIP_AUTH === 'true'
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
