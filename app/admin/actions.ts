'use server'

import { createClient } from '@/lib/supabase-server'
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

  const { error } = await master.supabase
    .from('profiles')
    .update({ is_active: isActive })
    .eq('id', userId)

  if (error) return { error: error.message }
  revalidatePath('/admin')
  revalidatePath('/bookings')
  return { error: null }
}

export async function deleteUser(userId: string): Promise<{ error: string | null }> {
  const master = await getMasterUser()
  if (!master) return { error: '권한이 없습니다.' }

  // profiles 삭제 (auth.users는 service_role 없이는 삭제 불가 → 비활성화로 대체)
  const { error } = await master.supabase
    .from('profiles')
    .update({ is_active: false, name: '[탈퇴]' })
    .eq('id', userId)

  if (error) return { error: error.message }
  revalidatePath('/admin')
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
