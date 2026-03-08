-- v9: 커스텀 열 설명 추가, 담당지역/담당고객사 마스터 목록 초기화

-- column_definitions에 description 컬럼 추가
ALTER TABLE column_definitions
  ADD COLUMN IF NOT EXISTS description TEXT DEFAULT '';

-- global_settings에 담당지역/담당고객사 목록 초기화 (빈 배열)
INSERT INTO global_settings (key, value)
VALUES ('region_list', '[]')
ON CONFLICT (key) DO NOTHING;

INSERT INTO global_settings (key, value)
VALUES ('customer_list', '[]')
ON CONFLICT (key) DO NOTHING;
