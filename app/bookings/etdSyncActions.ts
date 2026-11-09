'use server'

import { createClient } from '@/lib/supabase-server'
import { revalidatePath } from 'next/cache'
import { fetchCandidatesBatch, normVessel, type TerminalCandidate } from '@/lib/terminal-schedule'

// ── 모선명별 터미널 스케줄 후보 조회 (API 1회 호출) ─────────────────
export async function searchEtdCandidates(
  vessels: string[],
): Promise<{ byVessel: Record<string, TerminalCandidate[]>; error: string | null }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { byVessel: {}, error: '로그인이 필요합니다.' }
  const { byKey, error } = await fetchCandidatesBatch(vessels)
  return { byVessel: byKey, error: error || null }
}

// ── 부킹장 표의 "+3" 표시용: UPDATED ETD가 오늘 이후인 부킹들의 후보를 한 번에 ────
export interface EtdHintCand { s: string; e: string; t: string | null; v: string | null }

export async function fetchEtdHints(
  items: { id: string; vessel_name: string; updated_etd: string }[],
): Promise<{ hints: Record<string, EtdHintCand[]>; error: string | null }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { hints: {}, error: '로그인이 필요합니다.' }

  const { byKey, error } = await fetchCandidatesBatch(items.map(i => i.vessel_name))
  const dayMs = 86400000
  const toMs = (d: string) => { const [y, m, dd] = d.split('-').map(Number); return Date.UTC(y, m - 1, dd) }
  const hints: Record<string, EtdHintCand[]> = {}
  for (const it of items) {
    const all = byKey[normVessel(it.vessel_name)] || []
    const cur = toMs(it.updated_etd)
    const near = all
      .filter(c => c.etd && Math.abs(Math.round((toMs(c.etd.slice(0, 10)) - cur) / dayMs)) <= 21)
      .sort((a, b) => Math.abs(toMs((a.etd as string).slice(0, 10)) - cur) - Math.abs(toMs((b.etd as string).slice(0, 10)) - cur))
      .slice(0, 8)
      .map(c => ({ s: c.source, e: (c.etd as string).slice(0, 10), t: (c.etd as string).slice(11, 16) || null, v: c.terminal_voyage }))
    if (near.length > 0) hints[it.id] = near
  }
  return { hints, error: error || null }
}

// ── 선사 → 기본 터미널 매핑 저장 (유저별) ──────────────────────────
export async function saveEtdTerminalPrefs(
  prefs: Record<string, string[]>,
): Promise<{ error: string | null }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: '로그인이 필요합니다.' }

  const clean: Record<string, string[]> = {}
  for (const [carrier, terms] of Object.entries(prefs)) {
    const t = (terms || []).filter(Boolean)
    if (carrier.trim() && t.length > 0) clean[carrier.trim().toUpperCase()] = t
  }
  const { error } = await supabase.from('profiles').update({ etd_terminal_prefs: clean }).eq('id', user.id)
  if (error) {
    return { error: error.message.includes('etd_terminal_prefs')
      ? 'DB에 etd_terminal_prefs 열이 없습니다. migration_v24_etd_sync.sql 을 먼저 실행하세요.'
      : error.message }
  }
  revalidatePath('/bookings')
  return { error: null }
}

// ── 반영 이력 (최선 노력 — 실패해도 ETD 반영 자체에는 영향 없음) ─────
export interface EtdLogInput {
  booking_id: string
  vessel_name: string
  old_etd: string | null
  new_etd: string
  terminal: string
  terminal_voyage: string | null
  collected_at: string
}

export async function logEtdSync(items: EtdLogInput[]): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || items.length === 0) return
  await supabase.from('etd_sync_log').insert(items.map(i => ({ ...i, confirmed_by: user.id })))
}

export interface EtdLogRow extends EtdLogInput { id: string; created_at: string; confirmed_by: string | null }

export async function fetchEtdSyncLog(): Promise<EtdLogRow[]> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []
  const { data, error } = await supabase
    .from('etd_sync_log').select('*').order('created_at', { ascending: false }).limit(40)
  if (error) return []
  return (data || []) as EtdLogRow[]
}
