import { useState } from 'react'
import { supabase } from '../lib/supabase'

export default function Login() {
  const [mode, setMode]         = useState('signin') // 'signin' | 'signup'
  const [name, setName]         = useState('')
  const [farmName, setFarmName] = useState('')
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState(null)
  const [signedUp, setSignedUp] = useState(false)

  async function handleSignIn(e) {
    e.preventDefault()
    setLoading(true); setError(null)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setError(error.message)
    setLoading(false)
  }

  async function handleSignUp(e) {
    e.preventDefault()
    if (!name.trim())     { setError('Enter your name'); return }
    if (!farmName.trim()) { setError('Enter your farm name'); return }
    setLoading(true); setError(null)

    const { data, error: signUpErr } = await supabase.auth.signUp({ email, password })
    if (signUpErr) { setError(signUpErr.message); setLoading(false); return }

    // Upsert profile with name + farm name
    if (data.user) {
      await supabase.from('profiles').upsert({
        id:        data.user.id,
        email:     email.trim(),
        name:      name.trim(),
        farm_name: farmName.trim(),
        is_admin:  false,
      })
    }

    setSignedUp(true)
    setLoading(false)
  }

  if (signedUp) {
    return (
      <div className="min-h-screen bg-[#f9f9f9] flex items-center justify-center p-4">
        <div className="w-full max-w-sm bg-[#ffffff] rounded-xl shadow-card p-7 text-center">
          <div className="w-12 h-12 rounded-full bg-[#0d631b]/10 flex items-center justify-center mx-auto mb-4">
            <span className="text-[#0d631b] text-xl font-bold">✓</span>
          </div>
          <h2 className="font-headline font-bold text-lg text-[#1a1c1c] mb-2">Account Created</h2>
          <p className="text-sm text-[#40493d] font-body mb-4">
            Check your email to confirm your account, then sign in.
          </p>
          <button onClick={() => { setMode('signin'); setSignedUp(false) }}
            className="w-full gradient-primary text-white font-body font-semibold py-3 rounded-xl shadow-fab hover:opacity-90 transition-opacity">
            Back to Sign In
          </button>
        </div>
      </div>
    )
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
          <h1 className="font-headline font-bold text-xl text-[#1a1c1c] mb-1">
            {mode === 'signin' ? 'Sign in' : 'Create account'}
          </h1>
          <p className="text-sm font-body text-[#40493d] mb-6">
            {mode === 'signin' ? 'Enter your farm account details' : 'Set up your farm account'}
          </p>

          <form onSubmit={mode === 'signin' ? handleSignIn : handleSignUp} className="space-y-4">
            {mode === 'signup' && (
              <>
                <div>
                  <label className="text-xs font-body text-[#40493d] block mb-1">Your Name</label>
                  <input type="text" value={name} onChange={e => setName(e.target.value)} required
                    placeholder="e.g. John Smith"
                    className="w-full bg-[#f3f3f3] rounded-lg px-4 py-3 text-sm font-body text-[#1a1c1c] outline-none focus:bg-white focus:ring-2 focus:ring-[#0d631b]/20 transition-all" />
                </div>
                <div>
                  <label className="text-xs font-body text-[#40493d] block mb-1">Farm Name</label>
                  <input type="text" value={farmName} onChange={e => setFarmName(e.target.value)} required
                    placeholder="e.g. Gill Farms Mildura"
                    className="w-full bg-[#f3f3f3] rounded-lg px-4 py-3 text-sm font-body text-[#1a1c1c] outline-none focus:bg-white focus:ring-2 focus:ring-[#0d631b]/20 transition-all" />
                </div>
              </>
            )}

            <div>
              <label className="text-xs font-body text-[#40493d] block mb-1">Email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} required
                placeholder="you@example.com"
                className="w-full bg-[#f3f3f3] rounded-lg px-4 py-3 text-sm font-body text-[#1a1c1c] outline-none focus:bg-white focus:ring-2 focus:ring-[#0d631b]/20 transition-all" />
            </div>
            <div>
              <label className="text-xs font-body text-[#40493d] block mb-1">Password</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} required
                placeholder="••••••••"
                className="w-full bg-[#f3f3f3] rounded-lg px-4 py-3 text-sm font-body text-[#1a1c1c] outline-none focus:bg-white focus:ring-2 focus:ring-[#0d631b]/20 transition-all" />
            </div>

            {error && (
              <p className="text-xs text-[#ba1a1a] bg-[#ffdad6] rounded-lg px-3 py-2 font-body">{error}</p>
            )}

            <button type="submit" disabled={loading}
              className="w-full gradient-primary text-white font-body font-semibold py-3 rounded-xl shadow-fab hover:opacity-90 transition-opacity disabled:opacity-50">
              {loading ? (mode === 'signin' ? 'Signing in…' : 'Creating account…') : (mode === 'signin' ? 'Sign In' : 'Create Account')}
            </button>
          </form>

          <div className="mt-5 text-center">
            {mode === 'signin' ? (
              <p className="text-xs font-body text-[#40493d]">
                New farm?{' '}
                <button onClick={() => { setMode('signup'); setError(null) }}
                  className="text-[#0d631b] font-semibold hover:underline">
                  Create an account
                </button>
              </p>
            ) : (
              <p className="text-xs font-body text-[#40493d]">
                Already have an account?{' '}
                <button onClick={() => { setMode('signin'); setError(null) }}
                  className="text-[#0d631b] font-semibold hover:underline">
                  Sign in
                </button>
              </p>
            )}
          </div>
        </div>

        <p className="text-center text-xs text-[#40493d] font-body mt-6">
          Sandy Soil Automations · Mildura, VIC
        </p>
      </div>
    </div>
  )
}
