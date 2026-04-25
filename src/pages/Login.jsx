import { useState } from 'react'
import { supabase } from '../lib/supabase'

export default function Login() {
  const [mode, setMode]             = useState('signin') // 'signin' | 'signup'
  const [email, setEmail]           = useState('')
  const [password, setPassword]     = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [farmName, setFarmName]     = useState('')
  const [loading, setLoading]       = useState(false)
  const [error, setError]           = useState(null)
  const [success, setSuccess]       = useState(null)

  function withTimeout(promise, ms = 15000) {
    return Promise.race([
      promise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), ms)
      ),
    ])
  }

  function friendlyError(e, fallback) {
    if (e?.message === 'timeout') return "Can't reach the server. Please try again."
    if (e?.message === 'Failed to fetch') return "Can't reach the server. Check your connection and try again."
    return e?.message ?? fallback
  }

  async function handleLogin(e) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const { error } = await withTimeout(
        supabase.auth.signInWithPassword({ email, password })
      )
      if (error) setError(error.message)
    } catch (err) {
      setError(friendlyError(err, 'Sign in failed.'))
    } finally {
      setLoading(false)
    }
  }

  async function handleSignUp(e) {
    e.preventDefault()
    setError(null)
    setSuccess(null)

    if (!farmName.trim()) { setError('Please enter your farm name.'); return }
    if (password !== confirmPassword) { setError('Passwords do not match.'); return }
    if (password.length < 6) { setError('Password must be at least 6 characters.'); return }

    setLoading(true)
    try {
      const { data, error: signUpError } = await withTimeout(
        supabase.auth.signUp({
          email,
          password,
          options: {
            data: { farm_name: farmName.trim() },
          },
        })
      )

      if (signUpError) {
        setError(signUpError.message)
        return
      }

      // If signup succeeded and we have a session, also create the farm record
      if (data?.user) {
        await withTimeout(
          supabase.from('farms').insert({
            name: farmName.trim(),
            owner_id: data.user.id,
          })
        )
      }

      setSuccess('Account created! Check your email to confirm, then sign in.')
      setMode('signin')
      setPassword('')
      setConfirmPassword('')
      setFarmName('')
    } catch (err) {
      setError(friendlyError(err, 'Sign up failed. Please try again.'))
    } finally {
      setLoading(false)
    }
  }

  const isSignUp = mode === 'signup'

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
            {isSignUp ? 'Create account' : 'Sign in'}
          </h1>
          <p className="text-sm font-body text-[#40493d] mb-6">
            {isSignUp ? 'Register your farm to get started' : 'Enter your farm account details'}
          </p>

          {success && (
            <p className="text-xs text-[#0d631b] bg-[#0d631b]/10 rounded-lg px-3 py-2 font-body mb-4">{success}</p>
          )}

          <form onSubmit={isSignUp ? handleSignUp : handleLogin} className="space-y-4">
            {isSignUp && (
              <div>
                <label className="text-xs font-body text-[#40493d] block mb-1">Farm Name</label>
                <input
                  type="text"
                  value={farmName}
                  onChange={e => setFarmName(e.target.value)}
                  required
                  className="w-full bg-[#f3f3f3] rounded-lg px-4 py-3 text-sm font-body text-[#1a1c1c] outline-none focus:bg-white focus:ring-2 focus:ring-[#0d631b]/20 transition-all border border-transparent focus:border-[#0d631b]/30"
                  placeholder="e.g. Mildura Block A"
                />
              </div>
            )}

            <div>
              <label className="text-xs font-body text-[#40493d] block mb-1">Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                className="w-full bg-[#f3f3f3] rounded-lg px-4 py-3 text-sm font-body text-[#1a1c1c] outline-none focus:bg-white focus:ring-2 focus:ring-[#0d631b]/20 transition-all border border-transparent focus:border-[#0d631b]/30"
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
                className="w-full bg-[#f3f3f3] rounded-lg px-4 py-3 text-sm font-body text-[#1a1c1c] outline-none focus:bg-white focus:ring-2 focus:ring-[#0d631b]/20 transition-all border border-transparent focus:border-[#0d631b]/30"
                placeholder="••••••••"
              />
            </div>

            {isSignUp && (
              <div>
                <label className="text-xs font-body text-[#40493d] block mb-1">Confirm Password</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  required
                  className="w-full bg-[#f3f3f3] rounded-lg px-4 py-3 text-sm font-body text-[#1a1c1c] outline-none focus:bg-white focus:ring-2 focus:ring-[#0d631b]/20 transition-all border border-transparent focus:border-[#0d631b]/30"
                  placeholder="••••••••"
                />
              </div>
            )}

            {error && (
              <p className="text-xs text-[#ba1a1a] bg-[#ffdad6] rounded-lg px-3 py-2 font-body">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full gradient-primary text-white font-body font-semibold py-3 rounded-xl shadow-fab hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {loading ? (isSignUp ? 'Creating account…' : 'Signing in…') : (isSignUp ? 'Create Account' : 'Sign In')}
            </button>
          </form>

          <div className="mt-5 pt-4 border-t border-[#f3f3f3] text-center">
            {isSignUp ? (
              <p className="text-xs font-body text-[#40493d]">
                Already have an account?{' '}
                <button
                  onClick={() => { setMode('signin'); setError(null); setSuccess(null) }}
                  className="text-[#0d631b] font-semibold hover:underline"
                >
                  Sign in
                </button>
              </p>
            ) : (
              <p className="text-xs font-body text-[#40493d]">
                New farm?{' '}
                <button
                  onClick={() => { setMode('signup'); setError(null); setSuccess(null) }}
                  className="text-[#0d631b] font-semibold hover:underline"
                >
                  Create an account
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
