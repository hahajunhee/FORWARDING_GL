-- Migration v11: 항차(voyage) 컬럼 추가
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS voyage TEXT DEFAULT '';
