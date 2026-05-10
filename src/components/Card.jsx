/**
 * Shared card surface. Single source of truth for card shadow + radius.
 * Matches Pressure/Dashboard visual language.
 */
export default function Card({ children, accent, padded = true, className = '' }) {
  const accentClass = {
    green: 'accent-green',
    blue:  'accent-blue',
    red:   'accent-red',
    amber: 'accent-amber',
  }[accent] ?? ''

  const padding = padded ? 'p-7' : ''

  return (
    <div className={`bg-white rounded-xl shadow-[0px_12px_32px_rgba(25,28,28,0.04)] ${padding} ${accentClass} ${className}`}>
      {children}
    </div>
  )
}
