-- Migration v12: 최종도착지 행 배경색 (custom_lists.color)

-- custom_lists 테이블에 color 컬럼 추가
ALTER TABLE custom_lists ADD COLUMN IF NOT EXISTS color TEXT DEFAULT NULL;
