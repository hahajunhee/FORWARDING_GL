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

  const [{ data: profiles }, { data: inviteSetting }] = await Promise.all([
    supabase.from('profiles').select('*').order('created_at'),
    supabase.from('global_settings').select('value').eq('key', 'invite_code').single(),
  ])

  return (
    <AdminClient
      profiles={(profiles || []) as Profile[]}
      currentInviteCode={(inviteSetting?.value as string | null) || ''}
    />
  )
}
