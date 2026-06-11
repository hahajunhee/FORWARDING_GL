-- Migration v14: 컨픽업수량 컬럼 추가
-- 스케줄조회 포털에서 '사용하기'로 픽업 요청 시 누적 수량이 자동 기입된다.
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS con_pickup_qty INTEGER DEFAULT 0;

-- PostgREST 스키마 캐시 즉시 갱신 (voyage 때 캐시 문제 재발 방지)
NOTIFY pgrst, 'reload schema';
