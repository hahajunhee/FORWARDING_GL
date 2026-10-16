// 대한민국 공휴일 (서류마감일 입력 시 주말·공휴일 경고용)
//  · 양력 고정일은 매년 자동 적용, 음력(설·추석·부처님오신날)과 대체공휴일은 연도별로 등록한다.
//  · 연도가 바뀌면 LUNAR_AND_SUBSTITUTE에 그 해 날짜를 추가하면 된다.

// 매년 반복되는 양력 공휴일 (MM-DD)
const FIXED: Record<string, string> = {
  '01-01': '신정',
  '03-01': '삼일절',
  '05-05': '어린이날',
  '06-06': '현충일',
  '08-15': '광복절',
  '10-03': '개천절',
  '10-09': '한글날',
  '12-25': '성탄절',
}

// 음력 기반 공휴일 + 대체공휴일 (YYYY-MM-DD)
const LUNAR_AND_SUBSTITUTE: Record<string, string> = {
  // 2026
  '2026-02-16': '설날 연휴',
  '2026-02-17': '설날',
  '2026-02-18': '설날 연휴',
  '2026-03-02': '삼일절 대체공휴일',
  '2026-05-24': '부처님오신날',
  '2026-05-25': '부처님오신날 대체공휴일',
  '2026-09-24': '추석 연휴',
  '2026-09-25': '추석',
  '2026-09-26': '추석 연휴',
  // 2027
  '2027-02-06': '설날 연휴',
  '2027-02-07': '설날',
  '2027-02-08': '설날 연휴',
  '2027-02-09': '설날 대체공휴일',
  '2027-05-13': '부처님오신날',
  '2027-06-07': '현충일 대체공휴일',
  '2027-08-16': '광복절 대체공휴일',
  '2027-09-14': '추석 연휴',
  '2027-09-15': '추석',
  '2027-09-16': '추석 연휴',
  '2027-10-04': '개천절 대체공휴일',
  '2027-10-11': '한글날 대체공휴일',
}

const DOW = ['일', '월', '화', '수', '목', '금', '토']

export type DayInfo = {
  label: string        // 요일 (월·화·…)
  isWeekend: boolean
  holiday: string | null
}

// 'YYYY-MM-DD' → 요일·주말·공휴일 정보 (형식이 아니면 null)
export function dayInfo(iso: string | null | undefined): DayInfo | null {
  if (!iso) return null
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return null
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3])
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null
  const dt = new Date(y, mo - 1, d)
  if (isNaN(dt.getTime()) || dt.getMonth() !== mo - 1) return null
  const dow = dt.getDay()
  return {
    label: DOW[dow],
    isWeekend: dow === 0 || dow === 6,
    holiday: LUNAR_AND_SUBSTITUTE[iso] || FIXED[`${m[2]}-${m[3]}`] || null,
  }
}
