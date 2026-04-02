-- migration v13: 유저별 테이블 스타일 설정 (테두리 색상·두께)
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS table_style JSONB DEFAULT NULL;
