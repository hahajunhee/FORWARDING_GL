'use client'

import { useState, useTransition } from 'react'
import { setUserActive, deleteUser, updateInviteCode } from './actions'
import type { Profile } from '@/types'

interface AdminClientProps {
  profiles: Profile[]
  currentInviteCode: string
}

export default function AdminClient({ profiles, currentInviteCode }: AdminClientProps) {
  const [newCode, setNewCode] = useState(currentInviteCode)
  const [codeSaving, setCodeSaving] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [codeError, setCodeError] = useState<string | null>(null)
  const [, startTransition] = useTransition()
  const [actionErrors, setActionErrors] = useState<Record<string, string>>({})
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)

  const setError = (userId: string, msg: string | null) =>
    setActionErrors(prev => msg ? { ...prev, [userId]: msg } : Object.fromEntries(Object.entries(prev).filter(([k]) => k !== userId)))

  const handleToggleActive = (userId: string, current: boolean) => {
    startTransition(async () => {
      const result = await setUserActive(userId, !current)
      if (result.error) setError(userId, result.error)
      else setError(userId, null)
    })
  }

  const handleDelete = (userId: string) => {
    startTransition(async () => {
      const result = await deleteUser(userId)
      if (result.error) setError(userId, result.error)
      else { setError(userId, null); setDeleteConfirmId(null) }
    })
  }

  const handleSaveCode = () => {
    setCodeError(null)
    setCodeSaving('saving')
    startTransition(async () => {
      const result = await updateInviteCode(newCode)
      if (result.error) { setCodeSaving('error'); setCodeError(result.error) }
      else { setCodeSaving('saved'); setTimeout(() => setCodeSaving('idle'), 2500) }
    })
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
          <a href="/bookings" className="text-gray-400 hover:text-gray-600 transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
          </a>
          <h1 className="text-base font-bold text-gray-900">관리자 페이지</h1>
          <span className="text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full font-medium">Master Only</span>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6 space-y-6">
        {/* 초대코드 관리 */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
          <div>
            <h2 className="text-sm font-bold text-gray-900">초대코드 관리</h2>
            <p className="text-xs text-gray-500 mt-0.5">회원가입 시 요구되는 초대코드입니다.</p>
          </div>
          <div className="flex items-center gap-3">
            <input
              type="text"
              value={newCode}
              onChange={e => setNewCode(e.target.value)}
              className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              onClick={handleSaveCode}
              disabled={codeSaving === 'saving'}
              className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors font-medium">
              {codeSaving === 'saving' ? '저장 중...' : '저장'}
            </button>
          </div>
          {codeSaving === 'saved' && <p className="text-xs text-green-600 font-medium">✓ 초대코드가 변경되었습니다.</p>}
          {codeSaving === 'error' && <p className="text-xs text-red-600">{codeError}</p>}
        </div>

        {/* 회원 목록 */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-200 flex items-center justify-between">
            <h2 className="text-sm font-bold text-gray-900">회원 목록</h2>
            <span className="text-xs text-gray-400">{profiles.length}명</span>
          </div>
          <div className="divide-y divide-gray-100">
            {profiles.map(profile => {
              const isActive = profile.is_active !== false
              const err = actionErrors[profile.id]
              return (
                <div key={profile.id} className={`px-5 py-3 ${!isActive ? 'bg-gray-50' : ''}`}>
                  <div className="flex items-center gap-3 flex-wrap">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`text-sm font-medium ${isActive ? 'text-gray-900' : 'text-gray-400 line-through'}`}>
                          {profile.name}
                        </span>
                        {!isActive && (
                          <span className="text-xs bg-gray-200 text-gray-500 px-1.5 py-0.5 rounded">비활성</span>
                        )}
                      </div>
                      <p className="text-xs text-gray-400 mt-0.5">{profile.email}</p>
                      {(profile.region || profile.customers) && (
                        <p className="text-xs text-gray-400 mt-0.5">
                          {profile.region && <span className="mr-2">지역: {profile.region}</span>}
                          {profile.customers && <span>고객사: {profile.customers}</span>}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleToggleActive(profile.id, isActive)}
                        className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ${
                          isActive
                            ? 'bg-yellow-50 text-yellow-700 hover:bg-yellow-100 border border-yellow-200'
                            : 'bg-green-50 text-green-700 hover:bg-green-100 border border-green-200'
                        }`}>
                        {isActive ? '비활성화' : '활성화'}
                      </button>

                      {deleteConfirmId === profile.id ? (
                        <>
                          <button
                            onClick={() => handleDelete(profile.id)}
                            className="text-xs px-3 py-1.5 bg-red-600 text-white rounded-lg hover:bg-red-700 font-medium">
                            탈퇴 확인
                          </button>
                          <button
                            onClick={() => setDeleteConfirmId(null)}
                            className="text-xs px-3 py-1.5 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200">
                            취소
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => setDeleteConfirmId(profile.id)}
                          className="text-xs px-3 py-1.5 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 border border-red-200 font-medium">
                          탈퇴처리
                        </button>
                      )}
                    </div>
                  </div>
                  {err && <p className="text-xs text-red-500 mt-1">{err}</p>}
                </div>
              )
            })}
          </div>
        </div>
      </main>
    </div>
  )
}
