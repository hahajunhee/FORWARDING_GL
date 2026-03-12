import { createClient } from '@/lib/supabase-server'
import { redirect } from 'next/navigation'
import BookingPageLayout from '@/components/BookingPageLayout'
import type { Booking, Profile, CustomList, ColumnDefinition } from '@/types'

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
    { data: scheduleSettings },
    { data: regionSetting },
    { data: customerSetting },
    { data: baseDescSetting },
    { data: baseColLabelsSetting },
    { data: destSortSetting },
  ] = await Promise.all([
    supabase
      .from('bookings')
      .select(`id, booking_no, final_destination, discharge_port, carrier, vessel_name, voyage, secured_space, mqc, customer_doc_handler, forwarder_handler_id, doc_cutoff_date, proforma_etd, updated_etd, updated_etd_prev, eta, qty_20_normal, qty_20_dg, qty_20_reefer, qty_40_normal, qty_40_dg, qty_40_reefer, remarks, booking_entries, extra_data, created_by, created_at, updated_at, forwarder_handler:profiles!bookings_forwarder_handler_id_fkey(id, name, email, color, region, customers)`)
      .order('created_at', { ascending: false }),
    supabase.from('profiles').select('*').order('name'),
    supabase.from('profiles').select('*').eq('id', user.id).single(),
    supabase.from('custom_lists').select('*').order('sort_order').order('created_at'),
    supabase.from('column_definitions').select('*').order('display_order').order('created_at'),
    supabase.from('global_settings').select('value').eq('key', 'schedule_cols').single(),
    supabase.from('global_settings').select('value').eq('key', 'region_list').single(),
    supabase.from('global_settings').select('value').eq('key', 'customer_list').single(),
    supabase.from('global_settings').select('value').eq('key', 'base_col_descriptions').single(),
    supabase.from('global_settings').select('value').eq('key', 'base_col_labels').single(),
    supabase.from('global_settings').select('value').eq('key', 'destination_sort_order').single(),
  ])

  return (
    <BookingPageLayout
      bookings={(bookings || []) as unknown as Booking[]}
      profiles={(profiles || []) as Profile[]}
      currentUserId={user.id}
      currentUserEmail={user.email || ''}
      currentProfile={currentProfile as Profile}
      customLists={(customLists || []) as CustomList[]}
      customColumns={(columnDefinitions || []) as ColumnDefinition[]}
      initialScheduleCols={(scheduleSettings?.value as string[]) || null}
      regionList={(regionSetting?.value as string[] | null) || []}
      customerList={(customerSetting?.value as string[] | null) || []}
      baseColDescriptions={(baseDescSetting?.value as Record<string, string> | null) || {}}
      baseColLabels={(baseColLabelsSetting?.value as Record<string, string> | null) || {}}
      destinationSortOrder={(destSortSetting?.value as string[] | null) || []}
    />
  )
}
