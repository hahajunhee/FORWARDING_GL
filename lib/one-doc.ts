// ONE Korea DOC/VGM 마감시간표 ↔ 부킹장 서류마감 열 비교 (브라우저·서버 공용 순수 함수)
import { dayDiff } from '@/lib/etd-hint'

export interface OneDocRow {
  vessel: string; voyage: string; lane: string; pol: string
  etb: string | null; etd: string | null
  doc_date: string | null; doc_time: string | null; doc_raw: string
}

export type DocHintKind = 'diff' | 'same' | 'closed' | 'pending' | 'notfound' | 'fill'
export interface DocHint {
  kind: DocHintKind
  diff?: number       // 사이트 DOC 마감일 - 부킹장 서류마감 (일)
  label: string       // 배지 글자
  tip: string         // 마우스 올렸을 때 설명
}

const norm = (s: string | null | undefined) => (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '')

export function buildOneDocIndex(rows: OneDocRow[]): Map<string, OneDocRow[]> {
  const m = new Map<string, OneDocRow[]>()
  for (const r of rows) {
    const k = norm(r.vessel)
    if (!k) continue
    if (!m.has(k)) m.set(k, [])
    m.get(k)!.push(r)
  }
  return m
}

interface B { carrier: string; vessel_name: string; voyage: string; doc_cutoff_date: string | null; updated_etd: string | null; proforma_etd: string | null }

/** 대상 아님(ONE이 아니거나 이미 지난 건)이면 null. 대상이면 항상 상태 하나를 돌려준다(차이없음/미조회 구분). */
export function oneDocHint(b: B, idx: Map<string, OneDocRow[]>, today: string): DocHint | null {
  if (norm(b.carrier) !== 'ONE') return null
  const refEtd = b.updated_etd || b.proforma_etd
  if (b.doc_cutoff_date ? b.doc_cutoff_date < today : !(refEtd && refEtd >= today)) return null
  if (!norm(b.vessel_name)) return { kind: 'notfound', label: '미조회', tip: 'ONE 마감표 미조회 — 모선명이 비어 있습니다.' }

  const list = idx.get(norm(b.vessel_name))
  if (!list || list.length === 0) {
    return { kind: 'notfound', label: '미조회', tip: `ONE 마감표에서 "${b.vessel_name}" 를 찾지 못했습니다.\n모선명 철자 오류·모선 변경·아직 시트에 미등록일 수 있습니다.` }
  }
  // 같은 모선의 여러 항차 중: 항차 일치 → 없으면 ETD가 가장 가까운 것(±10일)
  let row: OneDocRow | undefined
  const bv = norm(b.voyage)
  if (bv) row = list.find(r => norm(r.voyage) === bv || (bv.length >= 3 && norm(r.voyage).endsWith(bv)))
  if (!row && refEtd) {
    const near = list.filter(r => r.etd).sort((x, y) => Math.abs(dayDiff(refEtd, x.etd!)) - Math.abs(dayDiff(refEtd, y.etd!)))[0]
    if (near && Math.abs(dayDiff(refEtd, near.etd!)) <= 10) row = near
  }
  if (!row && list.length === 1 && !refEtd) row = list[0]
  if (!row) {
    return { kind: 'notfound', label: '미조회', tip: `ONE 마감표에 "${b.vessel_name}" 모선은 있으나 해당 항차(ETD)가 없습니다.\n시트 항차: ${list.map(r => `${r.voyage} ETD ${r.etd || '-'}`).join(', ')}` }
  }
  const head = `ONE ${row.vessel} ${row.voyage}  ETD ${row.etd || '-'}`
  if (row.doc_date) {
    const when = `${row.doc_date}${row.doc_time ? ' ' + row.doc_time : ''}`
    if (!b.doc_cutoff_date) return { kind: 'fill', label: row.doc_date.slice(5), tip: `${head}\n사이트 DOC/VGM 마감: ${when}\n(부킹장 서류마감이 비어 있습니다)` }
    const diff = dayDiff(b.doc_cutoff_date, row.doc_date)
    if (diff === 0) return { kind: 'same', label: '✓', tip: `${head}\n사이트 DOC/VGM 마감: ${when}\n부킹장 서류마감과 같습니다.` }
    return { kind: 'diff', diff, label: `${diff > 0 ? '+' : ''}${diff}`, tip: `${head}\n사이트 DOC/VGM 마감: ${when}\n부킹장 ${b.doc_cutoff_date} 대비 ${diff > 0 ? '+' : ''}${diff}일` }
  }
  if ((row.doc_raw || '').includes('마감')) return { kind: 'closed', label: '마감', tip: `${head}\n사이트에서 이미 "마감" 처리된 모선입니다.` }
  return { kind: 'pending', label: '미정', tip: `${head}\n사이트: ${row.doc_raw || '마감시간 미공지'}` }
}
