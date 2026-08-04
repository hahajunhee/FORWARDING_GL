// 비밀번호 복잡도 정책 (클라이언트 안내 + 서버 강제 — 동일 규칙 공유)
//   영문(대/소문자) · 숫자 · 특수문자 중
//   - 3가지 조합: 8자 이상
//   - 2가지 조합: 10자 이상
export const PASSWORD_RULE_TEXT =
  '영문·숫자·특수문자 중 3가지 조합 8자 이상, 또는 2가지 조합 10자 이상'

export function passwordPolicyError(password: string): string | null {
  const p = password ?? ''
  if (!p) return '비밀번호를 입력해주세요.'
  if (/\s/.test(p)) return '비밀번호에 공백은 사용할 수 없습니다.'
  if (p.length > 72) return '비밀번호는 72자 이하로 입력해주세요.'

  const kinds = [/[A-Za-z]/, /[0-9]/, /[^A-Za-z0-9]/].filter(re => re.test(p)).length
  if (kinds >= 3 && p.length >= 8) return null
  if (kinds >= 2 && p.length >= 10) return null
  return `비밀번호는 ${PASSWORD_RULE_TEXT}이어야 합니다.`
}

// 제어문자 제거 (CR/LF 등) — 메일 헤더 인젝션·로그 위변조 방지
export function sanitizeLine(v: string, maxLen = 200): string {
  let out = ''
  for (const ch of v ?? '') {
    const c = ch.codePointAt(0) ?? 0
    out += (c < 32 || c === 127) ? ' ' : ch
  }
  return out.trim().slice(0, maxLen)
}

// 이메일 형식 검증 (제어문자 포함 시 실패)
export function isValidEmail(email: string): boolean {
  const e = email ?? ''
  if (e !== sanitizeLine(e, 320)) return false
  return /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/.test(e) && e.length <= 320
}
