export function onlyDigits(value: string): string {
  return (value || '').replace(/\D/g, '')
}

export function formatPhone(value: string): string {
  const d = onlyDigits(value).slice(0, 11)
  if (d.length <= 2) return d
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
}

export function isValidEmail(value: string): boolean {
  const v = (value || '').trim()
  return v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)
}

// O campo "Telefone ou e-mail" do login aceita os dois: se tem "@" é e-mail.
export function looksLikeEmail(value: string): boolean {
  return (value || '').includes('@')
}
