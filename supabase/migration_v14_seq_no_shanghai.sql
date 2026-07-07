-- ================================================================
-- Migration v14: 부킹 고유번호(seq_no) + 상해발관리(shanghai_mgmt) 테이블
-- Supabase SQL Editor에서 실행하세요. (재실행 안전 — idempotent)
-- ================================================================

-- ────────────────────────────────────────────────────────────────
-- 1) 부킹 고유번호 (seq_no) — 생성일 순 1부터, 신규 행 자동 채번
-- ────────────────────────────────────────────────────────────────
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS seq_no BIGINT;

-- 기존 행 백필: 생성일 오름차순으로 1, 2, 3, ... (아직 번호 없는 행만)
WITH ordered AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at ASC, id ASC) AS rn
  FROM bookings
  WHERE seq_no IS NULL
)
UPDATE bookings b
SET seq_no = o.rn + COALESCE((SELECT MAX(seq_no) FROM bookings), 0)
FROM ordered o
WHERE b.id = o.id;

-- 신규 행 자동 채번용 시퀀스 (빈 테이블도 안전하게 처리)
CREATE SEQUENCE IF NOT EXISTS bookings_seq_no_seq;
SELECT setval(
  'bookings_seq_no_seq',
  COALESCE((SELECT MAX(seq_no) FROM bookings), 1),
  (SELECT EXISTS (SELECT 1 FROM bookings WHERE seq_no IS NOT NULL))
);
ALTER TABLE bookings ALTER COLUMN seq_no SET DEFAULT nextval('bookings_seq_no_seq');

-- 고유성 보장
CREATE UNIQUE INDEX IF NOT EXISTS bookings_seq_no_key ON bookings(seq_no);

-- ────────────────────────────────────────────────────────────────
-- 2) 상해발관리 테이블 (전체 공유 — 집중관리 대상 목록)
--    자동 열(도착지·선사·모선명·ETD 등)은 booking_seq_no로 실시간 조인,
--    수동 열(최초/현재 출항일·지연일)만 저장한다.
-- ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS shanghai_mgmt (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  booking_seq_no    BIGINT,                 -- 연결 부킹 고유번호 (NULL = 수동 행)
  sort_order        INTEGER DEFAULT 0,      -- 표시 순서
  first_departure   TEXT DEFAULT '',        -- F 최초 출항일 (상해/닝보)
  current_departure TEXT DEFAULT '',        -- G 현재 출항일 (상해/닝보)
  delay_shanghai    TEXT DEFAULT '',        -- H 지연일 (상해/닝보)
  delay_busan       TEXT DEFAULT '',        -- L 지연일 (부산)
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE shanghai_mgmt ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "shanghai_all" ON shanghai_mgmt;
CREATE POLICY "shanghai_all" ON shanghai_mgmt
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ================================================================
-- 완료! 위 스크립트 실행 후 앱을 새로고침하세요.
-- ================================================================
