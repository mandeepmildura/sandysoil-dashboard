/**
 * Shared button classname constants — keeps the whole app on one visual system.
 * Usage: <button className={btnPrimary}>Save</button>
 */

export const btnPrimary =
  'px-5 py-2.5 rounded-full text-white text-sm font-bold shadow-lg shadow-[#17362e]/20 transition-transform active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed'

export const btnPrimaryStyle = {
  background: 'linear-gradient(135deg, #17362e 0%, #2e4d44 100%)',
}

export const btnSecondary =
  'px-5 py-2.5 rounded-full border border-[#c1c8c4] text-sm font-bold text-[#17362e] hover:bg-[#f2f4f3] transition-colors disabled:opacity-40 disabled:hover:bg-transparent'

export const btnGhost =
  'px-4 py-2 rounded-full text-xs font-bold text-[#17362e] hover:bg-[#f2f4f3] transition-colors disabled:opacity-30 disabled:hover:bg-transparent'

export const btnDanger =
  'px-5 py-2.5 rounded-full border border-[#ba1a1a]/30 text-[#ba1a1a] text-sm font-bold hover:bg-[#ba1a1a]/5 transition-colors disabled:opacity-40'

/** Pill-style tag used for status chips (live monitoring, active, etc.) */
export const pillEmerald =
  'flex items-center gap-2 px-3 py-1 bg-emerald-50 rounded-full'
export const pillEmeraldDot = 'w-2 h-2 rounded-full bg-emerald-500 animate-pulse'
export const pillEmeraldText =
  'text-[10px] font-bold text-emerald-700 uppercase tracking-widest'

/** Card container shadow class — mirrors shadow in <Card /> for inline use. */
export const cardShadow = 'shadow-[0px_12px_32px_rgba(25,28,28,0.04)]'

/** Card surface (white bg + rounded + shadow). */
export const card = `bg-white rounded-xl ${cardShadow}`
