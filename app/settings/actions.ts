'use server'

import { createClient } from '@/lib/supabase-server'
import { revalidatePath } from 'next/cache'

export async function addCustomListItem(
  listType: 'destination' | 'port' | 'carrier',
  name: string
): Promise<{ error: string | null }> {
  const trimmed = name.trim()
  if (!trimmed) return { error: '이름을 입력해주세요.' }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: '로그인이 필요합니다.' }

  const { error } = await supabase.from('custom_lists').insert({
    user_id: user.id,
    list_type: listType,
    name: trimmed,
  })

  if (error) {
    if (error.code === '23505') return { error: '이미 존재하는 항목입니다.' }
    return { error: error.message }
  }

  revalidatePath('/settings')
  return { error: null }
}

export async function deleteCustomListItem(id: string): Promise<void> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return

  await supabase.from('custom_lists').delete().eq('id', id)
  revalidatePath('/settings')
  revalidatePath('/bookings')
}

export async function updateCustomListItem(id: string, name: string): Promise<{ error: string | null }> {
  const trimmed = name.trim()
  if (!trimmed) return { error: '이름을 입력해주세요.' }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: '로그인이 필요합니다.' }

  const { error } = await supabase
    .from('custom_lists')
    .update({ name: trimmed })
    .eq('id', id)

  if (error) return { error: error.message }
  revalidatePath('/settings')
  return { error: null }
}

// ── 열 설정 저장 (순서 + 고정 열) ───────────────────────────────────

export async function saveColumnSettings(
  order: string[],
  pinned: string[]
): Promise<{ error: string | null }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: '로그인이 필요합니다.' }

  const { error } = await supabase
    .from('profiles')
    .update({ column_order: order, pinned_columns: pinned })
    .eq('id', user.id)

  if (error) return { error: error.message }
  revalidatePath('/bookings')
  revalidatePath('/settings')
  return { error: null }
}

// ── 커스텀 열 추가/삭제 (비밀번호 필요) ────────────────────────────

export async function addColumnDefinition(
  label: string,
  password: string
): Promise<{ error: string | null }> {
  if (password !== '4478') return { error: '비밀번호가 올바르지 않습니다.' }
  const trimmed = label.trim()
  if (!trimmed) return { error: '열 이름을 입력해주세요.' }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: '로그인이 필요합니다.' }

  const key = `custom_${Date.now().toString(36)}`

  // display_order: 기존 최대값 + 1
  const { data: existing } = await supabase
    .from('column_definitions')
    .select('display_order')
    .order('display_order', { ascending: false })
    .limit(1)
  const nextOrder = (existing?.[0]?.display_order ?? -1) + 1

  const { error } = await supabase.from('column_definitions').insert({
    key,
    label: trimmed,
    display_order: nextOrder,
  })

  if (error) return { error: error.message }
  revalidatePath('/bookings')
  revalidatePath('/settings')
  return { error: null }
}

export async function removeColumnDefinition(
  id: string,
  password: string
): Promise<{ error: string | null }> {
  if (password !== '4478') return { error: '비밀번호가 올바르지 않습니다.' }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: '로그인이 필요합니다.' }

  const { error } = await supabase.from('column_definitions').delete().eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/bookings')
  revalidatePath('/settings')
  return { error: null }
}

// ── 드롭다운 목록 순서 저장 ─────────────────────────────────────────

export async function saveCustomListOrder(orderedIds: string[]): Promise<{ error: string | null }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: '로그인이 필요합니다.' }

  await Promise.all(orderedIds.map((id, i) =>
    supabase.from('custom_lists').update({ sort_order: i }).eq('id', id)
  ))
  revalidatePath('/settings')
  revalidatePath('/bookings')
  return { error: null }
}

// ── 스케줄 열 구성 전체 저장 (비밀번호 필요) ─────────────────────────

export async function saveGlobalScheduleCols(
  cols: string[],
  password: string
): Promise<{ error: string | null }> {
  if (password !== '4478') return { error: '비밀번호가 올바르지 않습니다.' }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: '로그인이 필요합니다.' }

  const { error } = await supabase
    .from('global_settings')
    .upsert({ key: 'schedule_cols', value: cols, updated_at: new Date().toISOString() })

  if (error) return { error: error.message }
  revalidatePath('/bookings')
  return { error: null }
}

// ── 내 담당자 색상 저장 ─────────────────────────────────────────────

export async function saveMyColor(color: string): Promise<{ error: string | null }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: '로그인이 필요합니다.' }

  const { error } = await supabase
    .from('profiles')
    .update({ color: color || null })
    .eq('id', user.id)

  if (error) return { error: error.message }
  revalidatePath('/bookings')
  revalidatePath('/settings')
  return { error: null }
}

// ── 서류마감 메일 템플릿 저장 (유저별) ─────────────────────────────

export async function saveDocTemplate(
  template: string
): Promise<{ error: string | null }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: '로그인이 필요합니다.' }

  const { data, error } = await supabase
    .from('profiles')
    .update({ doc_template: template })
    .eq('id', user.id)
    .select('doc_template')
    .single()

  if (error) return { error: error.message }
  if (!data) return { error: '프로필을 찾을 수 없습니다.' }
  revalidatePath('/bookings')
  return { error: null }
}
