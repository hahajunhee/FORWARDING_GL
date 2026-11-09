'use server'

import { createClient } from '@/lib/supabase-server'
import { revalidatePath } from 'next/cache'
import { fetchCandidates, normVessel, type TerminalCandidate } from '@/lib/terminal-schedule'

// ── 모선명별 터미널 스케줄 후보 조회 ───────────────────────────────
export async function searchEtdCandidates(
  vessels: string[],
): Promise<{ byVessel: Record<string, TerminalCandidate[]>; error: string | null }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { byVessel: {}, error: '로그인이 필요합니다.' }

  // 정규화한 이름 기준으로 중복 제거, 한 번에 최대 120척
  const uniq = new Map<string, string>()
  for (const v of vessels) {
    const k = normVessel(v)
    if (k && !uniq.has(k)) uniq.set(k, v.trim())
  }
  const list = [...uniq.entries()].slice(0, 120)

  const byVessel: Record<string, TerminalCandidate[]> = {}
  let firstError: string | null = null
  const CONC = 6
  for (let i = 0; i < list.length; i += CONC) {
    await Promise.all(list.slice(i, i + CONC).map(async ([k, name]) => {
      const { rows, error } = await fetchCandidates(name)
      byVessel[k] = rows
      if (error && !firstError) firstError = error
    }))
    if (firstError && Object.keys(byVessel).length === Math.min(CONC, list.length)) break // 설정 오류면 더 시도하지 않음
  }
  return { byVessel, error: firstError }
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
