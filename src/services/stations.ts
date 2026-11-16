import { supabase } from '@/lib/supabaseClient'
import type { Station } from '@/types'

export async function listStations(eventId: string): Promise<Station[]> {
  const { data, error } = await supabase
    .from('stations')
    .select('*')
    .eq('event_id', eventId)
    .order('sort_order')
    .order('name')
  if (error) throw error
  return data as Station[]
}

export async function listStationsForEvents(eventIds: string[]): Promise<Station[]> {
  if (eventIds.length === 0) return []
  const { data, error } = await supabase
    .from('stations')
    .select('*')
    .in('event_id', eventIds)
    .order('sort_order')
    .order('name')
  if (error) throw error
  return data as Station[]
}

export async function createStation(eventId: string, name: string): Promise<Station> {
  const { data, error } = await supabase
    .from('stations')
    .insert({ event_id: eventId, name: name.trim() })
    .select()
    .single()
  if (error) {
    if (error.code === '23505') throw new Error('Já existe um ponto com esse nome neste evento.')
    throw error
  }
  return data as Station
}

export async function updateStation(id: string, input: Partial<Pick<Station, 'name' | 'active'>>) {
  const { error } = await supabase.from('stations').update(input).eq('id', id)
  if (error) {
    if (error.code === '23505') throw new Error('Já existe um ponto com esse nome neste evento.')
    throw error
  }
}

export async function deleteStation(id: string) {
  const { error } = await supabase.from('stations').delete().eq('id', id)
  if (error) throw error
}

// station_id -> product_ids
export async function listStationProducts(stationIds: string[]): Promise<Record<string, string[]>> {
  const map: Record<string, string[]> = {}
  if (stationIds.length === 0) return map
  const { data, error } = await supabase
    .from('station_products')
    .select('station_id, product_id')
    .in('station_id', stationIds)
  if (error) throw error
  for (const row of data as { station_id: string; product_id: string }[]) {
    ;(map[row.station_id] ||= []).push(row.product_id)
  }
  return map
}

// Troca o conjunto de produtos entregues no ponto (só mexe no que mudou).
export async function setStationProducts(stationId: string, productIds: string[]) {
  const { data: current, error: e1 } = await supabase
    .from('station_products')
    .select('product_id')
    .eq('station_id', stationId)
  if (e1) throw e1
  const have = new Set((current as { product_id: string }[]).map((r) => r.product_id))
  const want = new Set(productIds)

  const toRemove = [...have].filter((id) => !want.has(id))
  const toAdd = [...want].filter((id) => !have.has(id))

  if (toRemove.length) {
    const { error } = await supabase
      .from('station_products')
      .delete()
      .eq('station_id', stationId)
      .in('product_id', toRemove)
    if (error) throw error
  }
  if (toAdd.length) {
    const { error } = await supabase
      .from('station_products')
      .insert(toAdd.map((product_id) => ({ station_id: stationId, product_id })))
    if (error) throw error
  }
}
