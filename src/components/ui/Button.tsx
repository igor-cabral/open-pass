import { ButtonHTMLAttributes, forwardRef } from 'react'

type Variant = 'primary' | 'secondary' | 'outline' | 'danger' | 'ghost'
type Size = 'sm' | 'md' | 'lg'

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  loading?: boolean
  fullWidth?: boolean
}

const variantClasses: Record<Variant, string> = {
  primary: 'bg-primary text-white shadow-glow hover:brightness-110 active:scale-[0.97]',
  secondary: 'bg-accent text-[#20242C] hover:brightness-105 active:scale-[0.97]',
  outline: 'border border-line bg-surface text-ink hover:bg-primary-light active:scale-[0.97]',
  danger: 'bg-danger text-white hover:brightness-110 active:scale-[0.97]',
  ghost: 'text-ink hover:bg-primary-light',
}

const sizeClasses: Record<Size, string> = {
  sm: 'text-sm px-3.5 py-2 rounded-xl',
  md: 'text-base px-5 py-3 rounded-2xl',
  lg: 'text-lg px-6 py-4 rounded-2xl min-h-[3.5rem]',
}

export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  { variant = 'primary', size = 'md', loading, fullWidth, className = '', children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={`font-display font-semibold transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2 ${variantClasses[variant]} ${sizeClasses[size]} ${fullWidth ? 'w-full' : ''} ${className}`}
      {...rest}
    >
      {loading && (
        <span className="h-4 w-4 rounded-full border-2 border-current border-t-transparent animate-spin" />
      )}
      {children}
    </button>
  )
})
