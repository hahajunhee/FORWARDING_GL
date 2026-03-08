import { createClient } from '@/lib/supabase-server'
import { redirect } from 'next/navigation'
import AdminClient from './AdminClient'
import type { Profile } from '@/types'

export const dynamic = 'force-dynamic'

const MASTER_EMAIL = 'hahajunhee@glovis.net'

export default async function AdminPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  if (user.email !== MASTER_EMAIL) redirect('/bookings')

  const [
    { data: profiles },
    { data: inviteSetting },
    { data: regionSetting },
    { data: customerSetting },
  ] = await Promise.all([
    supabase.from('profiles').select('*').order('created_at'),
    supabase.from('global_settings').select('value').eq('key', 'invite_code').single(),
    supabase.from('global_settings').select('value').eq('key', 'region_list').single(),
    supabase.from('global_settings').select('value').eq('key', 'customer_list').single(),
  ])

  return (
    <AdminClient
      profiles={(profiles || []) as Profile[]}
      currentInviteCode={(inviteSetting?.value as string | null) || ''}
      regionList={(regionSetting?.value as string[] | null) || []}
      customerList={(customerSetting?.value as string[] | null) || []}
    />
  )
}
