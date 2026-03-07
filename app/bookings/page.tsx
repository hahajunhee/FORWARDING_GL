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
  ] = await Promise.all([
    supabase
      .from('bookings')
      .select(`*, forwarder_handler:profiles!bookings_forwarder_handler_id_fkey(id, name, email, color)`)
      .order('created_at', { ascending: false }),
    supabase.from('profiles').select('*').order('name'),
    supabase.from('profiles').select('*').eq('id', user.id).single(),
    supabase.from('custom_lists').select('*').order('sort_order').order('created_at'),
    supabase.from('column_definitions').select('*').order('display_order').order('created_at'),
    supabase.from('global_settings').select('value').eq('key', 'schedule_cols').single(),
  ])

  return (
    <BookingPageLayout
      bookings={(bookings || []) as Booking[]}
      profiles={(profiles || []) as Profile[]}
      currentUserId={user.id}
      currentProfile={currentProfile as Profile}
      customLists={(customLists || []) as CustomList[]}
      customColumns={(columnDefinitions || []) as ColumnDefinition[]}
      initialScheduleCols={(scheduleSettings?.value as string[]) || null}
    />
  )
}
