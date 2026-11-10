import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'

// ONE Korea DOC/VGM 마감시간표(터미널 수집 서버가 2시간마다 갱신) 전달. API 키는 서버에만 둔다.
export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })
  const base = process.env.TERMINAL_API_BASE, key = process.env.TERMINAL_API_KEY
  if (!base || !key) return NextResponse.json({ error: 'TERMINAL_API_BASE / TERMINAL_API_KEY 환경변수가 설정되지 않았습니다.' }, { status: 503 })
  try {
    const r = await fetch(`${base.replace(/\/$/, '')}/api/onedoc`, { headers: { 'X-API-Key': key }, cache: 'no-store', signal: AbortSignal.timeout(15000) })
    if (!r.ok) return NextResponse.json({ error: `스케줄 서버 응답 오류 (${r.status})` }, { status: 502 })
    return NextResponse.json(await r.json())
  } catch {
    return NextResponse.json({ error: '스케줄 서버에 연결하지 못했습니다.' }, { status: 502 })
  }
}
