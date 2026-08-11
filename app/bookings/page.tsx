import { createClient } from '@/lib/supabase-server'
import { redirect } from 'next/navigation'
import BookingPageLayout from '@/components/BookingPageLayout'
import type { Booking, Profile, CustomList, ColumnDefinition, ShanghaiMgmtRow, ScheduleDestGroup } from '@/types'

export const dynamic = 'force-dynamic'

export default async function BookingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [
    { data: bookings },
    { data: profiles },
    { data: currentProfile },
    { data: customLists },
    { data: columnDefinitions },
    { data: destGroupSetting },
    { data: regionSetting },
    { data: customerSetting },
    { data: baseDescSetting },
    { data: baseColLabelsSetting },
    { data: destSortSetting },
    { data: shanghaiRows },
    { data: seqRows },
    { data: prevPortsSetting },
    { data: allocRows },
    { data: closedRows },
    { data: ciRows },
    { data: blankWeekSetting },
    { data: etdHistRows },
    { data: securedBaseSetting },
    { data: teamTruckSetting },
  ] = await Promise.all([
    supabase
      .from('bookings')
      .select(`id, booking_no, final_destination, discharge_port, carrier, vessel_name, voyage, secured_space, mqc, customer_doc_handler, forwarder_handler_id, doc_cutoff_date, proforma_etd, updated_etd, updated_etd_prev, eta, qty_20_normal, qty_20_dg, qty_20_reefer, qty_40_normal, qty_40_dg, qty_40_reefer, con_pickup_qty, remarks, booking_entries, extra_data, created_by, created_at, updated_at, forwarder_handler:profiles!bookings_forwarder_handler_id_fkey(id, name, email, color, region, customers)`)
      .order('created_at', { ascending: false }),
    supabase.from('profiles').select('*').order('name'),
    supabase.from('profiles').select('*').eq('id', user.id).single(),
    supabase.from('custom_lists').select('*').order('sort_order').order('created_at'),
    supabase.from('column_definitions').select('*').order('display_order').order('created_at'),
    supabase.from('global_settings').select('value').eq('key', 'schedule_dest_groups').single(),
    supabase.from('global_settings').select('value').eq('key', 'region_list').single(),
    supabase.from('global_settings').select('value').eq('key', 'customer_list').single(),
    supabase.from('global_settings').select('value').eq('key', 'base_col_descriptions').single(),
    supabase.from('global_settings').select('value').eq('key', 'base_col_labels').single(),
    supabase.from('global_settings').select('value').eq('key', 'destination_sort_order').single(),
    supabase.from('shanghai_mgmt').select('*').order('sort_order').order('created_at'),
    // seq_no(고유번호)는 별도 조회로 병합 — 마이그레이션 미적용 시에도 부킹장이 깨지지 않도록 방어
    supabase.from('bookings').select('id, seq_no'),
    supabase.from('global_settings').select('value').eq('key', 'shanghai_prev_ports').single(),
    // alloc_qty(배분수량)도 별도 조회 — 마이그레이션 미적용 시 무시
    supabase.from('bookings').select('id, alloc_qty'),
    // is_closed(마감완료)도 별도 조회 — 마이그레이션 미적용 시 무시
    supabase.from('bookings').select('id, is_closed'),
    // CI 업로드 열도 별도 조회 — 마이그레이션 미적용 시 무시
    supabase.from('bookings').select('id, ci_qty, ci_dest, ci_vessel'),
    supabase.from('global_settings').select('value').eq('key', 'schedule_blank_weeks').single(),
    // ETD 스냅샷도 별도 조회 — 마이그레이션 미적용 시 무시
    supabase.from('bookings').select('id, etd_history'),
    supabase.from('global_settings').select('value').eq('key', 'secured_base_settings').single(),
    supabase.from('global_settings').select('value').eq('key', 'team_truck_dests').single(),
  ])

  // seq_no·alloc_qty 병합 (컬럼 없거나 오류 시 무시)
  const seqMap = new Map<string, number>()
  for (const r of (seqRows || []) as { id: string; seq_no: number | null }[]) {
    if (r.seq_no != null) seqMap.set(r.id, r.seq_no)
  }
  const allocMap = new Map<string, number>()
  for (const r of (allocRows || []) as { id: string; alloc_qty: number | null }[]) {
    if (r.alloc_qty != null) allocMap.set(r.id, r.alloc_qty)
  }
  const closedMap = new Map<string, boolean>()
  for (const r of (closedRows || []) as { id: string; is_closed: boolean | null }[]) {
    if (r.is_closed != null) closedMap.set(r.id, r.is_closed)
  }
  const ciMap = new Map<string, { ci_qty: string | null; ci_dest: string | null; ci_vessel: string | null }>()
  for (const r of (ciRows || []) as { id: string; ci_qty: string | null; ci_dest: string | null; ci_vessel: string | null }[]) {
    ciMap.set(r.id, r)
  }
  const etdHistMap = new Map<string, Record<string, string>>()
  for (const r of (etdHistRows || []) as { id: string; etd_history: Record<string, string> | null }[]) {
    if (r.etd_history) etdHistMap.set(r.id, r.etd_history)
  }
  const bookingsWithSeq = ((bookings || []) as unknown as Booking[]).map(b => ({
    ...b,
    seq_no: seqMap.get(b.id) ?? b.seq_no,
    alloc_qty: allocMap.get(b.id) ?? null,
    is_closed: closedMap.get(b.id) ?? null,
    ci_qty: ciMap.get(b.id)?.ci_qty ?? null,
    ci_dest: ciMap.get(b.id)?.ci_dest ?? null,
    ci_vessel: ciMap.get(b.id)?.ci_vessel ?? null,
    etd_history: etdHistMap.get(b.id) ?? null,
  }))

  return (
    <BookingPageLayout
      bookings={bookingsWithSeq}
      profiles={(profiles || []) as Profile[]}
      currentUserId={user.id}
      currentUserEmail={user.email || ''}
      currentProfile={currentProfile as Profile}
      customLists={(customLists || []) as CustomList[]}
      customColumns={(columnDefinitions || []) as ColumnDefinition[]}
      scheduleDestGroups={(destGroupSetting?.value as ScheduleDestGroup[] | null) || []}
      scheduleBlankWeeks={(blankWeekSetting?.value as Record<string, number[]> | null) || {}}
      securedBases={(securedBaseSetting?.value as Record<string, { mqc: number; secured: number }> | null) || {}}
      teamTruckDests={(teamTruckSetting?.value as string[] | null) || []}
      regionList={(regionSetting?.value as string[] | null) || []}
      customerList={(customerSetting?.value as string[] | null) || []}
      baseColDescriptions={(baseDescSetting?.value as Record<string, string> | null) || {}}
      baseColLabels={(baseColLabelsSetting?.value as Record<string, string> | null) || {}}
      destinationSortOrder={(destSortSetting?.value as string[] | null) || []}
      shanghaiRows={(shanghaiRows || []) as ShanghaiMgmtRow[]}
      shanghaiPrevPorts={(prevPortsSetting?.value as string[] | null) || []}
    />
  )
}
