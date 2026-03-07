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
