-- ================================================================
-- Migration v17: 상해발관리 직전 PORT + 비고 컬럼
--   (v15/v16 미실행 사용자를 위해 berthing/mqc도 함께 보장 — idempotent)
-- Supabase SQL Editor에서 실행하세요.
-- ================================================================

ALTER TABLE shanghai_mgmt ADD COLUMN IF NOT EXISTS berthing  TEXT DEFAULT '';
ALTER TABLE shanghai_mgmt ADD COLUMN IF NOT EXISTS mqc       TEXT DEFAULT '';
ALTER TABLE shanghai_mgmt ADD COLUMN IF NOT EXISTS prev_port TEXT DEFAULT '';
ALTER TABLE shanghai_mgmt ADD COLUMN IF NOT EXISTS remarks   TEXT DEFAULT '';
