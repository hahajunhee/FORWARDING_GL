'use server'

import { createClient } from '@/lib/supabase-server'
import { revalidatePath } from 'next/cache'
import type { CapMap } from '@/lib/capacity'

// 예상선복확인 탭의 매핑(PDC↔최종도착지, 선사↔선사)을 유저별로 저장
export async function saveCapacityMap(map: CapMap): Promise<{ error: string | null }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: '로그인이 필요합니다.' }

  const clean = (m: Record<string, string[]>) => {
    const out: Record<string, string[]> = {}
    for (const [k, v] of Object.entries(m || {})) {
      const list = [...new Set((v || []).map(x => String(x).trim()).filter(Boolean))]
      if (k.trim() && list.length > 0) out[k.trim()] = list
    }
    return out
  }
  const value = { pdc: clean(map.pdc), carrier: clean(map.carrier) }
  const { error } = await supabase.from('profiles').update({ capacity_map: value }).eq('id', user.id)
  if (error) {
    return { error: error.message.includes('capacity_map')
      ? 'DB에 capacity_map 열이 없습니다. migration_v25_capacity_map.sql 을 먼저 실행하세요.'
      : error.message }
  }
  revalidatePath('/bookings')
  return { error: null }
}
