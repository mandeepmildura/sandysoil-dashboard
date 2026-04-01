import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const DEV_SESSION = import.meta.env.VITE_DEV_SKIP_AUTH === 'true'
  ? { user: { id: 'dev', email: 'dev@local' } }
  : null

export function useAuth() {
  const [session, setSession] = useState(DEV_SESSION ?? undefined) // undefined = loading

  useEffect(() => {
    if (DEV_SESSION) return // skip Supabase in dev bypass mode

    supabase.auth.getSession().then(({ data }) => setSession(data.session))

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
    })
    return () => subscription.unsubscribe()
  }, [])

  return { session, loading: session === undefined }
}
