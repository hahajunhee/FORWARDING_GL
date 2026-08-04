-- ================================================================
-- Migration v23: 로그인/회원가입 시도 제한 (계정 잠금 · 초대코드 무차별 대입 방지)
--   key 형식:  login:<email>   로그인 실패 카운트 (5회 실패 시 15분 잠금)
--              reg:<ip>        초대코드 오입력 카운트 (10회 실패 시 15분 차단)
--   서버 액션(service role)에서만 접근한다. RLS 활성 + 정책 없음 = 일반 사용자 접근 불가.
-- Supabase SQL Editor에서 실행하세요. (재실행 안전)
-- ================================================================

CREATE TABLE IF NOT EXISTS auth_attempts (
  key            TEXT PRIMARY KEY,
  fail_count     INTEGER NOT NULL DEFAULT 0,
  locked_until   TIMESTAMPTZ,
  last_failed_at TIMESTAMPTZ,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE auth_attempts ENABLE ROW LEVEL SECURITY;
