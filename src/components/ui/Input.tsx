import { InputHTMLAttributes, forwardRef } from 'react'

interface Props extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
}

export const Input = forwardRef<HTMLInputElement, Props>(function Input(
  { label, error, className = '', id, ...rest },
  ref,
) {
  const inputId = id || label?.toLowerCase().replace(/\s+/g, '-')
  return (
    <div className="w-full">
      {label && (
        <label htmlFor={inputId} className="block text-sm font-medium text-ink/70 mb-1.5">
          {label}
        </label>
      )}
      <input
        ref={ref}
        id={inputId}
        className={`w-full rounded-2xl border px-4 py-3.5 text-base bg-surface text-ink placeholder:text-ink/35 outline-none transition-all focus:ring-4 focus:ring-primary/15 focus:border-primary ${error ? 'border-danger' : 'border-line'} ${className}`}
        {...rest}
      />
      {error && <p className="mt-1 text-sm text-danger">{error}</p>}
    </div>
  )
})
