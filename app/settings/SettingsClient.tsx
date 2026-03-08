'use client'

import { useState, useTransition, useEffect } from 'react'
import Link from 'next/link'
import {
  addCustomListItem, deleteCustomListItem, updateCustomListItem,
  saveColumnSettings, addColumnDefinition, removeColumnDefinition,
  saveCustomListOrder, saveMyProfile, updateColumnDescription, saveBaseColDescriptions,
} from './actions'
import type { CustomList, ColumnDefinition } from '@/types'
import { DEFAULT_DESTINATIONS, MAJOR_PORTS, CARRIERS, DEFAULT_COLUMN_ORDER, COLUMN_LABELS } from '@/types'

type ListTab = 'destination' | 'port' | 'carrier'
type MainTab = 'lists' | 'columns' | 'myinfo'

// ── 드롭다운 목록 관리 ────────────────────────────────────────────

interface ListManagerProps {
  listType: ListTab
  items: CustomList[]
  defaultItems: readonly string[]
  placeholder: string
}

function ListManager({ listType, items, defaultItems, placeholder }: ListManagerProps) {
  const [orderedItems, setOrderedItems] = useState(items)
  const [newName, setNewName] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  useEffect(() => { setOrderedItems(items) }, [items])

  const handleAdd = () => {
    if (!newName.trim()) return
    setError(null)
    startTransition(async () => {
      const result = await addCustomListItem(listType, newName)
      if (result.error) setError(result.error)
      else setNewName('')
    })
  }

  const handleDelete = (id: string) => {
    startTransition(async () => { await deleteCustomListItem(id) })
  }

  const handleEditSave = (id: string) => {
    startTransition(async () => {
      const result = await updateCustomListItem(id, editingName)
      if (!result.error) setEditingId(null)
    })
  }

  const moveItem = (idx: number, dir: 'up' | 'down') => {
    const swapIdx = dir === 'up' ? idx - 1 : idx + 1
    if (swapIdx < 0 || swapIdx >= orderedItems.length) return
    const next = [...orderedItems]
    ;[next[idx], next[swapIdx]] = [next[swapIdx], next[idx]]
    setOrderedItems(next)
    startTransition(async () => { await saveCustomListOrder(next.map(i => i.id)) })
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <input type="text" value={newName} onChange={e => setNewName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleAdd()} placeholder={placeholder}
          className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        <button onClick={handleAdd} disabled={isPending || !newName.trim()}
          className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">
          추가
        </button>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {orderedItems.length > 0 ? (
        <div className="border border-gray-200 rounded-lg divide-y divide-gray-100">
          {orderedItems.map((item, idx) => (
            <div key={item.id} className="flex items-center gap-2 px-3 py-2">
              {editingId === item.id ? (
                <>
                  <input type="text" value={editingName} onChange={e => setEditingName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleEditSave(item.id)} autoFocus
                    className="flex-1 border border-blue-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400" />
                  <button onClick={() => handleEditSave(item.id)} disabled={isPending}
                    className="text-xs px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700">저장</button>
                  <button onClick={() => setEditingId(null)}
                    className="text-xs px-2 py-1 bg-gray-100 text-gray-600 rounded hover:bg-gray-200">취소</button>
                </>
              ) : (
                <>
                  <div className="flex flex-col gap-0.5">
                    <button onClick={() => moveItem(idx, 'up')} disabled={idx === 0 || isPending}
                      className="w-5 h-4 text-gray-300 hover:text-gray-600 disabled:opacity-20 text-xs leading-none text-center">↑</button>
                    <button onClick={() => moveItem(idx, 'down')} disabled={idx === orderedItems.length - 1 || isPending}
                      className="w-5 h-4 text-gray-300 hover:text-gray-600 disabled:opacity-20 text-xs leading-none text-center">↓</button>
                  </div>
                  <span className="flex-1 text-sm text-gray-800">{item.name}</span>
                  <button onClick={() => { setEditingId(item.id); setEditingName(item.name) }}
                    className="text-xs px-2 py-1 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors">수정</button>
                  <button onClick={() => handleDelete(item.id)} disabled={isPending}
                    className="text-xs px-2 py-1 text-red-500 hover:bg-red-50 rounded transition-colors">삭제</button>
                </>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-gray-400 text-center py-3">
          아직 추가한 항목이 없습니다. 항목을 추가하면 기본 목록 대신 사용됩니다.
        </p>
      )}

      {orderedItems.length === 0 && (
        <div>
          <p className="text-xs text-gray-400 mb-2">기본 목록 (클릭하여 바로 추가):</p>
          <div className="flex flex-wrap gap-1.5">
            {defaultItems.map(item => (
              <span key={item} onClick={() => setNewName(item)}
                className="text-xs bg-gray-100 text-gray-500 px-2 py-1 rounded cursor-pointer hover:bg-blue-50 hover:text-blue-600 transition-colors">
                {item}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── 열 설정 ───────────────────────────────────────────────────────

interface ColumnSettingsProps {
  columnOrder: string[]
  pinnedColumns: string[]
  columnDefinitions: ColumnDefinition[]
  baseColDescriptions: Record<string, string>
}

function ColumnSettings({ columnOrder, pinnedColumns, columnDefinitions, baseColDescriptions }: ColumnSettingsProps) {
  const [cols, setCols] = useState<string[]>(() => {
    const customKeys = columnDefinitions.map(cd => cd.key)
    const allKeys = [...DEFAULT_COLUMN_ORDER, ...customKeys]
    const valid = columnOrder.filter(k => allKeys.includes(k))
    const missing = allKeys.filter(k => !columnOrder.includes(k))
    return [...valid, ...missing]
  })
  const [pinned, setPinned] = useState<string[]>(pinnedColumns)
  const [isPending, startTransition] = useTransition()
  const [saveState, setSaveState] = useState<'idle' | 'saved' | 'error'>('idle')

  // 기본 열 설명
  const [baseDescs, setBaseDescs] = useState<Record<string, string>>(baseColDescriptions)
  const [baseDescSaving, setBaseDescSaving] = useState<'idle' | 'saving' | 'saved'>('idle')

  const handleSaveBaseDescs = () => {
    setBaseDescSaving('saving')
    startTransition(async () => {
      await saveBaseColDescriptions(baseDescs)
      setBaseDescSaving('saved')
      setTimeout(() => setBaseDescSaving('idle'), 2000)
    })
  }

  // 커스텀 열 설명 인라인 편집
  const [editingDescId, setEditingDescId] = useState<string | null>(null)
  const [editingDescValue, setEditingDescValue] = useState('')

  const handleSaveDesc = (id: string) => {
    startTransition(async () => {
      await updateColumnDescription(id, editingDescValue)
      setEditingDescId(null)
    })
  }

  // 커스텀 열 관리
  const [newColLabel, setNewColLabel] = useState('')
  const [newColDescription, setNewColDescription] = useState('')
  const [colPassword, setColPassword] = useState('')
  const [colError, setColError] = useState<string | null>(null)
  const [colSuccess, setColSuccess] = useState<string | null>(null)
  const [removePassword, setRemovePassword] = useState('')
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [removeError, setRemoveError] = useState<string | null>(null)
  const [showAddForm, setShowAddForm] = useState(false)

  const allColLabels: Record<string, string> = { ...COLUMN_LABELS }
  for (const cd of columnDefinitions) allColLabels[cd.key] = cd.label

  const togglePin = (col: string) => {
    setPinned(prev =>
      prev.includes(col) ? prev.filter(p => p !== col) : [...prev, col]
    )
  }

  const handleReset = () => {
    setCols(DEFAULT_COLUMN_ORDER)
    setPinned(['forwarder_handler', 'discharge_port', 'final_destination'])
  }

  const handleSave = () => {
    startTransition(async () => {
      const result = await saveColumnSettings(cols, pinned)
      if (result.error) {
        setSaveState('error')
      } else {
        setSaveState('saved')
        setTimeout(() => setSaveState('idle'), 2500)
      }
    })
  }

  const handleReorder = (col: string, newIdx: number) => {
    const si = cols.indexOf(col)
    if (si === -1 || newIdx < 0 || newIdx >= cols.length) return
    const next = [...cols]
    next.splice(si, 1)
    next.splice(newIdx, 0, col)
    setCols(next)
  }

  const handleAddCol = () => {
    if (!newColLabel.trim()) { setColError('열 이름을 입력해주세요.'); return }
    setColError(null); setColSuccess(null)
    startTransition(async () => {
      const result = await addColumnDefinition(newColLabel, colPassword, newColDescription)
      if (result.error) {
        setColError(result.error)
      } else {
        setColSuccess(`"${newColLabel}" 열이 추가되었습니다.`)
        setNewColLabel(''); setNewColDescription(''); setColPassword(''); setShowAddForm(false)
        setTimeout(() => setColSuccess(null), 3000)
      }
    })
  }

  const handleRemoveCol = (id: string) => {
    setRemoveError(null)
    startTransition(async () => {
      const result = await removeColumnDefinition(id, removePassword)
      if (result.error) {
        setRemoveError(result.error)
      } else {
        setRemovingId(null); setRemovePassword('')
      }
    })
  }

  return (
    <div className="space-y-6">
      {/* 열 순서/고정 설정 */}
      <div className="space-y-4">
        <div className="flex items-start justify-between">
          <p className="text-sm text-gray-500 leading-relaxed">
            열 순서와 고정 여부를 설정합니다.<br />
            <span className="text-blue-600">📌 고정된 열</span>은 테이블 가장 왼쪽에 항상 표시됩니다.<br />
            <span className="text-gray-400">행을 드래그하여 순서를 바꾸세요. 저장하면 유지됩니다.</span>
          </p>
          <button onClick={handleReset} className="text-xs text-gray-400 hover:text-gray-600 whitespace-nowrap ml-4">
            기본값으로
          </button>
        </div>

        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <div className="bg-gray-50 px-3 py-2 text-xs text-gray-500 font-medium border-b border-gray-200 flex gap-2">
            <span className="w-12 text-center">순서</span>
            <span className="flex-1">열 이름</span>
            <span className="w-20 text-center">고정</span>
          </div>
          {cols.map((col, idx) => {
            const isPinned = pinned.includes(col)
            const isCustom = columnDefinitions.some(cd => cd.key === col)
            return (
              <div key={col}
                className={`flex items-center gap-2 px-3 py-2 border-b border-gray-100 last:border-0 transition-colors
                  ${isPinned ? 'bg-blue-50/50' : ''}
                `}>
                <input
                  type="number" min={1} max={cols.length} value={idx + 1}
                  onChange={e => {
                    const n = parseInt(e.target.value)
                    if (!isNaN(n)) handleReorder(col, n - 1)
                  }}
                  className="w-12 border border-gray-200 rounded px-1.5 py-1 text-sm text-center focus:outline-none focus:ring-1 focus:ring-blue-400"
                />
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${isPinned ? 'bg-blue-500' : 'bg-gray-200'}`} />
                <span className="flex-1 text-sm text-gray-800 font-medium flex items-center gap-1.5">
                  {allColLabels[col] || col}
                  {isCustom && <span className="text-xs bg-purple-100 text-purple-600 px-1.5 py-0.5 rounded font-normal">커스텀</span>}
                </span>
                <button
                  onClick={() => togglePin(col)}
                  className={`w-20 text-xs py-1 px-2 rounded-lg font-medium transition-colors ${
                    isPinned
                      ? 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                      : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                  }`}>
                  {isPinned ? '📌 고정됨' : '고정'}
                </button>
              </div>
            )
          })}
        </div>

        <div className="flex items-center gap-3">
          <button onClick={handleSave} disabled={isPending}
            className="px-5 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors font-medium">
            {isPending ? '저장 중...' : '설정 저장'}
          </button>
          {saveState === 'saved' && <span className="text-sm text-green-600 font-medium">✓ 저장됨 — 부킹장에 즉시 반영됩니다</span>}
          {saveState === 'error' && <span className="text-sm text-red-600">저장 실패. 다시 시도해주세요.</span>}
        </div>

        {pinned.length > 0 && (
          <div className="bg-blue-50 rounded-lg p-3">
            <p className="text-xs text-blue-700 font-medium mb-1">현재 고정열 (왼쪽부터):</p>
            <div className="flex flex-wrap gap-1.5">
              {pinned.map((col, i) => (
                <span key={col} className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">
                  {i + 1}. {allColLabels[col] || col}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 기본 열 설명 */}
      <div className="border-t border-gray-200 pt-6 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">기본 열 설명</h3>
            <p className="text-xs text-gray-500 mt-0.5">부킹장 열 제목에 마우스를 올리면 표시되는 설명을 입력합니다.</p>
          </div>
          <button onClick={handleSaveBaseDescs} disabled={isPending || baseDescSaving === 'saving'}
            className="text-xs px-3 py-1.5 bg-gray-700 text-white rounded-lg hover:bg-gray-800 disabled:opacity-50 transition-colors font-medium">
            {baseDescSaving === 'saving' ? '저장 중...' : baseDescSaving === 'saved' ? '✓ 저장됨' : '저장'}
          </button>
        </div>
        <div className="border border-gray-200 rounded-lg divide-y divide-gray-100">
          {DEFAULT_COLUMN_ORDER.map(key => (
            <div key={key} className="flex items-center gap-3 px-3 py-2">
              <span className="text-sm text-gray-700 font-medium w-28 shrink-0">{COLUMN_LABELS[key] || key}</span>
              <input
                type="text"
                value={baseDescs[key] || ''}
                onChange={e => setBaseDescs(prev => ({ ...prev, [key]: e.target.value }))}
                placeholder="설명 없음"
                className="flex-1 text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-400 text-gray-600"
              />
            </div>
          ))}
        </div>
      </div>

      {/* 커스텀 열 관리 */}
      <div className="border-t border-gray-200 pt-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">커스텀 열 관리</h3>
            <p className="text-xs text-gray-500 mt-0.5">추가/삭제 시 <span className="font-semibold">모든 사용자</span>에게 즉시 반영됩니다. 비밀번호가 필요합니다.</p>
          </div>
          <button onClick={() => setShowAddForm(v => !v)}
            className="text-xs px-3 py-1.5 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors font-medium">
            + 열 추가
          </button>
        </div>

        {colSuccess && (
          <div className="bg-green-50 border border-green-200 rounded-lg px-3 py-2 text-sm text-green-700">{colSuccess}</div>
        )}

        {showAddForm && (
          <div className="bg-purple-50 border border-purple-200 rounded-xl p-4 space-y-3">
            <p className="text-xs font-medium text-purple-800">새 열 추가 (전체 사용자 적용)</p>
            <div className="flex gap-2 flex-wrap">
              <input type="text" value={newColLabel} onChange={e => setNewColLabel(e.target.value)}
                placeholder="열 이름 (예: 화주명)"
                className="flex-1 min-w-[120px] border border-purple-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 bg-white" />
              <input type="text" value={newColDescription} onChange={e => setNewColDescription(e.target.value)}
                placeholder="열 설명 (마우스 오버시 표시)"
                className="flex-[2] min-w-[180px] border border-purple-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 bg-white" />
              <input type="password" value={colPassword} onChange={e => setColPassword(e.target.value)}
                placeholder="비밀번호"
                className="w-28 border border-purple-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400 bg-white" />
              <button onClick={handleAddCol} disabled={isPending}
                className="px-4 py-2 bg-purple-600 text-white text-sm rounded-lg hover:bg-purple-700 disabled:opacity-50 transition-colors">
                추가
              </button>
              <button onClick={() => { setShowAddForm(false); setColError(null) }}
                className="px-3 py-2 bg-gray-100 text-gray-600 text-sm rounded-lg hover:bg-gray-200 transition-colors">
                취소
              </button>
            </div>
            {colError && <p className="text-xs text-red-600">{colError}</p>}
          </div>
        )}

        {columnDefinitions.length === 0 ? (
          <p className="text-sm text-gray-400 py-4 text-center">추가된 커스텀 열이 없습니다.</p>
        ) : (
          <div className="border border-gray-200 rounded-lg divide-y divide-gray-100">
            {columnDefinitions.map(cd => (
              <div key={cd.id} className="px-3 py-2.5">
                {removingId === cd.id ? (
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-gray-800 flex-1">{cd.label}</span>
                    <span className="text-xs text-red-600">이 열을 삭제하면 모든 유저의 해당 열 데이터가 사라집니다.</span>
                    <input type="password" value={removePassword} onChange={e => setRemovePassword(e.target.value)}
                      placeholder="비밀번호 입력"
                      className="border border-red-300 rounded px-2 py-1 text-xs w-32 focus:outline-none focus:ring-1 focus:ring-red-400" />
                    <button onClick={() => handleRemoveCol(cd.id)} disabled={isPending}
                      className="text-xs px-2 py-1 bg-red-600 text-white rounded hover:bg-red-700">삭제 확인</button>
                    <button onClick={() => { setRemovingId(null); setRemovePassword(''); setRemoveError(null) }}
                      className="text-xs px-2 py-1 bg-gray-100 text-gray-600 rounded hover:bg-gray-200">취소</button>
                    {removeError && <p className="text-xs text-red-600 w-full">{removeError}</p>}
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <span className="text-sm text-gray-800 font-medium">{cd.label}</span>
                      {editingDescId === cd.id ? (
                        <div className="flex items-center gap-1 mt-1">
                          <input
                            autoFocus
                            value={editingDescValue}
                            onChange={e => setEditingDescValue(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') handleSaveDesc(cd.id); if (e.key === 'Escape') setEditingDescId(null) }}
                            placeholder="열 설명 (마우스 오버시 표시)"
                            className="flex-1 text-xs border border-blue-300 rounded px-2 py-0.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
                          />
                          <button onClick={() => handleSaveDesc(cd.id)} className="text-xs px-2 py-0.5 bg-blue-600 text-white rounded hover:bg-blue-700">저장</button>
                          <button onClick={() => setEditingDescId(null)} className="text-xs px-2 py-0.5 bg-gray-100 text-gray-600 rounded hover:bg-gray-200">취소</button>
                        </div>
                      ) : (
                        <p
                          className="text-xs text-gray-400 mt-0.5 cursor-pointer hover:text-blue-500"
                          onClick={() => { setEditingDescId(cd.id); setEditingDescValue(cd.description || '') }}
                          title="클릭하여 설명 편집">
                          {cd.description || <span className="text-gray-300 italic">설명 없음 (클릭하여 추가)</span>}
                        </p>
                      )}
                    </div>
                    <span className="text-xs text-gray-400 font-mono shrink-0">{cd.key}</span>
                    <button onClick={() => { setRemovingId(cd.id); setRemoveError(null) }}
                      className="text-xs px-2 py-1 text-red-500 hover:bg-red-50 rounded transition-colors shrink-0">삭제</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── 메인 컴포넌트 ──────────────────────────────────────────────────

interface SettingsClientProps {
  customLists: CustomList[]
  columnOrder: string[]
  pinnedColumns: string[]
  columnDefinitions: ColumnDefinition[]
  currentColor: string | null
  currentName: string
  currentRegion: string
  currentCustomers: string
  regionList: string[]
  customerList: string[]
  baseColDescriptions: Record<string, string>
}

export default function SettingsClient({
  customLists, columnOrder, pinnedColumns, columnDefinitions,
  currentName, currentRegion, currentCustomers,
  regionList, customerList, baseColDescriptions,
}: SettingsClientProps) {
  const [mainTab, setMainTab] = useState<MainTab>('lists')

  // 내정보
  const [profileName, setProfileName] = useState(currentName)
  const [profileRegion, setProfileRegion] = useState(currentRegion)
  const [profileCustomers, setProfileCustomers] = useState(currentCustomers)
  const [profileSaving, setProfileSaving] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [profileError, setProfileError] = useState<string | null>(null)
  const [, startProfileTransition] = useTransition()

  const handleSaveProfile = () => {
    setProfileError(null)
    setProfileSaving('saving')
    startProfileTransition(async () => {
      const result = await saveMyProfile(profileName, profileRegion, profileCustomers)
      if (result.error) { setProfileSaving('error'); setProfileError(result.error) }
      else { setProfileSaving('saved'); setTimeout(() => setProfileSaving('idle'), 2500) }
    })
  }

  const [listTab, setListTab] = useState<ListTab>('destination')

  const destinationItems = customLists.filter(l => l.list_type === 'destination')
  const portItems = customLists.filter(l => l.list_type === 'port')
  const carrierItems = customLists.filter(l => l.list_type === 'carrier')

  const listTabs = [
    { key: 'destination' as ListTab, label: '최종도착지', count: destinationItems.length },
    { key: 'port' as ListTab, label: '양하항', count: portItems.length },
    { key: 'carrier' as ListTab, label: '선사', count: carrierItems.length },
  ]

  const currentItems = listTab === 'destination' ? destinationItems : listTab === 'port' ? portItems : carrierItems
  const defaultItems = listTab === 'destination' ? DEFAULT_DESTINATIONS : listTab === 'port' ? MAJOR_PORTS : CARRIERS
  const placeholder = listTab === 'destination' ? '예: MUNICH' : listTab === 'port' ? '예: HAMBURG (DE)' : '예: MSC'

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-3">
          <Link href="/bookings" className="text-gray-400 hover:text-gray-600 transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
          </Link>
          <h1 className="text-base font-bold text-gray-900">설정</h1>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        {/* 메인 탭 */}
        <div className="flex border-b border-gray-200">
          <button onClick={() => setMainTab('lists')}
            className={`px-5 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
              mainTab === 'lists' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}>
            드롭다운 목록
          </button>
          <button onClick={() => setMainTab('columns')}
            className={`px-5 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
              mainTab === 'columns' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}>
            열 설정
            {columnDefinitions.length > 0 && (
              <span className="ml-1.5 bg-purple-100 text-purple-600 text-xs rounded-full px-1.5 py-0.5">{columnDefinitions.length}</span>
            )}
          </button>
          <button onClick={() => setMainTab('myinfo')}
            className={`px-5 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
              mainTab === 'myinfo' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}>
            내정보
          </button>
        </div>

        {mainTab === 'lists' && (
          <>
            <p className="text-sm text-gray-500">편집 모드 드롭다운에 표시될 항목을 관리합니다.</p>
            <div className="flex border-b border-gray-200">
              {listTabs.map(tab => (
                <button key={tab.key} onClick={() => setListTab(tab.key)}
                  className={`px-5 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
                    listTab === tab.key ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}>
                  {tab.label}
                  {tab.count > 0 && (
                    <span className="ml-1.5 bg-blue-100 text-blue-600 text-xs rounded-full px-1.5 py-0.5">{tab.count}</span>
                  )}
                </button>
              ))}
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <ListManager key={listTab} listType={listTab} items={currentItems} defaultItems={defaultItems} placeholder={placeholder} />
            </div>
          </>
        )}

        {mainTab === 'columns' && (
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <ColumnSettings
              columnOrder={columnOrder}
              pinnedColumns={pinnedColumns}
              columnDefinitions={columnDefinitions}
              baseColDescriptions={baseColDescriptions}
            />
          </div>
        )}

        {mainTab === 'myinfo' && (
          <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-5">
            <div>
              <h3 className="text-sm font-semibold text-gray-900">내 정보 변경</h3>
              <p className="text-xs text-gray-500 mt-1">이름, 담당지역, 담당고객사를 수정합니다. 부킹장 담당자 열에 반영됩니다.</p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">이름</label>
                <input
                  type="text"
                  value={profileName}
                  onChange={e => setProfileName(e.target.value)}
                  placeholder="이름을 입력하세요"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">담당지역</label>
                {regionList.length > 0 ? (
                  <select
                    value={profileRegion}
                    onChange={e => setProfileRegion(e.target.value)}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    <option value="">지역 선택</option>
                    {regionList.map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={profileRegion}
                    onChange={e => setProfileRegion(e.target.value)}
                    placeholder="예: 북미, 아태, 유럽, 중남미"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                )}
                <p className="text-xs text-gray-400 mt-1">담당하는 지역을 선택하세요. 부킹장 필터에서 지역별로 조회할 수 있습니다.</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">담당고객사</label>
                {customerList.length > 0 ? (
                  <div className="border border-gray-200 rounded-lg p-3 space-y-1.5 max-h-48 overflow-y-auto">
                    {customerList.map(c => {
                      const checked = profileCustomers.split(',').map(s => s.trim()).includes(c)
                      const handleCheck = (v: boolean) => {
                        const current = profileCustomers.split(',').map(s => s.trim()).filter(Boolean)
                        const next = v ? [...current, c] : current.filter(x => x !== c)
                        setProfileCustomers(next.join(', '))
                      }
                      return (
                        <label key={c} className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 rounded px-1 py-0.5">
                          <input type="checkbox" checked={checked} onChange={e => handleCheck(e.target.checked)}
                            className="rounded text-blue-600 focus:ring-blue-500" />
                          <span className="text-sm text-gray-700">{c}</span>
                        </label>
                      )
                    })}
                  </div>
                ) : (
                  <textarea
                    value={profileCustomers}
                    onChange={e => setProfileCustomers(e.target.value)}
                    placeholder="예: 모비스AS, TPL, 현대글로비스"
                    rows={3}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                  />
                )}
                <p className="text-xs text-gray-400 mt-1">담당 고객사를 선택하세요. 부킹장 필터에서 조회할 수 있습니다.</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={handleSaveProfile}
                disabled={profileSaving === 'saving'}
                className="px-5 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors font-medium">
                {profileSaving === 'saving' ? '저장 중...' : '저장'}
              </button>
              {profileSaving === 'saved' && <span className="text-sm text-green-600 font-medium">✓ 저장됨</span>}
              {profileSaving === 'error' && <span className="text-sm text-red-600">{profileError || '저장 실패'}</span>}
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
