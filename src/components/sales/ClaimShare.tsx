import toast from 'react-hot-toast'
import { QrCode } from '@/components/ticket/QrCode'
import { Button } from '@/components/ui/Button'
import { buildClaimUrl } from '@/services/sales'

// Mostra o link de resgate do ingresso: QR para o cliente escanear na hora,
// ou link para copiar / mandar por WhatsApp.
export function ClaimShare({ token, eventName }: { token: string; eventName?: string }) {
  const url = buildClaimUrl(token)

  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      toast.success('Link copiado!')
    } catch {
      toast.error('Não foi possível copiar. Selecione o link e copie manualmente.')
    }
  }

  const message =
    `Seu ingresso${eventName ? ` de ${eventName}` : ''} está pronto! 🎟️\n` +
    `Abra o link, crie sua conta (ou entre) e ele fica salvo no seu perfil:\n${url}`

  return (
    <div className="space-y-3">
      <div className="flex justify-center">
        <QrCode value={url} size={200} />
      </div>
      <p className="text-xs text-ink/60 text-center">
        O cliente aponta a câmera do celular para o QR e cria a conta. O link só funciona uma vez.
      </p>
      <input
        readOnly
        value={url}
        onFocus={(e) => e.currentTarget.select()}
        className="w-full rounded-xl border border-line bg-paper px-3 py-2 text-xs font-mono"
      />
      <div className="grid grid-cols-2 gap-2">
        <Button variant="outline" onClick={copy}>Copiar link</Button>
        <a
          href={`https://wa.me/?text=${encodeURIComponent(message)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center justify-center rounded-xl bg-[#25D366] text-white font-display font-semibold px-4 py-2.5 hover:opacity-90 active:scale-[0.98] transition-all"
        >
          WhatsApp
        </a>
      </div>
    </div>
  )
}
