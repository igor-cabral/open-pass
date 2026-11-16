const base = import.meta.env.BASE_URL.endsWith('/') ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`

export const DEV_URL = 'https://igorcabral.dev.br'

// Logo do OpenPass. No modo escuro o texto da logo some no fundo, então ela
// ganha uma "pílula" branca por trás.
export function OpenPassLogo({ className = 'h-9' }: { className?: string }) {
  return (
    <span className="inline-flex items-center rounded-xl dark:bg-white dark:px-2.5 dark:py-1">
      <img src={`${base}brand/openpass-logo.png`} alt="OpenPass" className={`${className} w-auto`} />
    </span>
  )
}

// "Desenvolvido por" + logo do desenvolvedor, com link. A logo é clara,
// por isso fica sobre um fundo escuro fixo.
export function DevCredit({ className = '' }: { className?: string }) {
  return (
    <div className={`flex items-center justify-center gap-2 text-xs text-ink/50 ${className}`}>
      <span>Desenvolvido por</span>
      <a
        href={DEV_URL}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Igor Cabral — igorcabral.dev.br"
        className="inline-flex items-center rounded-lg bg-[#20242C] px-2.5 py-1.5 hover:opacity-90 transition-opacity"
      >
        <img src={`${base}brand/igorcabral-claro.png`} alt="Igor Cabral" className="h-4 w-auto" />
      </a>
    </div>
  )
}
