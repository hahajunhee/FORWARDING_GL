'use server'

import { headers } from 'next/headers'
import { createAdminClient } from '@/lib/supabase-admin'
import { createClient } from '@/lib/supabase-server'
import { passwordPolicyError, sanitizeLine, isValidEmail } from '@/lib/password'

// ── 시도 제한 (계정 잠금 · 초대코드 무차별 대입 차단) ────────────────
// auth_attempts 테이블(마이그레이션 v23) 사용. 테이블이 없으면 기능만 비활성화되고
// 로그인/가입 자체는 계속 동작한다(가용성 우선).

const LOGIN_MAX_FAIL = 5   // 계정 잠금 임계값: 연속 5회 실패
const LOGIN_LOCK_MIN = 60  // 잠금 기간 60분, 60분 경과 후 실패 카운트 자동 초기화
const REG_MAX_FAIL = 10
const REG_LOCK_MIN = 15

type Attempt = { fail_count: number; locked_until: string | null }

async function getAttempt(key: string): Promise<Attempt | null> {
  try {
    const admin = createAdminClient()
    const { data } = await admin
      .from('auth_attempts')
      .select('fail_count, locked_until')
      .eq('key', key)
      .maybeSingle()
    return (data as Attempt | null) ?? null
  } catch {
    return null
  }
}

function lockedMinutesLeft(rec: Attempt | null): number {
  if (!rec?.locked_until) return 0
  const left = new Date(rec.locked_until).getTime() - Date.now()
  return left > 0 ? Math.ceil(left / 60000) : 0
}

async function registerFail(key: string, rec: Attempt | null, max: number, lockMin: number) {
  try {
    const admin = createAdminClient()
    const fails = (rec?.fail_count ?? 0) + 1
    const lock = fails >= max
    await admin.from('auth_attempts').upsert({
      key,
      fail_count: lock ? 0 : fails,
      locked_until: lock ? new Date(Date.now() + lockMin * 60000).toISOString() : null,
      last_failed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    return { locked: lock, remaining: Math.max(0, max - fails) }
  } catch {
    return { locked: false, remaining: max }
  }
}

async function clearAttempt(key: string) {
  try {
    const admin = createAdminClient()
    await admin.from('auth_attempts').delete().eq('key', key)
  } catch { /* 무시 */ }
}

async function clientKey(): Promise<string> {
  try {
    const h = await headers()
    const ip = (h.get('x-forwarded-for') || '').split(',')[0].trim() || h.get('x-real-ip') || 'unknown'
    return sanitizeLine(ip, 64)
  } catch {
    return 'unknown'
  }
}

// ── 회원가입 (초대코드 검증 + 계정 생성 전부 서버에서 수행) ───────────
// 클라이언트는 결과만 전달받으며, 응답을 조작해도 계정이 생성되지 않는다.

export async function registerUser(input: {
  name: string
  phone: string
  inviteCode: string
  email: string
  password: string
}): Promise<{ ok: boolean; error: string | null }> {
  const name = sanitizeLine(input?.name ?? '', 60)
  const phone = sanitizeLine(input?.phone ?? '', 30)
  const code = sanitizeLine(input?.inviteCode ?? '', 100)
  const email = sanitizeLine(input?.email ?? '', 320).toLowerCase()
  const password = input?.password ?? ''

  if (!name) return { ok: false, error: '이름을 입력해주세요.' }
  if (!email || !isValidEmail(email)) return { ok: false, error: '올바른 이메일 주소를 입력해주세요.' }
  if (phone && !/^[0-9+\-() ]{8,30}$/.test(phone)) return { ok: false, error: '휴대폰 번호 형식이 올바르지 않습니다.' }

  const pwError = passwordPolicyError(password)
  if (pwError) return { ok: false, error: pwError }

  // 초대코드 무차별 대입 차단 (IP 기준)
  const regKey = `reg:${await clientKey()}`
  const regRec = await getAttempt(regKey)
  const regLocked = lockedMinutesLeft(regRec)
  if (regLocked > 0) {
    return { ok: false, error: `초대코드 오류가 많아 ${regLocked}분간 가입이 제한됩니다.` }
  }

  if (!code) return { ok: false, error: '초대코드를 입력해주세요.' }

  let admin
  try {
    admin = createAdminClient()
  } catch {
    return { ok: false, error: '서버 오류가 발생했습니다.' }
  }

  const { data: setting, error: dbError } = await admin
    .from('global_settings')
    .select('value')
    .eq('key', 'invite_code')
    .single()

  if (dbError) {
    console.error('[registerUser] invite code lookup failed:', dbError.message)
    return { ok: false, error: '서버 오류가 발생했습니다.' }
  }

  const validCode = (setting?.value as string | null) ?? ''
  if (!validCode || code !== validCode) {
    const { locked } = await registerFail(regKey, regRec, REG_MAX_FAIL, REG_LOCK_MIN)
    return {
      ok: false,
      error: locked
        ? `초대코드 오류가 ${REG_MAX_FAIL}회를 넘어 ${REG_LOCK_MIN}분간 가입이 제한됩니다.`
        : '초대코드가 올바르지 않습니다.',
    }
  }

  // 계정 생성도 서버에서 수행 (이메일 확인 없이 즉시 사용)
  const { error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name, phone },
  })

  if (createError) {
    const msg = createError.message || ''
    if (/already|exists|registered|duplicate/i.test(msg)) {
      return { ok: false, error: '이미 사용 중인 이메일입니다.' }
    }
    console.error('[registerUser] createUser failed:', msg)
    return { ok: false, error: '계정을 생성하지 못했습니다. 잠시 후 다시 시도해주세요.' }
  }

  await clearAttempt(regKey)
  return { ok: true, error: null }
}

// ── 로그인 (실패 횟수 누적 · 5회 실패 시 잠금) ───────────────────────

export async function loginUser(input: {
  email: string
  password: string
}): Promise<{ ok: boolean; error: string | null }> {
  const email = sanitizeLine(input?.email ?? '', 320).toLowerCase()
  const password = input?.password ?? ''
  // 실패 메시지는 계정 존재 여부를 노출하지 않도록 통일
  const GENERIC = '이메일 또는 비밀번호가 올바르지 않습니다.'

  if (!email || !password) return { ok: false, error: GENERIC }

  const key = `login:${email}`
  const rec = await getAttempt(key)
  const left = lockedMinutesLeft(rec)
  if (left > 0) {
    return { ok: false, error: `로그인 시도가 ${LOGIN_MAX_FAIL}회 실패하여 계정이 잠겼습니다. ${left}분 후 다시 시도해주세요.` }
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword({ email, password })

  if (error) {
    const { locked } = await registerFail(key, rec, LOGIN_MAX_FAIL, LOGIN_LOCK_MIN)
    // 실패 메시지 통일 — 계정 존재 여부·남은 시도 횟수 등 부가 정보를 노출하지 않는다
    return {
      ok: false,
      error: locked
        ? `로그인 ${LOGIN_MAX_FAIL}회 실패로 계정이 ${LOGIN_LOCK_MIN}분간 잠겼습니다.`
        : GENERIC,
    }
  }

  if (rec) await clearAttempt(key)
  return { ok: true, error: null }
}
