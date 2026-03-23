import { useState } from 'react'
import { supabase } from '../lib/supabase'

export default function Login() {
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState(null)

  async function handleLogin(e) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setError(error.message)
    setLoading(false)
  }

  return (
    <div className="min-h-screen bg-[#f9f9f9] flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex items-center gap-3 mb-8 justify-center">
          <div className="w-10 h-10 rounded-xl gradient-primary flex items-center justify-center shadow-fab">
            <span className="text-white font-headline font-bold text-sm">SS</span>
          </div>
          <div>
            <p className="font-headline font-bold text-[#1a1c1c] text-lg leading-tight">Sandy Soil</p>
            <p className="text-[#40493d] text-xs font-body">Automations — Mildura</p>
          </div>
        </div>

        <div className="bg-[#ffffff] rounded-xl shadow-card p-7">
          <h1 className="font-headline font-bold text-xl text-[#1a1c1c] mb-1">Sign in</h1>
          <p className="text-sm font-body text-[#40493d] mb-6">Enter your farm account details</p>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="text-xs font-body text-[#40493d] block mb-1">Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                className="w-full bg-[#f3f3f3] rounded-lg px-4 py-3 text-sm font-body text-[#1a1c1c] outline-none focus:bg-white focus:ring-2 focus:ring-[#0d631b]/20 transition-all"
                placeholder="you@example.com"
              />
            </div>
            <div>
              <label className="text-xs font-body text-[#40493d] block mb-1">Password</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                className="w-full bg-[#f3f3f3] rounded-lg px-4 py-3 text-sm font-body text-[#1a1c1c] outline-none focus:bg-white focus:ring-2 focus:ring-[#0d631b]/20 transition-all"
                placeholder="••••••••"
              />
            </div>

            {error && (
              <p className="text-xs text-[#ba1a1a] bg-[#ffdad6] rounded-lg px-3 py-2 font-body">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full gradient-primary text-white font-body font-semibold py-3 rounded-xl shadow-fab hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {loading ? 'Signing in…' : 'Sign In'}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-[#40493d] font-body mt-6">
          Sandy Soil Automations · Mildura, VIC
        </p>
      </div>
    </div>
  )
}
