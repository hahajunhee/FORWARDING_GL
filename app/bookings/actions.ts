'use server'

import { createClient } from '@/lib/supabase-server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import type { BookingFormData } from '@/types'

// ── 기존 폼 페이지용 액션 ──────────────────────────────────────────

export async function createBooking(data: BookingFormData) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { error } = await supabase.from('bookings').insert({
    ...data,
    forwarder_handler_id: data.forwarder_handler_id || null,
    doc_cutoff_date: data.doc_cutoff_date || null,
    proforma_etd: data.proforma_etd || null,
    updated_etd: data.updated_etd || null,
    eta: data.eta || null,
    qty_20_normal: Number(data.qty_20_normal) || 0,
    qty_20_dg: Number(data.qty_20_dg) || 0,
    qty_20_reefer: Number(data.qty_20_reefer) || 0,
    qty_40_normal: Number(data.qty_40_normal) || 0,
    qty_40_dg: Number(data.qty_40_dg) || 0,
    qty_40_reefer: Number(data.qty_40_reefer) || 0,
    created_by: user.id,
  })

  if (error) return { error: error.message }
  revalidatePath('/bookings')
  redirect('/bookings')
}

export async function updateBooking(id: string, data: BookingFormData) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { error } = await supabase
    .from('bookings')
    .update({
      ...data,
      forwarder_handler_id: data.forwarder_handler_id || null,
      doc_cutoff_date: data.doc_cutoff_date || null,
      proforma_etd: data.proforma_etd || null,
      updated_etd: data.updated_etd || null,
      eta: data.eta || null,
      qty_20_normal: Number(data.qty_20_normal) || 0,
      qty_20_dg: Number(data.qty_20_dg) || 0,
      qty_20_reefer: Number(data.qty_20_reefer) || 0,
      qty_40_normal: Number(data.qty_40_normal) || 0,
      qty_40_dg: Number(data.qty_40_dg) || 0,
      qty_40_reefer: Number(data.qty_40_reefer) || 0,
    })
    .eq('id', id)

  if (error) return { error: error.message }
  revalidatePath('/bookings')
  redirect('/bookings')
}

// ── 인라인 편집용 액션 (redirect 없음) ────────────────────────────

type RowData = Record<string, unknown>

export async function saveBookingRow(
  id: string | null,
  data: RowData
): Promise<{ error: string | null; id: string | null }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: '로그인이 필요합니다.', id: null }

  const normalized: RowData = { ...data }
  if (normalized.forwarder_handler_id === '') normalized.forwarder_handler_id = null
  if (normalized.doc_cutoff_date === '') normalized.doc_cutoff_date = null
  if (normalized.proforma_etd === '') normalized.proforma_etd = null
  if (normalized.updated_etd === '') normalized.updated_etd = null
  if (normalized.eta === '') normalized.eta = null

  if (id) {
    const { error } = await supabase.from('bookings').update(normalized).eq('id', id)
    if (error) return { error: error.message, id: null }
    revalidatePath('/bookings')
    return { error: null, id }
  } else {
    if (!normalized.booking_no) return { error: '부킹번호는 필수입니다.', id: null }
    const { data: newRow, error } = await supabase
      .from('bookings')
      .insert({ ...normalized, created_by: user.id })
      .select('id')
      .single()
    if (error) return { error: error.message, id: null }
    revalidatePath('/bookings')
    return { error: null, id: newRow.id }
  }
}

// ── 일괄 저장 (단일 revalidatePath) ───────────────────────────────

export async function bulkSaveBookings(
  edits: { id: string; data: RowData }[],
  inserts: { tempId: string; data: RowData }[],
): Promise<{ errors: Record<string, string> }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { errors: { _: '로그인이 필요합니다.' } }

  const errors: Record<string, string> = {}

  const normalize = (data: RowData): RowData => {
    const d = { ...data }
    if (d.forwarder_handler_id === '') d.forwarder_handler_id = null
    if (d.doc_cutoff_date === '') d.doc_cutoff_date = null
    if (d.proforma_etd === '') d.proforma_etd = null
    if (d.updated_etd === '') d.updated_etd = null
    if (d.eta === '') d.eta = null
    return d
  }

  // updated_etd 변경 시 이전 값 저장을 위해 현재 값 미리 조회
  const etdEditIds = edits.filter(e => 'updated_etd' in e.data).map(e => e.id)
  const currentEtdMap: Record<string, string | null> = {}
  if (etdEditIds.length > 0) {
    const { data: rows } = await supabase.from('bookings').select('id, updated_etd').in('id', etdEditIds)
    if (rows) for (const r of rows) currentEtdMap[r.id] = r.updated_etd
  }

  await Promise.all([
    ...edits.map(async ({ id, data }) => {
      const d = normalize(data)
      // voyage는 rpc()로 별도 저장 (PostgREST schema cache 우회)
      const voyageValue = 'voyage' in d ? (d.voyage as string) : undefined
      delete d.voyage
      // updated_etd가 실제로 변경됐으면 이전 값을 updated_etd_prev에 저장
      if (id in currentEtdMap) {
        const prevEtd = currentEtdMap[id]
        const newEtd = (d.updated_etd as string | null | undefined) ?? null
        if (prevEtd !== newEtd) d.updated_etd_prev = prevEtd
      }
      if (Object.keys(d).length > 0) {
        const { error } = await supabase.from('bookings').update(d).eq('id', id)
        if (error) errors[id] = error.message
      }
      if (voyageValue !== undefined && !errors[id]) {
        const { error } = await supabase.rpc('update_booking_voyage', { booking_id: id, new_voyage: voyageValue })
        if (error) errors[id] = error.message
      }
    }),
    ...inserts.map(async ({ tempId, data }) => {
      const d = normalize(data)
      const voyageValue = 'voyage' in d ? (d.voyage as string) : undefined
      delete d.voyage
      const { data: newRow, error } = await supabase
        .from('bookings')
        .insert({ ...d, created_by: user.id })
        .select('id')
        .single()
      if (error) { errors[tempId] = error.message; return }
      if (voyageValue !== undefined && newRow?.id) {
        const { error: ve } = await supabase.rpc('update_booking_voyage', { booking_id: newRow.id, new_voyage: voyageValue })
        if (ve) errors[tempId] = ve.message
      }
    }),
  ])

  if (Object.keys(errors).length === 0) revalidatePath('/bookings')
  return { errors }
}

// ── 상해발관리 직전 PORT 목록 저장 (전체 공유) ──────────────────────

export async function saveShanghaiPrevPorts(ports: string[]): Promise<{ error: string | null }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: '로그인이 필요합니다.' }

  const { error } = await supabase
    .from('global_settings')
    .upsert({ key: 'shanghai_prev_ports', value: ports })

  if (error) return { error: error.message }
  revalidatePath('/bookings')
  return { error: null }
}

// ── 일괄 삭제 ──────────────────────────────────────────────────────

export async function bulkDeleteBookings(ids: string[]): Promise<{ error: string | null }> {
  if (ids.length === 0) return { error: null }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: '로그인이 필요합니다.' }

  // 내 담당 건만 삭제 (DB 레벨에서도 강제)
  const { error } = await supabase.from('bookings').delete().in('id', ids).eq('forwarder_handler_id', user.id)
  if (error) return { error: error.message }
  revalidatePath('/bookings')
  return { error: null }
}

// ── 부킹장(모선) 개인 설정 저장 (열 순서·표시 열 — 계정 단위) ────────

export async function saveVesselPrefs(
  prefs: { order: string[]; visible: string[] | null }
): Promise<{ error: string | null }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: '로그인이 필요합니다.' }

  const { error } = await supabase.from('profiles').update({ vessel_prefs: prefs }).eq('id', user.id)
  if (error) {
    if (/vessel_prefs|column/i.test(error.message)) return { error: '열 설정 저장에는 DB 마이그레이션(v19) 실행이 필요합니다.' }
    return { error: error.message }
  }
  return { error: null }
}

// ── 열 순서 저장 ───────────────────────────────────────────────────

export async function saveColumnOrder(columnOrder: string[]): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return
  await supabase.from('profiles').update({ column_order: columnOrder }).eq('id', user.id)
}

// ── 삭제 / 로그아웃 ───────────────────────────────────────────────

export async function deleteBooking(id: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { error } = await supabase.from('bookings').delete().eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/bookings')
  return { success: true }
}

export async function signOut() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect('/login')
}

// ── 상해발관리 저장 (전체 공유 목록 전체 교체) ─────────────────────

export type ShanghaiRowInput = {
  booking_seq_no: number | null
  prev_port: string         // 직전 PORT
  first_departure: string   // F 최초 출항일
  current_departure: string // G 현재 출항일
  berthing: string          // K 접안일
  mqc: string               // O MQC(/WK)
  remarks: string           // 비고
}

export async function saveShanghaiMgmt(
  rows: ShanghaiRowInput[],
  securedUpdates: { id: string; secured_space: string }[] = []
): Promise<{ error: string | null }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: '로그인이 필요합니다.' }

  // 확보선복 편집분을 부킹 원본에 반영 (부킹장 탭에도 즉시 반영됨)
  if (securedUpdates.length > 0) {
    const results = await Promise.all(
      securedUpdates.map(u => supabase.from('bookings').update({ secured_space: u.secured_space }).eq('id', u.id))
    )
    const upErr = results.find(r => r.error)?.error
    if (upErr) return { error: upErr.message }
  }

  // 전체 교체 방식: 기존 행 모두 삭제 후 현재 목록 삽입
  const { error: delErr } = await supabase
    .from('shanghai_mgmt')
    .delete()
    .neq('id', '00000000-0000-0000-0000-000000000000')
  if (delErr) return { error: delErr.message }

  if (rows.length > 0) {
    const base = rows.map((r, i) => ({
      booking_seq_no: r.booking_seq_no,
      sort_order: i,
      first_departure: r.first_departure || '',
      current_departure: r.current_departure || '',
    }))
    const withBerthing = base.map((b, i) => ({ ...b, berthing: rows[i].berthing || '' }))
    const withMqc = withBerthing.map((b, i) => ({ ...b, mqc: rows[i].mqc || '' }))
    const withAll = withMqc.map((b, i) => ({ ...b, prev_port: rows[i].prev_port || '', remarks: rows[i].remarks || '' }))
    // 신규 컬럼 미적용 마이그레이션 상태도 안전하게 — 단계적으로 폴백
    const candidates = [withAll, withMqc, withBerthing, base]
    let insErr: { message: string } | null = null
    for (const payload of candidates) {
      const res = await supabase.from('shanghai_mgmt').insert(payload)
      insErr = res.error
      if (!insErr) break
      // 컬럼 없음 오류가 아니면 즉시 중단
      if (!/does not exist|berthing|mqc|column/i.test(insErr.message)) break
    }
    if (insErr) return { error: insErr.message }
  }

  revalidatePath('/bookings')
  return { error: null }
}
