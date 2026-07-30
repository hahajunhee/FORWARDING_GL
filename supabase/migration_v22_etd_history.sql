-- ================================================================
-- Migration v22: 확보선복취합 — 주차별 ETD 스냅샷 보관
--   etd_history = { "2026-07-08": "2026-07-16", "2026-07-15": "2026-07-17", ... }
--   기준일(key)마다 그 시점의 UPDATED ETD를 저장해 "ETD (M/D 기준)" 열로 표시한다.
-- Supabase SQL Editor에서 실행하세요. (재실행 안전)
-- ================================================================

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS etd_history JSONB DEFAULT '{}'::jsonb;
