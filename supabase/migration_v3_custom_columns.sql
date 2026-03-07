-- ================================================================
-- Migration v3: 커스텀 열 지원 + 서류마감 템플릿 (유저별)
-- Supabase SQL Editor에서 실행하세요.
-- ================================================================

-- 1. column_definitions 테이블 (전체 사용자 공유 커스텀 열 정의)
CREATE TABLE IF NOT EXISTS column_definitions (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  key           TEXT UNIQUE NOT NULL,
  label         TEXT NOT NULL,
  display_order INTEGER DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE column_definitions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "col_defs_select" ON column_definitions;
CREATE POLICY "col_defs_select" ON column_definitions
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "col_defs_write" ON column_definitions;
CREATE POLICY "col_defs_write" ON column_definitions
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 2. bookings 테이블에 extra_data 컬럼 추가 (커스텀 열 값 저장)
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS extra_data JSONB DEFAULT '{}';

-- 3. profiles 테이블에 doc_template 컬럼 추가 (유저별 메일 템플릿)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS doc_template TEXT DEFAULT NULL;
