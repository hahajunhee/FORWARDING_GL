import { createClient } from '@/lib/supabase-server'
import { redirect } from 'next/navigation'
import SettingsClient from './SettingsClient'
import type { CustomList, Profile, ColumnDefinition } from '@/types'
import { DEFAULT_COLUMN_ORDER, DEFAULT_PINNED_COLUMNS } from '@/types'

export const dynamic = 'force-dynamic'

export default async function SettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [
    { data: customLists },
    { data: currentProfile },
    { data: columnDefinitions },
  ] = await Promise.all([
    supabase.from('custom_lists').select('*').order('list_type').order('sort_order').order('created_at'),
    supabase.from('profiles').select('*').eq('id', user.id).single(),
    supabase.from('column_definitions').select('*').order('display_order').order('created_at'),
  ])

  const profile = currentProfile as Profile | null

  return (
    <SettingsClient
      customLists={(customLists || []) as CustomList[]}
      columnOrder={profile?.column_order || DEFAULT_COLUMN_ORDER}
      pinnedColumns={profile?.pinned_columns || DEFAULT_PINNED_COLUMNS}
      columnDefinitions={(columnDefinitions || []) as ColumnDefinition[]}
      currentColor={profile?.color || null}
      currentName={profile?.name || ''}
      currentRegion={profile?.region || ''}
      currentCustomers={profile?.customers || ''}
    />
  )
}
