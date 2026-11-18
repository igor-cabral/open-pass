/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Cores dinâmicas via CSS variables (definidas em src/styles/index.css
        // para :root e para .dark) — assim toda classe existente que já usa
        // esses nomes (bg-paper, text-ink/70, border-line/60, bg-primary-light
        // etc.) passa a responder ao modo escuro automaticamente, sem precisar
        // editar cada componente. O formato "R G B" (sem vírgula) é o que o
        // Tailwind espera pra suportar opacidade (/70, /60, ...).
        ink: 'rgb(var(--color-ink) / <alpha-value>)',
        paper: 'rgb(var(--color-paper) / <alpha-value>)',
        surface: 'rgb(var(--color-surface) / <alpha-value>)',
        primary: {
          DEFAULT: 'rgb(var(--color-primary) / <alpha-value>)',
          dark: 'rgb(var(--color-primary-dark) / <alpha-value>)',
          light: 'rgb(var(--color-primary-light) / <alpha-value>)',
        },
        accent: {
          DEFAULT: 'rgb(var(--color-accent) / <alpha-value>)',
          dark: 'rgb(var(--color-accent-dark) / <alpha-value>)',
        },
        danger: 'rgb(var(--color-danger) / <alpha-value>)',
        success: {
          DEFAULT: 'rgb(var(--color-success) / <alpha-value>)',
          ink: 'rgb(var(--color-success-ink) / <alpha-value>)',
        },
        violet: {
          DEFAULT: 'rgb(var(--color-violet) / <alpha-value>)',
          ink: 'rgb(var(--color-violet-ink) / <alpha-value>)',
        },
        line: 'rgb(var(--color-line) / <alpha-value>)',
      },
      fontFamily: {
        display: ['"Myriad Pro"', '"Space Grotesk"', 'sans-serif'],
        body: ['"Myriad Pro"', 'Inter', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      borderRadius: {
        ticket: '1.25rem',
      },
      boxShadow: {
        card: '0 1px 2px rgba(20,28,45,0.05), 0 12px 32px -14px rgba(20,28,45,0.16)',
        lift: '0 2px 4px rgba(20,28,45,0.06), 0 20px 40px -16px rgba(20,28,45,0.28)',
        glow: '0 10px 24px -10px rgb(var(--color-primary) / 0.65)',
      },
      keyframes: {
        fadeInUp: {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        popIn: {
          '0%': { opacity: '0', transform: 'scale(0.92)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        ticketIn: {
          '0%': { opacity: '0', transform: 'translateY(18px) scale(0.97)' },
          '100%': { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        sheetUp: {
          '0%': { opacity: '0', transform: 'translateY(24px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        checkPop: {
          '0%': { transform: 'scale(0)' },
          '60%': { transform: 'scale(1.15)' },
          '100%': { transform: 'scale(1)' },
        },
      },
      animation: {
        'fade-in-up': 'fadeInUp 0.28s ease-out both',
        'pop-in': 'popIn 0.2s ease-out both',
        shimmer: 'shimmer 1.6s linear infinite',
        'ticket-in': 'ticketIn 0.45s cubic-bezier(0.22, 1, 0.36, 1) both',
        'sheet-up': 'sheetUp 0.28s cubic-bezier(0.22, 1, 0.36, 1) both',
        'check-pop': 'checkPop 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) both',
      },
    },
  },
  plugins: [],
}
