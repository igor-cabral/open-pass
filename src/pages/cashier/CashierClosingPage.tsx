import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { listMyEvents } from '@/services/events'
import { cashierClosing } from '@/services/sales'
import type { CashierClosing, EventItem } from '@/types'
import { Select } from '@/components/ui/Select'
import { Button } from '@/components/ui/Button'
import { Loading } from '@/components/ui/Loading'
import { ClosingView } from '@/components/sales/ClosingView'

export default function CashierClosingPage() {
  const [events, setEvents] = useState<EventItem[] | null>(null)
  const [eventId, setEventId] = useState('')
  const [closing, setClosing] = useState<CashierClosing | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    listMyEvents()
      .then((evs) => {
        setEvents(evs)
        if (evs.length > 0) setEventId(evs[0].id)
      })
      .catch((e) => toast.error(e.message))
  }, [])

  async function load() {
    if (!eventId) return
    setLoading(true)
    try {
      setClosing(await cashierClosing(eventId))
    } catch (err) {
      toast.error((err as Error).message)
      setClosing(null)
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId])

  if (events === null) return <Loading />

  return (
    <div className="max-w-md mx-auto space-y-5">
      <div>
        <Link to="/caixa" className="text-sm text-primary font-medium">← Vender</Link>
        <h1 className="font-display font-bold text-2xl mt-1">Fechamento de caixa</h1>
      </div>
      <Select label="Evento" value={eventId} onChange={(e) => setEventId(e.target.value)}>
        {events.map((ev) => <option key={ev.id} value={ev.id}>{ev.name}</option>)}
      </Select>
      <Button variant="outline" size="sm" loading={loading} onClick={load}>Atualizar</Button>
      {closing && <ClosingView closing={closing} />}
    </div>
  )
}
