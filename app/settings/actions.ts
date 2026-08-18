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

export async function updateCustomListColor(id: string, color: string | null): Promise<{ error: string | null }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: '로그인이 필요합니다.' }

  const { error } = await supabase
    .from('custom_lists')
    .update({ color: color || null })
    .eq('id', id)

  if (error) return { error: error.message }
  revalidatePath('/settings')
  revalidatePath('/bookings')
  return { error: null }
}

// 목록 항목 이름 변경 — 부킹장의 해당 값과 도착지 등록/팀트럭 설정까지 함께 갱신한다.
export async function updateCustomListItem(id: string, name: string): Promise<{ error: string | null }> {
  const trimmed = name.trim()
  if (!trimmed) return { error: '이름을 입력해주세요.' }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: '로그인이 필요합니다.' }

  const { data: item, error: getErr } = await supabase
    .from('custom_lists').select('id, list_type, name').eq('id', id).single()
  if (getErr || !item) return { error: '항목을 찾을 수 없습니다.' }

  const oldName = (item.name as string) || ''
  if (oldName === trimmed) return { error: null }

  const { data: dup } = await supabase
    .from('custom_lists').select('id')
    .eq('list_type', item.list_type).eq('name', trimmed).maybeSingle()
  if (dup && dup.id !== id) return { error: '이미 존재하는 항목입니다.' }

  const { error } = await supabase.from('custom_lists').update({ name: trimmed }).eq('id', id)
  if (error) return { error: error.message }

  const eq = (a: string, b: string) => a.trim().toUpperCase() === b.trim().toUpperCase()
  const field = item.list_type === 'destination' ? 'final_destination'
    : item.list_type === 'port' ? 'discharge_port' : 'carrier'

  // 부킹장 값 갱신 (최종도착지는 "A & B" 복수 값도 조각 단위로 치환)
  const { data: rows } = await supabase.from('bookings').select(`id, ${field}`)
  const updates: { id: string; value: string }[] = []
  for (const r of (rows || []) as unknown as Record<string, string>[]) {
    const cur = (r[field] as string) || ''
    if (!cur) continue
    let next = cur
    if (field === 'final_destination' && cur.includes('&')) {
      const parts = cur.split('&').map(x => x.trim()).filter(Boolean)
      if (parts.some(x => eq(x, oldName))) {
        next = parts.map(x => (eq(x, oldName) ? trimmed : x)).join(' & ')
      }
    } else if (eq(cur, oldName)) {
      next = trimmed
    }
    if (next !== cur) updates.push({ id: r.id as string, value: next })
  }
  for (let i = 0; i < updates.length; i += 20) {
    await Promise.all(updates.slice(i, i + 20).map(u =>
      supabase.from('bookings').update({ [field]: u.value }).eq('id', u.id)))
  }

  // 도착지 등록(주요 스케줄·확보선복취합)·팀트럭 설정의 이름도 함께 갱신
  if (item.list_type === 'destination') {
    const renameInText = (v: string) => v.includes('&')
      ? v.split('&').map(x => x.trim()).filter(Boolean).map(x => (eq(x, oldName) ? trimmed : x)).join(' & ')
      : (eq(v, oldName) ? trimmed : v)

    const { data: gs } = await supabase
      .from('global_settings').select('value').eq('key', 'schedule_dest_groups').single()
    const groups = (gs?.value as { label: string; members: string[] }[] | null) || []
    if (groups.length > 0) {
      const nextGroups = groups.map(g => ({
        label: renameInText(g.label || ''),
        members: (g.members || []).map(renameInText),
      }))
      if (JSON.stringify(nextGroups) !== JSON.stringify(groups)) {
        await supabase.from('global_settings').upsert({ key: 'schedule_dest_groups', value: nextGroups })
        // 주당 MQC 설정은 도착지명을 키로 쓰므로 함께 이동
        const { data: bs } = await supabase
          .from('global_settings').select('value').eq('key', 'secured_base_settings').single()
        const bases = (bs?.value as Record<string, unknown> | null) || {}
        const nextBases: Record<string, unknown> = {}
        let baseChanged = false
        for (const [k, v] of Object.entries(bases)) {
          const nk = renameInText(k)
          if (nk !== k) baseChanged = true
          nextBases[nk] = v
        }
        if (baseChanged) {
          await supabase.from('global_settings').upsert({ key: 'secured_base_settings', value: nextBases })
        }
      }
    }

    const { data: tt } = await supabase
      .from('global_settings').select('value').eq('key', 'team_truck_dests').single()
    const dests = (tt?.value as string[] | null) || []
    if (dests.some(d => eq(d, oldName))) {
      await supabase.from('global_settings').upsert({
        key: 'team_truck_dests',
        value: dests.map(d => (eq(d, oldName) ? trimmed : d)),
      })
    }
  }

  revalidatePath('/settings')
  revalidatePath('/bookings')
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
  password: string,
  description: string = '',
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
    description: description.trim(),
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

// ── 내 프로필 정보 저장 (이름, 지역, 고객사) ────────────────────────

export async function saveMyProfile(
  name: string,
  region: string,
  customers: string,
): Promise<{ error: string | null }> {
  const trimmed = name.trim()
  if (!trimmed) return { error: '이름을 입력해주세요.' }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: '로그인이 필요합니다.' }

  const { error } = await supabase
    .from('profiles')
    .update({ name: trimmed, region: region.trim(), customers: customers.trim() })
    .eq('id', user.id)

  if (error) return { error: error.message }
  revalidatePath('/bookings')
  revalidatePath('/settings')
  return { error: null }
}

// ── 커스텀 열 설명 수정 ──────────────────────────────────────────────

export async function updateColumnDescription(
  id: string,
  description: string,
): Promise<{ error: string | null }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: '로그인이 필요합니다.' }

  const { error } = await supabase
    .from('column_definitions')
    .update({ description: description.trim() })
    .eq('id', id)

  if (error) return { error: error.message }
  revalidatePath('/bookings')
  revalidatePath('/settings')
  return { error: null }
}

// ── 기본 열 라벨 저장 (비밀번호 필요) ────────────────────────────────

export async function saveBaseColLabels(
  labels: Record<string, string>,
  password: string,
): Promise<{ error: string | null }> {
  if (password !== '4478') return { error: '비밀번호가 올바르지 않습니다.' }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: '로그인이 필요합니다.' }

  const { error } = await supabase
    .from('global_settings')
    .upsert({ key: 'base_col_labels', value: labels })

  if (error) return { error: error.message }
  revalidatePath('/bookings')
  revalidatePath('/settings')
  return { error: null }
}

// ── 최종도착지 정렬 순서 저장 ────────────────────────────────────────

export async function saveDestinationSortOrder(
  order: string[],
  password: string,
): Promise<{ error: string | null }> {
  if (password !== '4478') return { error: '비밀번호가 올바르지 않습니다.' }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: '로그인이 필요합니다.' }

  const { error } = await supabase
    .from('global_settings')
    .upsert({ key: 'destination_sort_order', value: order })

  if (error) return { error: error.message }
  revalidatePath('/bookings')
  revalidatePath('/settings')
  return { error: null }
}

// ── 기본 열 설명 저장 (global_settings) ─────────────────────────────

export async function saveBaseColDescriptions(
  descriptions: Record<string, string>,
): Promise<{ error: string | null }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: '로그인이 필요합니다.' }

  const { error } = await supabase
    .from('global_settings')
    .upsert({ key: 'base_col_descriptions', value: descriptions })

  if (error) return { error: error.message }
  revalidatePath('/bookings')
  revalidatePath('/settings')
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

// ── 테이블 스타일 저장 (유저별) ──────────────────────────────────

export async function saveTableStyle(
  style: { cellBorderColor: string; cellBorderWidth: number; groupBorderColor: string; groupBorderWidth: number }
): Promise<{ error: string | null }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: '로그인이 필요합니다.' }

  const { error } = await supabase
    .from('profiles')
    .update({ table_style: style })
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
