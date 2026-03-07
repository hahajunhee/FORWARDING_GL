-- ================================================================
-- Migration v4: 전체 공유 설정 테이블 (스케줄 열 구성 등)
-- Supabase SQL Editor에서 실행하세요.
-- ================================================================

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

-- 스케줄 열 기본값 삽입 (이미 있으면 무시)
INSERT INTO global_settings (key, value) VALUES (
  'schedule_cols',
  '["final_destination","discharge_port","carrier","vessel_name","booking_no","updated_etd","eta","containers"]'::jsonb
) ON CONFLICT (key) DO NOTHING;
