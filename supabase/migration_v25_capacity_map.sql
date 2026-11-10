-- ================================================================
-- Migration v25: 예상선복확인 탭 — PDC↔최종도착지 / 선사 매핑 (유저별)
--   profiles.capacity_map : { "pdc": { "JEFFERSON": ["SAVANNAH"] }, "carrier": { "MSK": ["MAERSK"] } }
-- Supabase SQL Editor에서 실행하세요. (재실행 안전)
-- ================================================================
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS capacity_map JSONB;
