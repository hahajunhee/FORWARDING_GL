-- ================================================================
-- Migration v21: C/I 엑셀 업로드 열 (CI_수량 · CI_도착지 · CI_모선명)
--   엑셀 업로드 시 부킹의 C/I 번호와 매칭하여 자동 입력되는 기본 열.
-- Supabase SQL Editor에서 실행하세요. (재실행 안전)
-- ================================================================

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS ci_qty    TEXT DEFAULT '';
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS ci_dest   TEXT DEFAULT '';
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS ci_vessel TEXT DEFAULT '';
