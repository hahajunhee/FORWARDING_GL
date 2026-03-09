'use server'

import { createAdminClient } from '@/lib/supabase-admin'

export async function validateInviteCode(
  code: string
): Promise<{ valid: boolean; error: string | null }> {
  const trimmedCode = code.trim()
  if (!trimmedCode) {
    return { valid: false, error: '초대코드를 입력해주세요.' }
  }

  try {
    const adminClient = createAdminClient()
    const { data: setting, error: dbError } = await adminClient
      .from('global_settings')
      .select('value')
      .eq('key', 'invite_code')
      .single()

    if (dbError) {
      console.error('[validateInviteCode] DB error:', dbError.message)
      return { valid: false, error: '서버 오류가 발생했습니다.' }
    }

    const validCode = (setting?.value as string | null) ?? ''
    if (!validCode) {
      return { valid: false, error: '초대코드가 설정되지 않았습니다.' }
    }

    const isValid = trimmedCode === validCode
    return { valid: isValid, error: isValid ? null : '초대코드가 올바르지 않습니다.' }
  } catch (err) {
    console.error('[validateInviteCode] Unexpected error:', err)
    return { valid: false, error: '서버 오류가 발생했습니다.' }
  }
}
