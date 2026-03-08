-- v8: 프로필 정보 확장, 초대코드, 계정 활성화 관리

-- profiles: 담당지역, 담당고객사, 활성여부 추가
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS region    TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS customers TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;

-- global_settings에 초대코드 추가 (이미 테이블 존재)
INSERT INTO global_settings (key, value)
VALUES ('invite_code', 'GLOVIS_00')
ON CONFLICT (key) DO NOTHING;

-- global_settings: 인증 없이도 읽을 수 있도록 (초대코드 서버검증용)
-- (기존 policy가 있다면 이미 적용됨. 없는 경우:)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'global_settings' AND policyname = 'Public read global_settings'
  ) THEN
    EXECUTE 'CREATE POLICY "Public read global_settings" ON global_settings FOR SELECT USING (true)';
  END IF;
END $$;
