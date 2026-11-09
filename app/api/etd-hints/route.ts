import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase-server'
import { fetchCandidatesBatch } from '@/lib/terminal-schedule'

// 부킹장 표의 "+3" 표시용 후보 조회.
// 서버 액션은 요청이 한 줄로 직렬 실행되어 저장·편집을 막을 수 있으므로 일반 API 라우트로 둔다.
export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as { vessels?: string[] }
  const vessels = (body.vessels || []).filter(v => typeof v === 'string' && v.trim()).slice(0, 600)
  if (vessels.length === 0) return NextResponse.json({ byKey: {} })

  const { byKey, error } = await fetchCandidatesBatch(vessels)
  const out: Record<string, { s: string; e: string; t: string | null; v: string | null }[]> = {}
  for (const [k, list] of Object.entries(byKey)) {
    out[k] = list.filter(c => c.etd).map(c => ({
      s: c.source, e: (c.etd as string).slice(0, 10), t: (c.etd as string).slice(11, 16) || null, v: c.terminal_voyage,
    }))
  }
  return NextResponse.json({ byKey: out, error: error || null })
}
