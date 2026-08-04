'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { registerUser, loginUser } from '@/app/actions/auth'
import { passwordPolicyError, PASSWORD_RULE_TEXT } from '@/lib/password'
import Link from 'next/link'

interface AuthFormProps {
  mode: 'login' | 'register'
}

export default function AuthForm({ mode }: AuthFormProps) {
  const router = useRouter()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    if (mode === 'login') {
      // 로그인 처리·실패 횟수 누적은 모두 서버에서 (세션 쿠키도 서버가 설정)
      const { ok, error } = await loginUser({ email, password })
      if (!ok) {
        setError(error ?? '로그인에 실패했습니다.')
      } else {
        router.push('/bookings')
        router.refresh()
      }
    } else {
      // 화면 안내용 1차 검증 — 최종 검증·계정 생성은 전부 서버에서 수행한다
      if (!name.trim()) {
        setError('이름을 입력해주세요.')
        setLoading(false)
        return
      }
      const pwError = passwordPolicyError(password)
      if (pwError) {
        setError(pwError)
        setLoading(false)
        return
      }
      if (!inviteCode.trim()) {
        setError('초대코드를 입력해주세요.')
        setLoading(false)
        return
      }

      const { ok, error: regError } = await registerUser({
        name, phone, inviteCode, email, password,
      })
      if (!ok) {
        setError(regError ?? '회원가입에 실패했습니다.')
        setLoading(false)
        return
      }

      const { ok: loggedIn, error: loginError } = await loginUser({ email, password })
      if (loggedIn) {
        router.push('/bookings')
        router.refresh()
      } else {
        setError(loginError ?? '회원가입이 완료되었습니다. 로그인해주세요.')
      }
    }

    setLoading(false)
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-8">
        {/* 로고 영역 */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-blue-600 rounded-xl mb-4">
            <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">부킹 관리 시스템</h1>
          <p className="text-gray-500 text-sm mt-1">
            {mode === 'login' ? '로그인하여 부킹을 관리하세요' : '새 계정을 만들어 시작하세요'}
          </p>
        </div>

        {/* 폼 */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === 'register' && (
            <>
              <div>
                <label className="label">이름 *</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="홍길동"
                  required
                  className="input-field"
                />
              </div>
              <div>
                <label className="label">휴대폰 번호</label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="010-0000-0000"
                  className="input-field"
                />
              </div>
            </>
          )}

          {mode === 'register' && (
            <div>
              <label className="label">초대코드 *</label>
              <input
                type="text"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value)}
                placeholder="초대코드를 입력하세요"
                required
                className="input-field"
              />
              <p className="text-xs text-gray-400 mt-1">관리자에게 초대코드를 받으세요.</p>
            </div>
          )}

          <div>
            <label className="label">이메일 *</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              required
              className="input-field"
            />
          </div>

          <div>
            <label className="label">비밀번호 *</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === 'register' ? '영문+숫자+특수문자 8자 이상' : '••••••••'}
              required
              className="input-field"
            />
            {mode === 'register' && (
              <p className="text-xs text-gray-400 mt-1">{PASSWORD_RULE_TEXT}</p>
            )}
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 text-white py-2.5 rounded-lg font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed mt-2"
          >
            {loading ? '처리 중...' : mode === 'login' ? '로그인' : '회원가입'}
          </button>
        </form>

        {/* 하단 링크 */}
        <p className="text-center text-sm text-gray-500 mt-6">
          {mode === 'login' ? (
            <>
              계정이 없으신가요?{' '}
              <Link href="/register" className="text-blue-600 hover:underline font-medium">
                회원가입
              </Link>
            </>
          ) : (
            <>
              이미 계정이 있으신가요?{' '}
              <Link href="/login" className="text-blue-600 hover:underline font-medium">
                로그인
              </Link>
            </>
          )}
        </p>
      </div>
    </div>
  )
}
