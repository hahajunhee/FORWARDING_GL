import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'

// 미선적 현황 서버(gus-misunjeok)의 PDC×선사 잔량·예상 출하 집계를 전달한다.
// 미선적 서버가 이미 같은 데이터를 공개 페이지로 제공하므로 별도 키 없이 읽기 전용으로 호출한다.
const BASE = process.env.MISUNJEOK_API_BASE || 'https://gus-server.tailb40a03.ts.net'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  try {
    const r = await fetch(`${BASE.replace(/\/$/, '')}/api/capacity`, { cache: 'no-store', signal: AbortSignal.timeout(30000) })
    if (r.status === 404) return NextResponse.json({ error: '미선적 서버에 /api/capacity 가 아직 배포되지 않았습니다.' }, { status: 502 })
    if (!r.ok) return NextResponse.json({ error: `미선적 서버 응답 오류 (${r.status})` }, { status: 502 })
    return NextResponse.json(await r.json())
  } catch {
    return NextResponse.json({ error: '미선적 서버에 연결하지 못했습니다.' }, { status: 502 })
  }
}
