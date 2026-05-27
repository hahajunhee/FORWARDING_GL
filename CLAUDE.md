# FORWARDING_GL — 포워딩 부킹 관리 시스템

해운 포워딩 부서의 부킹(Booking) 데이터를 엑셀 대신 웹으로 관리하는 내부 업무 도구. 부킹 조회·편집, 서류마감 메일 초안 생성, 리퍼 마감 메일 테이블 생성, 주요 스케줄 엑셀 다운로드 기능을 제공한다. Vercel에 배포되어 사내 인원이 초대코드로 가입 후 사용한다.

## 기술 스택

- **프레임워크**: Next.js 16 (App Router) + React 18 + TypeScript
- **스타일**: Tailwind CSS (shadcn/ui 미사용, 자체 컴포넌트)
- **DB·인증**: Supabase (PostgreSQL + Auth + RLS)
- **배포**: Vercel (main 브랜치 push 시 자동 배포)
- **패키지 매니저**: npm
- **주요 라이브러리**: date-fns, xlsx(엑셀 다운로드), docx(보고서 생성)

## 폴더 구조

```
app/
  layout.tsx              # 루트 레이아웃
  page.tsx                # / → /bookings 리다이렉트
  globals.css             # Tailwind + 커스텀 CSS
  actions/auth.ts         # 초대코드 검증 서버 액션
  login/                  # 로그인 페이지
  register/               # 회원가입 (초대코드 필요)
  admin/                  # 관리자 페이지 (마스터 전용)
    actions.ts            # 유저 활성화/비활성화/탈퇴/복귀, 초대코드·지역·고객사 관리
    AdminClient.tsx       # 관리자 UI (탈퇴 시 부킹 재배정 포함)
  bookings/
    page.tsx              # 메인 페이지 (Server Component — 데이터 페칭)
    actions.ts            # 부킹 CRUD·일괄저장·일괄삭제·열순서 저장
    [id]/edit/            # 단건 편집 폼 (미사용, 인라인 편집으로 대체)
    new/                  # 새 부킹 폼 (미사용, 인라인 추가로 대체)
  settings/
    page.tsx              # 설정 페이지 (Server Component)
    actions.ts            # 커스텀리스트·열정의·프로필·테이블스타일·서류마감템플릿 저장
  crawl/                  # SAP 크롤링 (실험적)
  api/crawl/              # 크롤링 API 라우트 (실험적)

components/
  BookingPageLayout.tsx   # 사이드바 탭 레이아웃 (부킹장·서류마감·리퍼마감·스케줄)
  BookingTable.tsx        # ★ 핵심 — 엑셀형 부킹 테이블 (~2400줄)
  DocCutoffTab.tsx        # 서류마감 메일 초안 탭
  ReeferCutoffTab.tsx     # 리퍼마감 메일 테이블 탭
  ScheduleTab.tsx         # 주요 스케줄 엑셀 다운로드 탭
  AuthForm.tsx            # 로그인/회원가입 폼
  BookingForm.tsx         # 부킹 폼 (레거시, 인라인 편집으로 대체됨)

lib/
  supabase.ts             # 브라우저 Supabase 클라이언트 (Client Component에서 사용 금지)
  supabase-server.ts      # Server Component / Server Action용 클라이언트
  supabase-admin.ts       # Service Role 클라이언트 (RLS 우회 — 관리자 전용)
  utils.ts                # 유틸 함수

types/
  index.ts                # 전체 타입 정의 (Booking, Profile, CustomList 등)

supabase/
  schema.sql              # 초기 스키마
  migration_v3~v13.sql    # 마이그레이션 파일들 (순서대로 적용)

scripts/
  sap_crawl.py            # SAP 크롤링 Python 스크립트 (실험적)

docs/
  generate_report.js      # docx 보고서 생성 스크립트
  FORWARDING_GL_도입보고서.docx
```

## 주요 명령어

```bash
npm install          # 의존성 설치
npm run dev          # 개발 서버 (http://localhost:3000)
npm run build        # 프로덕션 빌드
npm run lint         # ESLint 실행
```

## 환경 변수 (`.env.local`)

```
NEXT_PUBLIC_SUPABASE_URL=         # Supabase 프로젝트 URL
NEXT_PUBLIC_SUPABASE_ANON_KEY=    # Supabase anon key (브라우저 노출 가능)
SUPABASE_SERVICE_ROLE_KEY=        # Supabase service role key (서버 전용!)
VERCEL_TOKEN=                     # Vercel API 토큰 (배포 자동화용, 선택)
```

## 아키텍처 규칙

### CRITICAL — 반드시 지킬 것
- **데이터 페칭은 Server Component 또는 Server Action에서만.** Client Component에서 Supabase 직접 호출 금지. `lib/supabase.ts`는 미들웨어 전용.
- **`SUPABASE_SERVICE_ROLE_KEY`는 서버에서만.** `createAdminClient()`는 `app/admin/actions.ts`와 `app/actions/auth.ts`에서만 사용.
- **`NEXT_PUBLIC_` 접두사 없는 키는 클라이언트 번들에 절대 포함 금지.**

### 코드 컨벤션
- 커밋 메시지: conventional commits (`feat:`, `fix:`, `docs:`, `refactor:`, `chore:`)
- PR 없이 main 직접 커밋 (1인 개발), 기능 단위로 커밋 쪼개기
- Server Action은 각 라우트의 `actions.ts`에 정의
- UI 컴포넌트는 `components/`에, 서버 전용 로직은 `lib/`에
- 타입은 `types/index.ts`에 통합 관리

### BookingTable.tsx 핵심 패턴
- `DisplayRow = Booking | BlankSailingRow` 판별 합집합
- `useRef` 패턴으로 stale closure 방지 (Ctrl+C/X/Delete 핸들러)
- `buildSpanMaps`로 셀 병합 계산
- `canManageBooking()`: 본인 담당 또는 담당고객사 겹침 시 편집 가능
- 편집 변경사항은 `rowEdits` 상태에 누적 → 저장 시 `bulkSaveBookings` 호출
- pinned(sticky) 열은 inline `backgroundColor` + CSS `data-attribute`로 hover 해결

### 관리자 (Master)
- 마스터 이메일: `hahajunhee@glovis.net` (3곳에 하드코딩)
  - `app/admin/page.tsx`, `app/admin/actions.ts`, `components/BookingPageLayout.tsx`
- 마스터만 `/admin` 접근 가능, 유저 관리·초대코드·지역·고객사 목록 관리

## 건드리지 말 것

- `supabase/schema.sql` — 초기 스키마, 수정하면 기존 DB와 불일치
- `supabase/migration_*.sql` — 이미 적용된 마이그레이션, 수정 금지. 새 변경은 새 파일로
- `lib/supabase-admin.ts` — Service Role 클라이언트, 구조 변경 시 보안 위험
- `middleware.ts` — 인증 가드, 잘못 건드리면 전체 라우팅 장애

## Vercel 배포

- GitHub `main` 브랜치에 push하면 Vercel이 자동 빌드·배포
- 환경변수는 Vercel 대시보드에서 별도 설정 필요
- 빌드 명령: `next build` (Turbopack)
