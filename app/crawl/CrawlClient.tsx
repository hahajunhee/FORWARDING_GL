'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import Link from 'next/link'

type CrawlStage = 'idle' | 'starting' | 'init' | 'driver' | 'browser' | 'navigate' | 'login' | 'iframe' | 'filter' | 'multiselect' | 'search' | 'export' | 'confirm' | 'waiting' | 'done' | 'error'
type Tab = 'crawl' | 'preview'

interface CrawlStatus {
  stage: CrawlStage
  progress: number
  message: string
  error: string
}

interface PreviewData {
  filename: string
  sheetName: string
  headers: string[]
  totalRows: number
  previewRows: number
  data: Record<string, unknown>[]
}

const DEFAULT_CODES = `B00MAL
B28AMI
B28VMI
B28AMM
B28VMD
B28AMP
B06AMC
B06VMC
B28AMU
B28VMF
B28AMH
B28AMN
B28VMC
B28VMH
B28AJZ
B28AMZ
B28VJH
B28VMZ
B28AMX
B28VMX
B28AMQ
B28VME
B28AMA
B28VMB
B00AAK
B00AAW
B00AAX
B00ABX
B00VAK
B00VAW
B00VAX
B00AAN
B00VAR
B28AMG
B28AML
B28VMA
B28VML
B28AMJ
B28VMJ
B28AMS
B28VMS
B06AMV
B06VMV
B06AMW
B06VMW
B06AMT
B06VMT
B28AMB
B06VMZ
B06AMZ

B06AMH`

const STAGE_LABELS: Record<string, string> = {
  idle: '대기',
  starting: '시작 준비',
  init: '초기화',
  driver: '드라이버 확인',
  browser: '브라우저 시작',
  navigate: 'SAP 접속',
  login: '로그인',
  iframe: '화면 로딩',
  filter: '필터 입력',
  multiselect: '코드 입력',
  search: '데이터 조회',
  export: '엑셀 내보내기',
  confirm: '다운로드 확인',
  waiting: '파일 다운로드',
  done: '완료',
  error: '오류',
}

export default function CrawlClient() {
  const [tab, setTab] = useState<Tab>('crawl')

  const [sapId, setSapId] = useState('')
  const [sapPw, setSapPw] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [dateFrom, setDateFrom] = useState('20250301')
  const [dateTo, setDateTo] = useState('20991010')
  const [codes, setCodes] = useState(DEFAULT_CODES)
  const [credSaved, setCredSaved] = useState(false)

  const [status, setStatus] = useState<CrawlStatus>({ stage: 'idle', progress: 0, message: '대기 중', error: '' })
  const [isRunning, setIsRunning] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const [preview, setPreview] = useState<PreviewData | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState('')

  useEffect(() => {
    const saved = localStorage.getItem('sap_credentials')
    if (saved) {
      try {
        const { id, pw } = JSON.parse(saved)
        setSapId(id || '')
        setSapPw(pw || '')
        if (id && pw) setCredSaved(true)
      } catch { /* ignore */ }
    }
  }, [])

  const saveCredentials = () => {
    localStorage.setItem('sap_credentials', JSON.stringify({ id: sapId, pw: sapPw }))
    setCredSaved(true)
  }

  const clearCredentials = () => {
    localStorage.removeItem('sap_credentials')
    setSapId('')
    setSapPw('')
    setCredSaved(false)
  }

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])

  const startPolling = useCallback(() => {
    stopPolling()
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch('/api/crawl/status')
        const data = await res.json()
        setStatus(data)
        if (data.stage === 'done' || data.stage === 'error') {
          setIsRunning(false)
          stopPolling()
        }
      } catch { /* ignore */ }
    }, 1000)
  }, [stopPolling])

  useEffect(() => () => stopPolling(), [stopPolling])

  const startCrawl = async () => {
    if (!sapId || !sapPw) return
    setIsRunning(true)
    setStatus({ stage: 'starting', progress: 0, message: '크롤링 시작 중...', error: '' })

    try {
      const res = await fetch('/api/crawl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: sapId,
          password: sapPw,
          dateFrom,
          dateTo,
          codes,
        }),
      })
      const data = await res.json()
      if (data.error) {
        setStatus({ stage: 'error', progress: 0, message: '', error: data.error })
        setIsRunning(false)
        return
      }
      startPolling()
    } catch (err) {
      setStatus({ stage: 'error', progress: 0, message: '', error: String(err) })
      setIsRunning(false)
    }
  }

  const loadPreview = async () => {
    setPreviewLoading(true)
    setPreviewError('')
    try {
      const res = await fetch('/api/crawl/preview')
      const data = await res.json()
      if (data.error) {
        setPreviewError(data.error)
      } else {
        setPreview(data)
        setTab('preview')
      }
    } catch (err) {
      setPreviewError(String(err))
    } finally {
      setPreviewLoading(false)
    }
  }

  const progressColor = status.stage === 'error' ? 'bg-red-500' : status.stage === 'done' ? 'bg-emerald-500' : 'bg-blue-500'

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/bookings" className="text-gray-400 hover:text-gray-600 transition-colors">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
            <h1 className="text-lg font-semibold text-gray-900">SAP 데이터 수집</h1>
            <span className="text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full font-medium">ZTMR0152</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setTab('crawl')}
              className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${tab === 'crawl' ? 'bg-gray-900 text-white' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'}`}
            >
              수집
            </button>
            <button
              onClick={() => { setTab('preview'); if (!preview) loadPreview() }}
              className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${tab === 'preview' ? 'bg-gray-900 text-white' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'}`}
            >
              미리보기
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">
        {tab === 'crawl' ? (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left: Credentials & Config */}
            <div className="lg:col-span-1 space-y-6">
              {/* Credential Card */}
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="px-5 py-4 border-b border-gray-100">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
                      <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                      </svg>
                    </div>
                    <div>
                      <h2 className="text-sm font-semibold text-gray-900">SAP 계정</h2>
                      <p className="text-xs text-gray-500">glove-tm.glovis.net</p>
                    </div>
                    {credSaved && (
                      <span className="ml-auto text-xs bg-emerald-50 text-emerald-600 px-2 py-0.5 rounded-full font-medium">저장됨</span>
                    )}
                  </div>
                </div>
                <div className="p-5 space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">아이디</label>
                    <input
                      type="text"
                      value={sapId}
                      onChange={e => { setSapId(e.target.value); setCredSaved(false) }}
                      placeholder="SAP 사용자 ID"
                      className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-colors"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">비밀번호</label>
                    <div className="relative">
                      <input
                        type={showPw ? 'text' : 'password'}
                        value={sapPw}
                        onChange={e => { setSapPw(e.target.value); setCredSaved(false) }}
                        placeholder="SAP 비밀번호"
                        className="w-full px-3 py-2 pr-10 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-colors"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPw(!showPw)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-1"
                      >
                        {showPw ? (
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L6.343 6.343m7.535 7.535l3.536 3.536M3 3l18 18" />
                          </svg>
                        ) : (
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                          </svg>
                        )}
                      </button>
                    </div>
                  </div>
                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={saveCredentials}
                      disabled={!sapId || !sapPw}
                      className="flex-1 px-3 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-40 transition-colors"
                    >
                      저장
                    </button>
                    {credSaved && (
                      <button
                        onClick={clearCredentials}
                        className="px-3 py-2 text-red-600 text-sm font-medium rounded-lg border border-red-200 hover:bg-red-50 transition-colors"
                      >
                        삭제
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Date Range Card */}
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="px-5 py-4 border-b border-gray-100">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-violet-50 flex items-center justify-center">
                      <svg className="w-4 h-4 text-violet-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                    </div>
                    <h2 className="text-sm font-semibold text-gray-900">출하일자 범위</h2>
                  </div>
                </div>
                <div className="p-5 space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">시작일</label>
                      <input
                        type="text"
                        value={dateFrom}
                        onChange={e => setDateFrom(e.target.value)}
                        placeholder="YYYYMMDD"
                        maxLength={8}
                        className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-colors"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">종료일</label>
                      <input
                        type="text"
                        value={dateTo}
                        onChange={e => setDateTo(e.target.value)}
                        placeholder="YYYYMMDD"
                        maxLength={8}
                        className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-colors"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Right: Codes & Action */}
            <div className="lg:col-span-2 space-y-6">
              {/* Booking Codes Card */}
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="px-5 py-4 border-b border-gray-100">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-lg bg-amber-50 flex items-center justify-center">
                        <svg className="w-4 h-4 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                        </svg>
                      </div>
                      <h2 className="text-sm font-semibold text-gray-900">부킹 코드</h2>
                    </div>
                    <span className="text-xs text-gray-400 font-mono">{codes.split('\n').filter(l => l.trim()).length}개</span>
                  </div>
                </div>
                <div className="p-5">
                  <textarea
                    value={codes}
                    onChange={e => setCodes(e.target.value)}
                    rows={12}
                    className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm font-mono leading-relaxed focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-colors resize-y"
                    placeholder="부킹 코드를 줄바꿈으로 구분하여 입력..."
                  />
                  <button
                    onClick={() => setCodes(DEFAULT_CODES)}
                    className="mt-2 text-xs text-gray-400 hover:text-gray-600 transition-colors"
                  >
                    기본값 복원
                  </button>
                </div>
              </div>

              {/* Progress & Action Card */}
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="p-5 space-y-4">
                  {/* Progress bar */}
                  {(isRunning || status.stage === 'done' || status.stage === 'error') && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-medium text-gray-700">
                          {STAGE_LABELS[status.stage] || status.stage}
                        </span>
                        <span className="text-gray-500 font-mono text-xs">{status.progress}%</span>
                      </div>
                      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-500 ease-out ${progressColor}`}
                          style={{ width: `${status.progress}%` }}
                        />
                      </div>
                      <p className="text-xs text-gray-500">{status.message}</p>
                      {status.error && (
                        <div className="mt-2 p-3 bg-red-50 border border-red-200 rounded-lg">
                          <p className="text-sm text-red-700 font-medium">오류 발생</p>
                          <p className="text-xs text-red-600 mt-1 font-mono break-all">{status.error}</p>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Action buttons */}
                  <div className="flex items-center gap-3">
                    <button
                      onClick={startCrawl}
                      disabled={isRunning || !sapId || !sapPw}
                      className={`flex-1 py-3 text-sm font-semibold rounded-xl transition-all duration-200 ${
                        isRunning
                          ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                          : !sapId || !sapPw
                            ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                            : 'bg-gray-900 text-white hover:bg-gray-800 active:scale-[0.99] shadow-sm'
                      }`}
                    >
                      {isRunning ? (
                        <span className="flex items-center justify-center gap-2">
                          <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                          </svg>
                          수집 진행 중...
                        </span>
                      ) : '엑셀 데이터 수집 시작'}
                    </button>

                    {status.stage === 'done' && (
                      <button
                        onClick={loadPreview}
                        disabled={previewLoading}
                        className="px-6 py-3 text-sm font-semibold rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 transition-colors shadow-sm"
                      >
                        {previewLoading ? '로딩...' : '결과 확인'}
                      </button>
                    )}
                  </div>

                  {!sapId && !sapPw && (
                    <p className="text-xs text-gray-400 text-center">SAP 계정을 먼저 등록해주세요</p>
                  )}

                  {previewError && (
                    <p className="text-xs text-red-500 text-center">{previewError}</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* Preview Tab */
          <PreviewPanel
            preview={preview}
            loading={previewLoading}
            error={previewError}
            onReload={loadPreview}
          />
        )}
      </main>
    </div>
  )
}

function PreviewPanel({
  preview,
  loading,
  error,
  onReload,
}: {
  preview: PreviewData | null
  loading: boolean
  error: string
  onReload: () => void
}) {
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set())
  const [selectAll, setSelectAll] = useState(false)

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <div className="text-center space-y-3">
          <svg className="w-8 h-8 animate-spin text-blue-500 mx-auto" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <p className="text-sm text-gray-500">엑셀 파일 로딩 중...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center py-32">
        <div className="text-center space-y-3">
          <div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center mx-auto">
            <svg className="w-6 h-6 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
          </div>
          <p className="text-sm text-gray-700">{error}</p>
          <button onClick={onReload} className="text-sm text-blue-600 hover:text-blue-800 font-medium">
            다시 시도
          </button>
        </div>
      </div>
    )
  }

  if (!preview) {
    return (
      <div className="flex items-center justify-center py-32">
        <div className="text-center space-y-3">
          <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mx-auto">
            <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <p className="text-sm text-gray-500">먼저 데이터를 수집해주세요</p>
          <button onClick={onReload} className="text-sm text-blue-600 hover:text-blue-800 font-medium">
            기존 파일 로드
          </button>
        </div>
      </div>
    )
  }

  const toggleAll = () => {
    if (selectAll) {
      setSelectedRows(new Set())
    } else {
      setSelectedRows(new Set(preview.data.map((_, i) => i)))
    }
    setSelectAll(!selectAll)
  }

  const toggleRow = (idx: number) => {
    const next = new Set(selectedRows)
    if (next.has(idx)) next.delete(idx)
    else next.add(idx)
    setSelectedRows(next)
    setSelectAll(next.size === preview.data.length)
  }

  return (
    <div className="space-y-4">
      {/* File Info Bar */}
      <div className="bg-white rounded-xl border border-gray-200 px-5 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-emerald-50 flex items-center justify-center">
            <svg className="w-4 h-4 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-medium text-gray-900">{preview.filename}</p>
            <p className="text-xs text-gray-500">
              시트: {preview.sheetName} &middot; {preview.totalRows}행 &middot; {preview.headers.length}열
              {preview.previewRows < preview.totalRows && ` (상위 ${preview.previewRows}행 표시)`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {selectedRows.size > 0 && (
            <span className="text-xs bg-blue-50 text-blue-600 px-2 py-1 rounded-full font-medium">
              {selectedRows.size}행 선택
            </span>
          )}
          <button onClick={onReload} className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </div>
      </div>

      {/* Data Table */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto max-h-[70vh]">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 sticky top-0 z-10">
              <tr>
                <th className="w-10 px-3 py-3 border-b border-gray-200">
                  <input
                    type="checkbox"
                    checked={selectAll}
                    onChange={toggleAll}
                    className="w-3.5 h-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                </th>
                <th className="w-10 px-3 py-3 text-left text-xs font-semibold text-gray-500 uppercase border-b border-gray-200">#</th>
                {preview.headers.map(h => (
                  <th key={h} className="px-3 py-3 text-left text-xs font-semibold text-gray-500 uppercase border-b border-gray-200 whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {preview.data.map((row, idx) => (
                <tr
                  key={idx}
                  className={`hover:bg-blue-50/50 transition-colors cursor-pointer ${selectedRows.has(idx) ? 'bg-blue-50/70' : ''}`}
                  onClick={() => toggleRow(idx)}
                >
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={selectedRows.has(idx)}
                      onChange={() => toggleRow(idx)}
                      onClick={e => e.stopPropagation()}
                      className="w-3.5 h-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-400 font-mono">{idx + 1}</td>
                  {preview.headers.map(h => (
                    <td key={h} className="px-3 py-2 text-gray-700 whitespace-nowrap max-w-[200px] truncate">
                      {String(row[h] ?? '')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
