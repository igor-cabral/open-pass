import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { listProductsByEvent } from '@/services/products'
import { listEvents } from '@/services/events'
import {
  listStations, createStation, updateStation, deleteStation, listStationProducts, setStationProducts,
} from '@/services/stations'
import type { EventItem, Product, Station } from '@/types'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Badge } from '@/components/ui/Badge'
import { Loading } from '@/components/ui/Loading'

// Pontos de entrega do evento (bar, cozinha, ficha…) e quais produtos
// cada ponto entrega. O validador atribuído a um ponto só consegue dar baixa
// nesses produtos.
export default function StationsPage() {
  const { eventId = '' } = useParams()
  const [event, setEvent] = useState<EventItem | null>(null)
  const [stations, setStations] = useState<Station[] | null>(null)
  const [products, setProducts] = useState<Product[]>([])
  const [selected, setSelected] = useState<Record<string, string[]>>({})
  const [name, setName] = useState('')
  const [saving, setSaving] = useState<string | null>(null)

  async function reload() {
    try {
      const sts = await listStations(eventId)
      setStations(sts)
      setSelected(await listStationProducts(sts.map((s) => s.id)))
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  useEffect(() => {
    listEvents().then((evs) => setEvent(evs.find((e) => e.id === eventId) || null))
    listProductsByEvent(eventId).then(setProducts).catch((e) => toast.error(e.message))
    void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    try {
      await createStation(eventId, name)
      setName('')
      await reload()
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  function toggleProduct(stationId: string, productId: string) {
    setSelected((prev) => {
      const cur = prev[stationId] || []
      return { ...prev, [stationId]: cur.includes(productId) ? cur.filter((p) => p !== productId) : [...cur, productId] }
    })
  }

  async function save(stationId: string) {
    setSaving(stationId)
    try {
      await setStationProducts(stationId, selected[stationId] || [])
      toast.success('Produtos do ponto salvos.')
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setSaving(null)
    }
  }

  async function toggleActive(s: Station) {
    try {
      await updateStation(s.id, { active: !s.active })
      await reload()
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  async function remove(s: Station) {
    if (!confirm(`Excluir o ponto "${s.name}"? Os validadores atribuídos a ele ficam sem ponto.`)) return
    try {
      await deleteStation(s.id)
      await reload()
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  if (stations === null) return <Loading />

  // produtos ativos que nenhum ponto entrega — ficam sem como serem entregues
  const covered = new Set(Object.values(selected).flat())
  const orphans = products.filter((p) => p.active && !covered.has(p.id))

  return (
    <div className="space-y-5 max-w-xl">
      <div>
        <Link to="/admin" className="text-sm text-primary font-medium">← Eventos</Link>
        <h1 className="font-display font-bold text-2xl mt-1">Pontos de entrega</h1>
        <p className="text-sm text-ink/60">{event?.name}</p>
      </div>

      <Card className="p-4 text-sm text-ink/70">
        Crie os pontos (ex.: Bar, Cozinha, Ficha) e marque o que cada um entrega. Depois atribua cada validador a um
        ponto na tela <b>Equipe</b>. Evento sem nenhum ponto criado funciona como antes: qualquer validador entrega tudo.
      </Card>

      <Card className="p-4">
        <form onSubmit={handleCreate} className="flex gap-2 items-end">
          <div className="flex-1">
            <Input label="Novo ponto" value={name} onChange={(e) => setName(e.target.value)} placeholder="Bar" />
          </div>
          <Button type="submit">Criar</Button>
        </form>
      </Card>

      {stations.length > 0 && orphans.length > 0 && (
        <Card className="p-4 text-sm text-danger">
          Sem ponto de entrega: {orphans.map((p) => p.name).join(', ')}. Esses produtos não poderão ser entregues.
        </Card>
      )}

      {stations.map((s) => (
        <Card key={s.id} className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="font-display font-semibold">{s.name}</p>
            <div className="flex items-center gap-2">
              <Badge tone={s.active ? 'success' : 'danger'}>{s.active ? 'Ativo' : 'Inativo'}</Badge>
              <Button size="sm" variant="outline" onClick={() => toggleActive(s)}>{s.active ? 'Desativar' : 'Ativar'}</Button>
              <Button size="sm" variant="danger" onClick={() => remove(s)}>Excluir</Button>
            </div>
          </div>
          <div className="space-y-1.5">
            {products.length === 0 && <p className="text-xs text-ink/50">Cadastre produtos no evento primeiro.</p>}
            {products.map((p) => (
              <label key={p.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={(selected[s.id] || []).includes(p.id)}
                  onChange={() => toggleProduct(s.id, p.id)}
                />
                {p.name}
              </label>
            ))}
          </div>
          <Button size="sm" loading={saving === s.id} onClick={() => save(s.id)}>Salvar produtos</Button>
        </Card>
      ))}
    </div>
  )
}
