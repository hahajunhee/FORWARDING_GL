-- ================================================================
-- Migration v24: 터미널 스케줄 기반 UPDATED ETD 확인·반영 탭
--   1) profiles.etd_terminal_prefs : 유저별 "선사 → 기본 터미널" 매핑
--        { "MSK": ["PNC"], "HMM": ["HPNT", "PNIT"] }
--   2) etd_sync_log : 반영 이력 (누가·언제·어느 터미널의 어떤 값으로 바꿨는지)
-- Supabase SQL Editor에서 실행하세요. (재실행 안전)
-- ================================================================

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS etd_terminal_prefs JSONB;

CREATE TABLE IF NOT EXISTS etd_sync_log (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id       UUID,
  vessel_name      TEXT,
  old_etd          DATE,
  new_etd          DATE,
  terminal         TEXT,
  terminal_voyage  TEXT,
  collected_at     TEXT,           -- 터미널 스케줄 수집 시각
  confirmed_by     UUID REFERENCES auth.users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS etd_sync_log_created_idx ON etd_sync_log (created_at DESC);

ALTER TABLE etd_sync_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "etd_sync_log_select" ON etd_sync_log;
CREATE POLICY "etd_sync_log_select" ON etd_sync_log
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "etd_sync_log_insert" ON etd_sync_log;
CREATE POLICY "etd_sync_log_insert" ON etd_sync_log
  FOR INSERT TO authenticated WITH CHECK (confirmed_by = auth.uid());

NOTIFY pgrst, 'reload schema';
