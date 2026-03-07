-- ================================================================
-- Migration v5: 공유 드롭다운 목록 + 핸드폰 필드
-- Supabase SQL Editor에서 실행하세요.
-- ================================================================

-- 1. profiles 테이블에 핸드폰 번호 컬럼 추가
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS phone TEXT DEFAULT '';

-- 2. custom_lists RLS 정책: 모든 인증 유저가 전체 목록 조회 가능
DROP POLICY IF EXISTS "custom_lists_select" ON custom_lists;
CREATE POLICY "custom_lists_select" ON custom_lists
  FOR SELECT TO authenticated USING (true);

-- 모든 인증 유저가 항목 수정 가능 (공유 목록)
DROP POLICY IF EXISTS "custom_lists_update" ON custom_lists;
CREATE POLICY "custom_lists_update" ON custom_lists
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- 모든 인증 유저가 항목 삭제 가능 (공유 목록)
DROP POLICY IF EXISTS "custom_lists_delete" ON custom_lists;
CREATE POLICY "custom_lists_delete" ON custom_lists
  FOR DELETE TO authenticated USING (true);

-- 3. custom_lists 유니크 제약 변경: (user_id, list_type, name) → (list_type, name)
--    기존 제약이 있으면 삭제 후 재생성
DO $$
BEGIN
  -- 기존 유니크 제약 이름을 찾아 삭제
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'custom_lists'::regclass
      AND contype = 'u'
      AND conname LIKE '%user_id%'
  ) THEN
    EXECUTE (
      SELECT 'ALTER TABLE custom_lists DROP CONSTRAINT ' || conname
      FROM pg_constraint
      WHERE conrelid = 'custom_lists'::regclass AND contype = 'u' AND conname LIKE '%user_id%'
      LIMIT 1
    );
  END IF;
END $$;

-- 전체 공유 기준 유니크 제약 추가 (이미 있으면 무시)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'custom_lists'::regclass
      AND contype = 'u'
      AND conname = 'custom_lists_list_type_name_key'
  ) THEN
    ALTER TABLE custom_lists ADD CONSTRAINT custom_lists_list_type_name_key
      UNIQUE (list_type, name);
  END IF;
END $$;

-- 4. global_settings 테이블 (없는 경우 생성)
CREATE TABLE IF NOT EXISTS global_settings (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE global_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "gs_select" ON global_settings;
CREATE POLICY "gs_select" ON global_settings
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "gs_write" ON global_settings;
CREATE POLICY "gs_write" ON global_settings
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 스케줄 열 기본값 삽입
INSERT INTO global_settings (key, value) VALUES (
  'schedule_cols',
  '["final_destination","discharge_port","carrier","vessel_name","booking_no","updated_etd","eta","containers"]'::jsonb
) ON CONFLICT (key) DO NOTHING;
