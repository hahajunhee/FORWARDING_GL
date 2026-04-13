'use server'

import { createClient } from '@/lib/supabase-server'
import { createAdminClient } from '@/lib/supabase-admin'
import { revalidatePath } from 'next/cache'

const MASTER_EMAIL = 'hahajunhee@glovis.net'

async function getMasterUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || user.email !== MASTER_EMAIL) return null
  return { supabase, user }
}

export async function setUserActive(userId: string, isActive: boolean): Promise<{ error: string | null }> {
  const master = await getMasterUser()
  if (!master) return { error: '권한이 없습니다.' }

  const admin = createAdminClient()
  const { error } = await admin
    .from('profiles')
    .update({ is_active: isActive })
    .eq('id', userId)

  if (error) return { error: error.message }
  revalidatePath('/admin')
  revalidatePath('/bookings')
  return { error: null }
}

export async function deleteUser(userId: string, reassignTo?: string): Promise<{ error: string | null; bookingCount?: number }> {
  const master = await getMasterUser()
  if (!master) return { error: '권한이 없습니다.' }

  const admin = createAdminClient()

  // 해당 유저의 부킹 수 확인
  const { count } = await admin
    .from('bookings')
    .select('id', { count: 'exact', head: true })
    .eq('forwarder_handler_id', userId)

  // 부킹이 있는데 reassignTo가 없으면 → 부킹 수 반환 (프론트에서 재배정 프롬프트)
  if ((count ?? 0) > 0 && !reassignTo) {
    return { error: null, bookingCount: count ?? 0 }
  }

  // 부킹 재배정
  if (reassignTo && (count ?? 0) > 0) {
    const { error: reassignErr } = await admin
      .from('bookings')
      .update({ forwarder_handler_id: reassignTo })
      .eq('forwarder_handler_id', userId)
    if (reassignErr) return { error: `부킹 재배정 실패: ${reassignErr.message}` }
  }

  // 탈퇴 처리
  const { data: profile } = await admin.from('profiles').select('name').eq('id', userId).single()
  const originalName = profile?.name || ''
  const { error } = await admin
    .from('profiles')
    .update({ is_active: false, name: `[탈퇴] ${originalName}` })
    .eq('id', userId)

  if (error) return { error: error.message }
  revalidatePath('/admin')
  revalidatePath('/bookings')
  return { error: null }
}

export async function restoreUser(userId: string, newName: string): Promise<{ error: string | null }> {
  const master = await getMasterUser()
  if (!master) return { error: '권한이 없습니다.' }

  const admin = createAdminClient()
  const { error } = await admin
    .from('profiles')
    .update({ is_active: true, name: newName })
    .eq('id', userId)

  if (error) return { error: error.message }
  revalidatePath('/admin')
  revalidatePath('/bookings')
  return { error: null }
}

export async function updateRegionList(list: string[]): Promise<{ error: string | null }> {
  const master = await getMasterUser()
  if (!master) return { error: '권한이 없습니다.' }

  const { error } = await master.supabase
    .from('global_settings')
    .upsert({ key: 'region_list', value: list })

  if (error) return { error: error.message }
  revalidatePath('/admin')
  revalidatePath('/bookings')
  revalidatePath('/settings')
  return { error: null }
}

export async function updateCustomerList(list: string[]): Promise<{ error: string | null }> {
  const master = await getMasterUser()
  if (!master) return { error: '권한이 없습니다.' }

  const { error } = await master.supabase
    .from('global_settings')
    .upsert({ key: 'customer_list', value: list })

  if (error) return { error: error.message }
  revalidatePath('/admin')
  revalidatePath('/bookings')
  revalidatePath('/settings')
  return { error: null }
}

export async function updateInviteCode(newCode: string): Promise<{ error: string | null }> {
  const master = await getMasterUser()
  if (!master) return { error: '권한이 없습니다.' }

  const trimmed = newCode.trim()
  if (!trimmed) return { error: '초대코드를 입력해주세요.' }

  const { error } = await master.supabase
    .from('global_settings')
    .upsert({ key: 'invite_code', value: trimmed })

  if (error) return { error: error.message }
  revalidatePath('/admin')
  return { error: null }
}
