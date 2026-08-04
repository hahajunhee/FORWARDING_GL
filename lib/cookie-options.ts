// 인증 쿠키 보안 플래그 강제
//   HttpOnly : 스크립트(document.cookie)로 토큰을 읽지 못하게 하여 XSS 토큰 탈취 차단
//   Secure   : HTTPS 연결에서만 전송 (평문 구간 노출 차단) — 로컬 개발(http)에서는 제외
//   SameSite : 기본 lax 로 CSRF 완화
//   Path     : '/'
// ※ 인증은 전부 서버(Server Action·Server Component·미들웨어)에서 처리하므로
//    브라우저 JS가 이 쿠키를 읽을 필요가 없다.
export function secureCookieOptions(
  options: Record<string, unknown> | undefined
): Record<string, unknown> {
  return {
    ...(options ?? {}),
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: (options?.sameSite as string) ?? 'lax',
    path: (options?.path as string) ?? '/',
  }
}
