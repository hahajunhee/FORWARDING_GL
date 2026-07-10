-- ================================================================
-- Migration v16: 상해발관리 MQC(/WK) 수동 저장 컬럼
--   MQC를 도착지별 기본값 일괄설정 + 행별 수정 가능하도록 저장.
--   (berthing 컬럼도 함께 보장 — v15 미실행 상태도 커버)
-- Supabase SQL Editor에서 실행하세요. (재실행 안전)
-- ================================================================

ALTER TABLE shanghai_mgmt ADD COLUMN IF NOT EXISTS berthing TEXT DEFAULT '';
ALTER TABLE shanghai_mgmt ADD COLUMN IF NOT EXISTS mqc TEXT DEFAULT '';
