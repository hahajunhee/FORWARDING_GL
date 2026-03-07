-- ============================================================
-- 포워더 부킹 관리 시스템 - Supabase 스키마 v2
-- Supabase SQL Editor에서 이 파일 전체를 실행하세요.
-- 기존 데이터가 있는 경우에도 안전하게 실행 가능합니다.
-- ============================================================

-- 1. 유저 프로필 테이블
CREATE TABLE IF NOT EXISTS profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  column_order JSONB DEFAULT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 기존 테이블에 column_order 추가 (이미 있으면 무시)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS column_order JSONB DEFAULT NULL;

-- 2. 부킹 테이블
CREATE TABLE IF NOT EXISTS bookings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  booking_no TEXT NOT NULL,
  final_destination TEXT DEFAULT '',
  discharge_port TEXT DEFAULT '',
  carrier TEXT DEFAULT '',
  vessel_name TEXT DEFAULT '',
  secured_space TEXT DEFAULT '',
  mqc TEXT DEFAULT '',
  customer_doc_handler TEXT DEFAULT '',
  forwarder_handler_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  doc_cutoff_date DATE,
  proforma_etd DATE,
  updated_etd DATE,
  eta DATE,
  -- 컨테이너 수량 (6종류)
  qty_20_normal INTEGER DEFAULT 0,
  qty_20_dg INTEGER DEFAULT 0,
  qty_20_reefer INTEGER DEFAULT 0,
  qty_40_normal INTEGER DEFAULT 0,
  qty_40_dg INTEGER DEFAULT 0,
  qty_40_reefer INTEGER DEFAULT 0,
  remarks TEXT DEFAULT '',
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 기존 테이블에 신규 컬럼 추가 (이미 있으면 무시)
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS secured_space TEXT DEFAULT '';
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS mqc TEXT DEFAULT '';
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS qty_20_normal INTEGER DEFAULT 0;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS qty_20_dg INTEGER DEFAULT 0;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS qty_20_reefer INTEGER DEFAULT 0;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS qty_40_normal INTEGER DEFAULT 0;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS qty_40_dg INTEGER DEFAULT 0;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS qty_40_reefer INTEGER DEFAULT 0;

-- 3. 사용자별 커스텀 목록 테이블 (최종도착지, 양하항, 선사)
CREATE TABLE IF NOT EXISTS custom_lists (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE NOT NULL,
  list_type TEXT NOT NULL CHECK (list_type IN ('destination', 'port', 'carrier')),
  name TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, list_type, name)
);

-- 4. RLS(행 수준 보안) 활성화
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_lists ENABLE ROW LEVEL SECURITY;

-- 5. profiles 정책
DROP POLICY IF EXISTS "profiles_select" ON profiles;
CREATE POLICY "profiles_select" ON profiles
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "profiles_insert" ON profiles;
CREATE POLICY "profiles_insert" ON profiles
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "profiles_update" ON profiles;
CREATE POLICY "profiles_update" ON profiles
  FOR UPDATE TO authenticated USING (auth.uid() = id);

-- 6. bookings 정책
DROP POLICY IF EXISTS "bookings_select" ON bookings;
CREATE POLICY "bookings_select" ON bookings
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "bookings_insert" ON bookings;
CREATE POLICY "bookings_insert" ON bookings
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = created_by);

DROP POLICY IF EXISTS "bookings_update" ON bookings;
CREATE POLICY "bookings_update" ON bookings
  FOR UPDATE TO authenticated USING (true);

DROP POLICY IF EXISTS "bookings_delete" ON bookings;
CREATE POLICY "bookings_delete" ON bookings
  FOR DELETE TO authenticated
  USING (auth.uid() = created_by OR auth.uid() = forwarder_handler_id);

-- 7. custom_lists 정책 (본인 목록만 관리)
DROP POLICY IF EXISTS "custom_lists_all" ON custom_lists;
CREATE POLICY "custom_lists_all" ON custom_lists
  FOR ALL TO authenticated USING (user_id = auth.uid());

-- 8. updated_at 자동 갱신 트리거
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS bookings_updated_at ON bookings;
CREATE TRIGGER bookings_updated_at
  BEFORE UPDATE ON bookings
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- 9. 회원가입 시 profiles 자동 생성 트리거
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(
      NEW.raw_user_meta_data->>'name',
      split_part(NEW.email, '@', 1)
    )
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION handle_new_user();

-- ============================================================
-- 완료! 위 스크립트 실행 후 앱을 시작하세요.
-- ============================================================
