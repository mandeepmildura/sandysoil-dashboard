const variants = {
  online:    { bg: 'bg-[#0d631b]/10',  text: 'text-[#00490e]',  glow: 'glow-green',  dot: 'bg-[#0d631b]' },
  running:   { bg: 'bg-[#0d631b]/10',  text: 'text-[#00490e]',  glow: 'animate-pulse-glow', dot: 'bg-[#0d631b]' },
  offline:   { bg: 'bg-[#e2e2e2]',     text: 'text-[#40493d]',  glow: '',            dot: 'bg-[#40493d]' },
  warning:   { bg: 'bg-[#e65100]/10',  text: 'text-[#e65100]',  glow: 'glow-amber',  dot: 'bg-[#e65100]' },
  fault:     { bg: 'bg-[#ba1a1a]/10',  text: 'text-[#ba1a1a]',  glow: 'glow-red',    dot: 'bg-[#ba1a1a]' },
  info:      { bg: 'bg-[#00639a]/10',  text: 'text-[#00639a]',  glow: '',            dot: 'bg-[#00639a]' },
  completed: { bg: 'bg-[#0d631b]/10',  text: 'text-[#00490e]',  glow: '',            dot: 'bg-[#0d631b]' },
  paused:    { bg: 'bg-[#e65100]/10',  text: 'text-[#e65100]',  glow: '',            dot: 'bg-[#e65100]' },
  upcoming:  { bg: 'bg-[#00639a]/10',  text: 'text-[#00639a]',  glow: 'glow-blue',   dot: 'bg-[#00639a]' },
}

export default function StatusChip({ status, label }) {
  const v = variants[status] ?? variants.offline
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-body font-semibold ${v.bg} ${v.text} ${v.glow}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${v.dot}`} />
      {label ?? status.toUpperCase()}
    </span>
  )
}
