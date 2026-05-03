import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'

export default function Account() {
  const { session } = useAuth()
  const email = session?.user?.email ?? ''

  const [password, setPassword]   = useState('')
  const [confirm, setConfirm]     = useState('')
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState(null)
  const [success, setSuccess]     = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    setSuccess(null)
    if (password !== confirm) { setError('Passwords do not match.'); return }
    if (password.length < 6)  { setError('Password must be at least 6 characters.'); return }
    setLoading(true)
    try {
      const { error } = await supabase.auth.updateUser({ password })
      if (error) setError(error.message)
      else {
        setSuccess('Password updated.')
        setPassword('')
        setConfirm('')
      }
    } catch (err) {
      setError(err?.message ?? 'Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="p-4 md:p-8 max-w-lg">
      <h1 className="font-headline font-bold text-2xl text-[#1a1c1c] mb-1">Account</h1>
      <p className="text-sm font-body text-[#40493d] mb-8">Manage your sign-in details.</p>

      {/* Email (read-only) */}
      <div className="bg-white rounded-xl shadow-card p-6 mb-4">
        <h2 className="font-headline font-semibold text-base text-[#1a1c1c] mb-4">Email address</h2>
        <div className="bg-[#f3f3f3] rounded-lg px-4 py-3 text-sm font-body text-[#40493d] select-all">
          {email}
        </div>
      </div>

      {/* Change password */}
      <div className="bg-white rounded-xl shadow-card p-6">
        <h2 className="font-headline font-semibold text-base text-[#1a1c1c] mb-4">Change password</h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-xs font-body text-[#40493d] block mb-1">New Password</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              className="w-full bg-[#f3f3f3] rounded-lg px-4 py-3 text-sm font-body text-[#1a1c1c] outline-none focus:bg-white focus:ring-2 focus:ring-[#0d631b]/20 transition-all border border-transparent focus:border-[#0d631b]/30"
              placeholder="••••••••"
            />
          </div>

          <div>
            <label className="text-xs font-body text-[#40493d] block mb-1">Confirm Password</label>
            <input
              type="password"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              required
              className="w-full bg-[#f3f3f3] rounded-lg px-4 py-3 text-sm font-body text-[#1a1c1c] outline-none focus:bg-white focus:ring-2 focus:ring-[#0d631b]/20 transition-all border border-transparent focus:border-[#0d631b]/30"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <p className="text-xs text-[#ba1a1a] bg-[#ffdad6] rounded-lg px-3 py-2 font-body">{error}</p>
          )}
          {success && (
            <p className="text-xs text-[#0d631b] bg-[#0d631b]/10 rounded-lg px-3 py-2 font-body">{success}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="gradient-primary text-white font-body font-semibold px-6 py-3 rounded-xl shadow-fab hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {loading ? 'Updating…' : 'Update Password'}
          </button>
        </form>
      </div>
    </div>
  )
}
