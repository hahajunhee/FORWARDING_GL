'use client'

import { useState, useTransition } from 'react'
import { setUserActive, deleteUser, restoreUser, updateInviteCode, updateRegionList, updateCustomerList } from './actions'
import type { Profile } from '@/types'

// ── 단순 목록 관리 컴포넌트 ─────────────────────────────────────────

function SimpleListManager({
  title, items, onSave, description,
}: {
  title: string
  items: string[]
  onSave: (list: string[]) => Promise<{ error: string | null }>
  description?: string
}) {
  const [list, setList] = useState<string[]>(items)
  const [newItem, setNewItem] = useState('')
  const [saving, setSaving] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  const handleAdd = () => {
    const trimmed = newItem.trim()
    if (!trimmed || list.includes(trimmed)) return
    setList(prev => [...prev, trimmed])
    setNewItem('')
  }

  const handleRemove = (item: string) => setList(prev => prev.filter(i => i !== item))

  const handleSave = () => {
    setSaveError(null)
    setSaving('saving')
    startTransition(async () => {
      const result = await onSave(list)
      if (result.error) { setSaving('error'); setSaveError(result.error) }
      else { setSaving('saved'); setTimeout(() => setSaving('idle'), 2500) }
    })
  }

  return (
    <div className="space-y-3">
      {description && <p className="text-xs text-gray-500">{description}</p>}
      <div className="flex gap-2">
        <input
          type="text"
          value={newItem}
          onChange={e => setNewItem(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleAdd()}
          placeholder={`새 ${title} 추가`}
          className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button onClick={handleAdd} disabled={!newItem.trim()}
          className="px-3 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-40 transition-colors">
          추가
        </button>
      </div>
      {list.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {list.map(item => (
            <span key={item} className="flex items-center gap-1 bg-gray-100 text-gray-700 text-xs px-2.5 py-1 rounded-full">
              {item}
              <button onClick={() => handleRemove(item)}
                className="text-gray-400 hover:text-red-500 leading-none ml-0.5">✕</button>
            </span>
          ))}
        </div>
      ) : (
        <p className="text-xs text-gray-400 text-center py-2">항목이 없습니다.</p>
      )}
      <div className="flex items-center gap-3 pt-1">
        <button onClick={handleSave} disabled={saving === 'saving'}
          className="px-4 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors font-medium">
          {saving === 'saving' ? '저장 중...' : '저장'}
        </button>
        {saving === 'saved' && <span className="text-xs text-green-600 font-medium">✓ 저장됨</span>}
        {saving === 'error' && <span className="text-xs text-red-600">{saveError}</span>}
      </div>
    </div>
  )
}

// ── 메인 컴포넌트 ──────────────────────────────────────────────────

interface AdminClientProps {
  profiles: Profile[]
  currentInviteCode: string
  regionList: string[]
  customerList: string[]
}

export default function AdminClient({ profiles, currentInviteCode, regionList, customerList }: AdminClientProps) {
  const [newCode, setNewCode] = useState(currentInviteCode)
  const [codeSaving, setCodeSaving] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [codeError, setCodeError] = useState<string | null>(null)
  const [, startTransition] = useTransition()
  const [actionErrors, setActionErrors] = useState<Record<string, string>>({})
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const [reassignState, setReassignState] = useState<{ userId: string; bookingCount: number; targetId: string } | null>(null)
  const [restoreConfirmId, setRestoreConfirmId] = useState<string | null>(null)
  const [restoreName, setRestoreName] = useState('')

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
      if (result.error) { setError(userId, result.error); return }
      if (result.bookingCount && result.bookingCount > 0) {
        // 부킹이 있으면 재배정 프롬프트
        setReassignState({ userId, bookingCount: result.bookingCount, targetId: '' })
        setDeleteConfirmId(null)
        return
      }
      setError(userId, null); setDeleteConfirmId(null)
    })
  }

  const handleReassignAndDelete = () => {
    if (!reassignState || !reassignState.targetId) return
    startTransition(async () => {
      const result = await deleteUser(reassignState.userId, reassignState.targetId)
      if (result.error) setError(reassignState.userId, result.error)
      else setError(reassignState.userId, null)
      setReassignState(null)
    })
  }

  const handleRestore = (userId: string) => {
    if (!restoreName.trim()) return
    startTransition(async () => {
      const result = await restoreUser(userId, restoreName.trim())
      if (result.error) setError(userId, result.error)
      else { setError(userId, null); setRestoreConfirmId(null); setRestoreName('') }
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

      <main className="max-w-3xl mx-auto px-4 py-6 space-y-5">
        {/* 초대코드 */}
        <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
          <div>
            <h2 className="text-sm font-bold text-gray-900">초대코드</h2>
            <p className="text-xs text-gray-500 mt-0.5">회원가입 시 요구되는 초대코드입니다.</p>
          </div>
          <div className="flex items-center gap-3">
            <input type="text" value={newCode} onChange={e => setNewCode(e.target.value)}
              className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <button onClick={handleSaveCode} disabled={codeSaving === 'saving'}
              className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors font-medium">
              {codeSaving === 'saving' ? '저장 중...' : '저장'}
            </button>
          </div>
          {codeSaving === 'saved' && <p className="text-xs text-green-600 font-medium">✓ 변경됨</p>}
          {codeSaving === 'error' && <p className="text-xs text-red-600">{codeError}</p>}
        </div>

        {/* 담당지역 목록 */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="text-sm font-bold text-gray-900 mb-3">담당지역 목록</h2>
          <SimpleListManager
            title="지역"
            items={regionList}
            onSave={updateRegionList}
            description="설정→내정보에서 담당자가 지역을 선택할 수 있습니다. 부킹장 필터에도 표시됩니다."
          />
        </div>

        {/* 담당고객사 목록 */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="text-sm font-bold text-gray-900 mb-3">담당고객사 목록</h2>
          <SimpleListManager
            title="고객사"
            items={customerList}
            onSave={updateCustomerList}
            description="설정→내정보에서 담당자가 고객사를 체크로 선택할 수 있습니다. 부킹장 필터에도 표시됩니다."
          />
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
              const isDeleted = profile.name.startsWith('[탈퇴]')
              const err = actionErrors[profile.id]
              return (
                <div key={profile.id} className={`px-5 py-3 ${!isActive ? 'bg-gray-50' : ''}`}>
                  <div className="flex items-center gap-3 flex-wrap">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`text-sm font-medium ${isActive ? 'text-gray-900' : 'text-gray-400 line-through'}`}>
                          {profile.name}
                        </span>
                        {!isActive && <span className="text-xs bg-gray-200 text-gray-500 px-1.5 py-0.5 rounded">비활성</span>}
                      </div>
                      <p className="text-xs text-gray-400 mt-0.5">{profile.email}</p>
                      {(profile.region || profile.customers) && (
                        <p className="text-xs text-gray-400 mt-0.5">
                          {profile.region && <span className="mr-2">지역: {profile.region}</span>}
                          {profile.customers && <span>고객사: {profile.customers}</span>}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      {isDeleted ? (
                        /* 탈퇴자: 복귀 버튼 */
                        restoreConfirmId === profile.id ? (
                          <div className="flex items-center gap-1.5">
                            <input type="text" value={restoreName} onChange={e => setRestoreName(e.target.value)}
                              placeholder="복귀 이름" className="border border-gray-200 rounded px-2 py-1 text-xs w-24" />
                            <button onClick={() => handleRestore(profile.id)} disabled={!restoreName.trim()}
                              className="text-xs px-2.5 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40 font-medium">복귀</button>
                            <button onClick={() => { setRestoreConfirmId(null); setRestoreName('') }}
                              className="text-xs px-2 py-1.5 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200">취소</button>
                          </div>
                        ) : (
                          <button onClick={() => { setRestoreConfirmId(profile.id); setRestoreName(profile.name.replace(/^\[탈퇴\]\s*/, '')) }}
                            className="text-xs px-3 py-1.5 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 border border-blue-200 font-medium">
                            복귀
                          </button>
                        )
                      ) : (
                        /* 활성 사용자: 비활성화 + 탈퇴 */
                        <>
                          <button onClick={() => handleToggleActive(profile.id, isActive)}
                            className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors border ${
                              isActive
                                ? 'bg-yellow-50 text-yellow-700 hover:bg-yellow-100 border-yellow-200'
                                : 'bg-green-50 text-green-700 hover:bg-green-100 border-green-200'
                            }`}>
                            {isActive ? '비활성화' : '활성화'}
                          </button>
                          {deleteConfirmId === profile.id ? (
                            <>
                              <button onClick={() => handleDelete(profile.id)}
                                className="text-xs px-3 py-1.5 bg-red-600 text-white rounded-lg hover:bg-red-700 font-medium">
                                탈퇴 확인
                              </button>
                              <button onClick={() => setDeleteConfirmId(null)}
                                className="text-xs px-3 py-1.5 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200">
                                취소
                              </button>
                            </>
                          ) : (
                            <button onClick={() => setDeleteConfirmId(profile.id)}
                              className="text-xs px-3 py-1.5 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 border border-red-200 font-medium">
                              탈퇴처리
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                  {err && <p className="text-xs text-red-500 mt-1">{err}</p>}
                </div>
              )
            })}
          </div>
        </div>
        {/* 재배정 모달 */}
        {reassignState && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
            <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4 max-w-md w-full mx-4 shadow-xl">
              <h3 className="text-sm font-bold text-gray-900">담당자 재배정 필요</h3>
              <p className="text-xs text-gray-600">
                해당 사용자에게 배정된 부킹이 <span className="font-bold text-red-600">{reassignState.bookingCount}건</span> 있습니다.<br />
                탈퇴 처리 전에 다른 담당자로 변경해주세요.
              </p>
              <select value={reassignState.targetId} onChange={e => setReassignState(prev => prev ? { ...prev, targetId: e.target.value } : null)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">담당자 선택</option>
                {profiles.filter(p => p.id !== reassignState.userId && p.is_active !== false && !p.name.startsWith('[탈퇴]')).map(p => (
                  <option key={p.id} value={p.id}>{p.name} ({p.email})</option>
                ))}
              </select>
              <div className="flex gap-2 justify-end">
                <button onClick={() => setReassignState(null)}
                  className="text-xs px-4 py-2 bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200">취소</button>
                <button onClick={handleReassignAndDelete} disabled={!reassignState.targetId}
                  className="text-xs px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-40 font-medium">
                  재배정 후 탈퇴처리
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
