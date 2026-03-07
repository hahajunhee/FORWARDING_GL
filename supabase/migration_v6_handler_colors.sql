-- ================================================================
-- Migration v6: 담당자 행 색상 (profiles.color)
-- Supabase SQL Editor에서 실행하세요.
-- ================================================================

-- profiles 테이블에 color 컬럼 추가
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS color TEXT DEFAULT NULL;
