'use client'

import { useState } from 'react'
import Link from 'next/link'
import BookingTable from './BookingTable'
import DocCutoffTab from './DocCutoffTab'
import ScheduleTab from './ScheduleTab'
import { signOut } from '@/app/bookings/actions'
import type { Booking, Profile, CustomList, ColumnDefinition } from '@/types'
import { DEFAULT_PINNED_COLUMNS } from '@/types'

type Tab = 'bookings' | 'doc_cutoff' | 'schedule'

interface Props {
  bookings: Booking[]
  profiles: Profile[]
  currentUserId: string
  currentUserEmail: string
  currentProfile: Profile | null
  customLists: CustomList[]
  customColumns: ColumnDefinition[]
  initialScheduleCols: string[] | null
  regionList: string[]
  customerList: string[]
  baseColDescriptions: Record<string, string>
}

const TABS: { key: Tab; label: string; sub: string; icon: React.ReactNode }[] = [
  {
    key: 'bookings',
    label: '부킹장',
    sub: '조회·편집',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    ),
  },
  {
    key: 'doc_cutoff',
    label: '서류마감',
    sub: '메일 초안',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
    ),
  },
  {
    key: 'schedule',
    label: '주요 스케줄',
    sub: '고객사 송부',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
      </svg>
    ),
  },
]

const MASTER_EMAIL = 'hahajunhee@glovis.net'

export default function BookingPageLayout({
  bookings, profiles, currentUserId, currentUserEmail, currentProfile, customLists, customColumns, initialScheduleCols,
  regionList, customerList, baseColDescriptions,
}: Props) {
  const isMaster = currentUserEmail === MASTER_EMAIL
  const [activeTab, setActiveTab] = useState<Tab>('bookings')

  const pinnedColumns = currentProfile?.pinned_columns || DEFAULT_PINNED_COLUMNS
  const docTemplate = currentProfile?.doc_template || null

  // 서류마감 D-3 건수 (탭 뱃지용)
  const d3Count = bookings.filter(b => {
    if (!b.doc_cutoff_date) return false
    try {
      const d = new Date(b.doc_cutoff_date)
      const diff = Math.ceil((d.getTime() - new Date().setHours(0, 0, 0, 0)) / 86400000)
      return diff >= 0 && diff <= 3
    } catch { return false }
  }).length

  return (
    <div className="h-screen overflow-hidden bg-gray-50 flex flex-col">
      {/* 헤더 */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-30 flex-shrink-0">
        <div className="px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center flex-shrink-0">
              <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <div>
              <h1 className="text-base font-bold text-gray-900">부킹 관리</h1>
              <p className="text-xs text-gray-400">{currentProfile?.name || ''}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isMaster && (
              <Link href="/admin"
                className="p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                title="관리자">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
              </Link>
            )}
            <Link href="/settings"
              className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              title="설정">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </Link>
            <form action={signOut}>
              <button type="submit" className="btn-secondary text-sm">로그아웃</button>
            </form>
          </div>
        </div>
      </header>

      {/* 본문 = 사이드바 + 컨텐츠 */}
      <div className="flex flex-1 min-h-0">
        {/* 왼쪽 사이드바 */}
        <aside className="w-44 flex-shrink-0 bg-white border-r border-gray-200 sticky top-[57px] h-[calc(100vh-57px)] overflow-y-auto">
          <nav className="p-2 space-y-1 pt-3">
            {TABS.map(tab => {
              const isActive = activeTab === tab.key
              return (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`w-full flex items-start gap-2.5 px-3 py-2.5 rounded-lg text-left transition-colors group relative ${
                    isActive
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  <span className={`flex-shrink-0 mt-0.5 ${isActive ? 'text-white' : 'text-gray-400 group-hover:text-gray-600'}`}>
                    {tab.icon}
                  </span>
                  <div>
                    <div className="text-sm font-medium leading-tight flex items-center gap-1.5">
                      {tab.label}
                      {tab.key === 'doc_cutoff' && d3Count > 0 && (
                        <span className={`text-xs px-1.5 py-0.5 rounded-full font-bold leading-none ${
                          isActive ? 'bg-white/20 text-white' : 'bg-red-100 text-red-700'
                        }`}>{d3Count}</span>
                      )}
                    </div>
                    <div className={`text-xs leading-tight mt-0.5 ${isActive ? 'text-blue-200' : 'text-gray-400'}`}>
                      {tab.sub}
                    </div>
                  </div>
                </button>
              )
            })}
          </nav>

          {/* 사이드바 하단 */}
          <div className="absolute bottom-0 left-0 right-0 p-3 border-t border-gray-100">
            <div className="text-xs text-gray-400 text-center">
              {bookings.length}건 등록
            </div>
          </div>
        </aside>

        {/* 메인 컨텐츠 */}
        <main className="flex-1 min-w-0 overflow-hidden flex flex-col">
          {activeTab === 'bookings' && (
            <div className="flex-1 min-h-0 flex flex-col p-4">
              <BookingTable
                bookings={bookings}
                profiles={profiles}
                currentUserId={currentUserId}
                currentProfile={currentProfile}
                customLists={customLists}
                pinnedColumns={pinnedColumns}
                customColumns={customColumns}
                regionList={regionList}
                customerList={customerList}
                baseColDescriptions={baseColDescriptions}
              />
            </div>
          )}
          {activeTab === 'doc_cutoff' && (
            <div className="flex-1 overflow-auto p-4 space-y-3">
              <div>
                <h2 className="text-lg font-bold text-gray-900">서류마감</h2>
                <p className="text-sm text-gray-500">날짜를 선택하면 해당 날짜 마감 부킹의 메일 초안을 자동 생성합니다.</p>
              </div>
              <DocCutoffTab
                bookings={bookings}
                initialTemplate={docTemplate}
                customColumns={customColumns}
                profiles={profiles}
                currentUserId={currentUserId}
              />
            </div>
          )}
          {activeTab === 'schedule' && (
            <div className="flex-1 overflow-auto p-4 space-y-3">
              <div>
                <h2 className="text-lg font-bold text-gray-900">주요 스케줄</h2>
                <p className="text-sm text-gray-500">고객사 송부용 스케줄을 열 구성 후 Excel로 다운로드합니다.</p>
              </div>
              <ScheduleTab bookings={bookings} customColumns={customColumns} initialScheduleCols={initialScheduleCols} />
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
