'use client'

import { useState } from 'react'
import Link from 'next/link'
import BookingTable from './BookingTable'
import VesselTable from './VesselTable'
import DocCutoffTab from './DocCutoffTab'
import ReeferCutoffTab from './ReeferCutoffTab'
import ScheduleTab from './ScheduleTab'
import ShanghaiMgmtTab from './ShanghaiMgmtTab'
import { signOut } from '@/app/bookings/actions'
import type { Booking, Profile, CustomList, ColumnDefinition, ShanghaiMgmtRow } from '@/types'
import { DEFAULT_PINNED_COLUMNS, DEFAULT_TABLE_STYLE } from '@/types'

type Tab = 'bookings' | 'vessel' | 'doc_cutoff' | 'reefer_cutoff' | 'schedule' | 'shanghai'

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
  baseColLabels?: Record<string, string>
  destinationSortOrder?: string[]
  shanghaiRows?: ShanghaiMgmtRow[]
  shanghaiPrevPorts?: string[]
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
    key: 'vessel',
    label: '부킹장(모선)',
    sub: '모선 단위 병합',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M4 7h16M4 12h16M4 17h7" />
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
    key: 'reefer_cutoff',
    label: '리퍼마감메일',
    sub: '부킹번호 조회',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
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
  {
    key: 'shanghai',
    label: '상해발관리',
    sub: '고유번호 집중관리',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
      </svg>
    ),
  },
]

const MASTER_EMAIL = 'hahajunhee@glovis.net'

export default function BookingPageLayout({
  bookings, profiles, currentUserId, currentUserEmail, currentProfile, customLists, customColumns, initialScheduleCols,
  regionList, customerList, baseColDescriptions, baseColLabels = {}, destinationSortOrder = [], shanghaiRows = [], shanghaiPrevPorts = [],
}: Props) {
  const isMaster = currentUserEmail === MASTER_EMAIL
  const [activeTab, setActiveTab] = useState<Tab>('bookings')
  const [sidebarOpen, setSidebarOpen] = useState(false) // 모바일 드로어

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
    <div className="h-screen overflow-hidden bg-slate-50 flex flex-col">
      {/* 헤더 */}
      <header className="bg-white/85 backdrop-blur-md border-b border-slate-200/80 sticky top-0 z-30 flex-shrink-0">
        <div className="px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => setSidebarOpen(v => !v)}
              className="md:hidden p-1.5 -ml-1 text-gray-500 hover:bg-gray-100 rounded-lg transition-colors flex-shrink-0"
              aria-label="메뉴">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <div className="w-9 h-9 bg-gradient-to-br from-indigo-500 via-indigo-600 to-blue-700 rounded-xl flex items-center justify-center flex-shrink-0 shadow-md shadow-indigo-500/30">
              <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <div>
              <h1 className="text-base font-bold text-slate-900 tracking-tight leading-tight">부킹 관리</h1>
              <p className="text-[11px] text-slate-400 leading-tight">{currentProfile?.name || ''}</p>
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
        {/* 모바일: 드로어 열림 시 배경 */}
        {sidebarOpen && (
          <div className="fixed inset-0 bg-black/30 z-30 md:hidden" onClick={() => setSidebarOpen(false)} />
        )}
        {/* 왼쪽 사이드바 — 모바일에서는 햄버거로 여닫는 드로어 */}
        <aside className={`w-44 flex-shrink-0 bg-white border-r border-gray-200 top-[57px] h-[calc(100vh-57px)] overflow-y-auto ${
          sidebarOpen ? 'fixed left-0 z-40 shadow-xl' : 'hidden'
        } md:block md:sticky md:z-auto md:shadow-none`}>
          <nav className="p-2 space-y-1 pt-3">
            {TABS.map(tab => {
              const isActive = activeTab === tab.key
              return (
                <button
                  key={tab.key}
                  onClick={() => { setActiveTab(tab.key); setSidebarOpen(false) }}
                  className={`w-full flex items-start gap-2.5 px-3 py-2.5 rounded-xl text-left transition-all group relative ${
                    isActive
                      ? 'bg-gradient-to-r from-indigo-600 to-blue-600 text-white shadow-lg shadow-indigo-500/25'
                      : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  <span className={`flex-shrink-0 mt-0.5 ${isActive ? 'text-white' : 'text-slate-400 group-hover:text-slate-600'}`}>
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
                    <div className={`text-xs leading-tight mt-0.5 ${isActive ? 'text-indigo-200' : 'text-slate-400'}`}>
                      {tab.sub}
                    </div>
                  </div>
                </button>
              )
            })}
          </nav>

          {/* 사이드바 하단 */}
          <div className="absolute bottom-0 left-0 right-0 p-3 border-t border-slate-100">
            <div className="text-[11px] text-slate-400 text-center bg-slate-50 rounded-lg py-1.5 font-medium">
              총 <span className="text-indigo-600 font-bold">{bookings.length}</span>건 등록
            </div>
          </div>
        </aside>

        {/* 메인 컨텐츠 */}
        <main className="flex-1 min-w-0 overflow-hidden flex flex-col">
          {activeTab === 'bookings' && (
            <div className="flex-1 min-h-0 flex flex-col p-2 md:p-4">
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
                baseColLabels={baseColLabels}
                destinationSortOrder={destinationSortOrder}
                tableStyle={currentProfile?.table_style || DEFAULT_TABLE_STYLE}
              />
            </div>
          )}
          {activeTab === 'vessel' && (
            <div className="flex-1 overflow-auto p-2 md:p-4 space-y-3">
              <div>
                <h2 className="text-lg font-bold text-gray-900">부킹장(모선)</h2>
                <p className="text-sm text-gray-500">선사·모선명·VOYAGE가 같은 부킹을 한 행으로 병합해 관리합니다. 편집·저장 시 부킹장에 그대로 반영됩니다.</p>
              </div>
              <VesselTable bookings={bookings} profiles={profiles} customLists={customLists} currentUserId={currentUserId} regionList={regionList} customerList={customerList} />
            </div>
          )}
          {activeTab === 'doc_cutoff' && (
            <div className="flex-1 overflow-auto p-2 md:p-4 space-y-3">
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
          {activeTab === 'reefer_cutoff' && (
            <div className="flex-1 overflow-auto p-2 md:p-4 space-y-3">
              <div>
                <h2 className="text-lg font-bold text-gray-900">리퍼마감메일</h2>
                <p className="text-sm text-gray-500">부킹번호를 입력하면 부킹 정보를 조회하여 메일용 테이블을 생성합니다.</p>
              </div>
              <ReeferCutoffTab bookings={bookings} />
            </div>
          )}
          {activeTab === 'schedule' && (
            <div className="flex-1 overflow-auto p-2 md:p-4 space-y-3">
              <div>
                <h2 className="text-lg font-bold text-gray-900">주요 스케줄</h2>
                <p className="text-sm text-gray-500">고객사 송부용 스케줄을 열 구성 후 Excel로 다운로드합니다.</p>
              </div>
              <ScheduleTab bookings={bookings} customColumns={customColumns} initialScheduleCols={initialScheduleCols} destinationSortOrder={destinationSortOrder} />
            </div>
          )}
          {activeTab === 'shanghai' && (
            <div className="flex-1 overflow-auto p-2 md:p-4 space-y-3">
              <div>
                <h2 className="text-lg font-bold text-gray-900">상해발관리</h2>
                <p className="text-sm text-gray-500">부킹장의 고유번호로 집중관리 대상을 추가하고, MPA 주요 PDC 스케줄 현황 보고서를 Excel로 다운로드합니다.</p>
              </div>
              <ShanghaiMgmtTab bookings={bookings} initialRows={shanghaiRows} initialPrevPorts={shanghaiPrevPorts} />
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
