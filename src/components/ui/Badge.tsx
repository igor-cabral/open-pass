export function Badge({
  children,
  tone = 'neutral',
}: {
  children: React.ReactNode
  tone?: 'neutral' | 'success' | 'warning' | 'danger'
}) {
  const tones = {
    neutral: 'bg-ink/5 text-ink/70',
    success: 'bg-success/15 text-success-ink',
    warning: 'bg-accent/25 text-accent-dark',
    danger: 'bg-danger/10 text-danger',
  }
  const dots = { neutral: 'bg-ink/40', success: 'bg-success', warning: 'bg-accent-dark', danger: 'bg-danger' }
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${tones[tone]}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dots[tone]}`} />
      {children}
    </span>
  )
}
