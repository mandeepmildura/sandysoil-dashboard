/**
 * Single source of truth for "is this user an admin?".
 *
 * Today: hard-coded admin email. Easy to swap to a DB-backed role later
 * (e.g. profiles.is_admin) without touching every callsite.
 */
export const ADMIN_EMAILS = ['mandeep@freshoz.com']

export function isAdmin(session) {
  const email = session?.user?.email
  if (!email) return false
  return ADMIN_EMAILS.includes(email.toLowerCase())
}
