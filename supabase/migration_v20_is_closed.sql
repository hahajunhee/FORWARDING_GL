-- ================================================================
-- Migration v20: 부킹 마감완료 플래그 (is_closed)
--   체크박스 선택 → '마감완료' 버튼으로 표시, 해당 행은 회색 음영.
-- Supabase SQL Editor에서 실행하세요. (재실행 안전)
-- ================================================================

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS is_closed BOOLEAN DEFAULT false;
