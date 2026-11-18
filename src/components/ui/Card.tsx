import { HTMLAttributes } from 'react'

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Levanta levemente e aumenta a sombra no hover/toque — use em cards clicáveis. */
  hoverable?: boolean
  /** Anima a entrada do card (fade + leve subida). Não afeta o layout ao redor. */
  animateIn?: boolean
}

export function Card({ className = '', hoverable = false, animateIn = false, children, ...rest }: CardProps) {
  return (
    <div
      className={`bg-surface rounded-[1.25rem] shadow-card border border-line/50 transition-all duration-200 ${
        hoverable ? 'hover:shadow-lift hover:-translate-y-0.5 active:scale-[0.99]' : ''
      } ${animateIn ? 'animate-fade-in-up' : ''} ${className}`}
      {...rest}
    >
      {children}
    </div>
  )
}
