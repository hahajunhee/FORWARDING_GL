-- ================================================================
-- Migration v15: 상해발관리 접안일(berthing) 저장 컬럼
--   접안일(K)이 자동값(updated_etd_prev)에서 수동 입력으로 변경됨.
--   지연일(H·L)은 자동 계산으로 전환되어 delay_shanghai/delay_busan 컬럼은 미사용.
-- Supabase SQL Editor에서 실행하세요. (재실행 안전)
-- ================================================================

ALTER TABLE shanghai_mgmt ADD COLUMN IF NOT EXISTS berthing TEXT DEFAULT '';
