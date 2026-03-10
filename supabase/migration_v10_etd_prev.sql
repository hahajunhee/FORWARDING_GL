-- Migration v10: UPDATED ETD 변경 이력 저장
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS updated_etd_prev DATE;
