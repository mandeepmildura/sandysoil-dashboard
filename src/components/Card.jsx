export default function Card({ children, accent, className = '' }) {
  const accentClass = {
    green: 'accent-green',
    blue:  'accent-blue',
    red:   'accent-red',
    amber: 'accent-amber',
  }[accent] ?? ''

  return (
    <div className={`bg-[#ffffff] rounded-xl shadow-card p-5 ${accentClass} ${className}`}>
      {children}
    </div>
  )
}
