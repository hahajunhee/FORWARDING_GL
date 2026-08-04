import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { secureCookieOptions } from './cookie-options'

// Next.js 15+ - cookies()는 비동기 API
export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(
          cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]
        ) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              // 인증 쿠키에 HttpOnly·Secure 강제
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              cookieStore.set(name, value, secureCookieOptions(options) as any)
            )
          } catch {
            // Server Component에서 쿠키 설정 실패 시 무시
          }
        },
      },
    }
  )
}
