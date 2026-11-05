# Vlog Studio

촬영 전 기획(前期策划)부터 동선(行程)·촬영 체크리스트(必拍镜头), 현장 기록(现场记录), 촬영 후 이야기(故事感)·편집 구성(剪辑)까지 한 프로젝트 안에서 관리하는 모바일 우선 PWA입니다.

- Vanilla JavaScript (ES Modules) · Vite · Tailwind CSS v4 (공식 Vite 플러그인) · IndexedDB · vite-plugin-pwa
- 데이터는 사용 중인 기기의 브라우저(IndexedDB)에 저장되어 오프라인에서도 동작합니다. Supabase를 연결하면 같은 계정으로 로그인한 모든 기기와 자동으로 동기화됩니다 (아래 참고). 연결하지 않으면 기기에만 저장되니 `백업·설정 → 백업 파일 저장`으로 JSON을 보관하세요.

## 기기 간 동기화 (Supabase)

1. [supabase.com](https://supabase.com)에서 새 프로젝트를 만듭니다.
2. **SQL Editor**에 `supabase/schema.sql` 내용을 붙여 넣고 실행합니다 (여러 번 실행해도 안전).
3. **Project Settings → API**의 Project URL과 anon(publishable) key를 `.env.production`에 넣습니다.
   ```
   VITE_SUPABASE_URL=https://xxxx.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJ...
   ```
   anon key는 공개용 키입니다. 행 수준 보안(RLS) 때문에 각 사용자는 자기 기록만 읽고 쓸 수 있습니다.
4. **Authentication → URL Configuration**의 Site URL을 배포 주소(`https://<사용자명>.github.io/vlog-studio/`)로 설정합니다.
5. 앱의 `백업·설정`에서 회원가입 후, 다른 기기에서도 같은 계정으로 로그인합니다.

동작 방식: 기기 저장이 기본이고, 로그인 상태에서 변경분을 올리고(편집 1.5초 후, 앱이 백그라운드로 갈 때) 다른 기기 변경분을 받아옵니다(앱을 열 때, 다시 볼 때, 온라인 복귀 시, 30초마다). 같은 프로젝트를 두 기기에서 고치면 **나중에 수정한 쪽**이 남습니다.

## 小红书 성과 관리

하단 메뉴 **콘텐츠 · 대시보드 · 데이터 · 더보기**에서 사용합니다.

- **엑셀 가져오기** (`데이터 → 엑셀 가져오기`): `VLOG운영기록` 엑셀의 4개 시트(XHS배포기록·수익기록·성과기준·기준)를 읽어, 원본 셀과 앱 저장값·원본 수식 결과와 앱 계산값을 한 칸씩 대조해 보여준 뒤 확인을 누를 때만 저장합니다. 같은 파일·같은 게시물은 중복으로 표시되고, 값이 다르면 게시물별로 유지/덮어쓰기를 고릅니다. 모르는 열과 원본 셀 전체는 원본 필드로 보존됩니다.
- **엑셀형 데이터 관리**: 원본과 같은 열 순서(D / D+1 / D+2), 고정 헤더·고정 열, 검색·정렬·유형·광고혼입 필터, 열 숨기기, 셀 편집·여러 칸 붙여넣기·되돌리기·저장 전 변경 확인, 모바일 카드 보기.
- **통계**: 엑셀 수식을 그대로 재현합니다 — 총 인터렉션 `(点赞+评论+收藏+分享+涨粉丝)/观看数`, 평균 시청 비율 `平均观看时长/视频时长`, 고정 중앙값(초기 유효 11편, Version 1, 자동 변경 없음), 초기 5편·최근 유효 5편/10편, 개선율·추세, 조건부 색상(노출·조회 ±20%, 나머지 ±10%, 2초 이탈률은 반대, 초록 `#DCFCE7` · 노랑 `#FEF3C7` · 빨강 `#FEE2E2`). 광고혼입은 중앙값·추세에서 제외하고 색상만 참고로 보여줍니다.
- **대시보드 · 게시물 분석 · 광고/수익 · 기준선 버전**: 새 기준선은 사용자가 승인할 때만 추가되고 이전 버전은 보존됩니다.
- **스크린샷 인식(OCR)**: tesseract.js(중국어 간체+영어)를 브라우저에서 실행합니다. 엔진과 언어 데이터는 앱과 함께 `/ocr/`로 배포되며(약 9MB, 첫 사용 때만 내려받음) 이미지는 외부로 전송되지 않습니다. 신뢰도가 낮거나 형식이 맞지 않는 값은 채우지 않고 "확인 필요"로 표시합니다.

### 데이터 저장 위치와 개인정보

- 성과·광고·수익·스크린샷 데이터는 **이 기기 브라우저의 별도 IndexedDB(`vlog-studio-xhs`)에만** 저장되고 기기 간 동기화되지 않습니다(기획 데이터는 기존처럼 로그인 시 동기화). 옮길 때는 `더보기 → 성과 데이터 백업`의 JSON 백업/복원을 쓰세요. 엑셀·CSV로도 내보낼 수 있습니다.
- 원본 엑셀 등 개인 파일은 `private-data/` 폴더에 두며, 이 폴더는 `.gitignore`에 등록되어 커밋·배포되지 않습니다. 저장소 테스트는 가상의 숫자만 사용합니다.

## 로컬 실행

Node.js 20.19 이상이 필요합니다.

```bash
npm install
npm run dev        # http://localhost:5173/vlog-studio/
npm test           # 자동화 테스트 (Vitest + fake-indexeddb)
npm run build      # dist/ 생성
npm run check:dist # dist가 /vlog-studio/ 하위 경로에서 동작하는지 검사
npm run preview    # http://localhost:4173/vlog-studio/ (Service Worker 포함 실제 빌드 확인)
```

개발 서버(`npm run dev`)에서는 Service Worker가 꺼져 있습니다. 오프라인 동작은 `build` 후 `preview`로 확인하세요.

## GitHub Pages 배포

리포지토리 이름이 `vlog-studio`라고 가정합니다 (다른 이름이면 워크플로가 자동으로 리포지토리 이름을 base path로 사용합니다).

1. GitHub에서 `vlog-studio` 리포지토리를 만듭니다.
2. 이 폴더에서:
   ```bash
   git init
   git add .
   git commit -m "Vlog Studio 첫 버전"
   git branch -M main
   git remote add origin https://github.com/<사용자명>/vlog-studio.git
   git push -u origin main
   ```
3. 리포지토리 **Settings → Pages → Build and deployment → Source**를 **GitHub Actions**로 설정합니다.
4. `main`에 push할 때마다 `.github/workflows/deploy.yml`이 테스트 → 빌드 → 경로 검사 → 배포를 실행합니다. **Actions** 탭에서 진행 상황을 확인하세요.
5. 배포 주소: `https://<사용자명>.github.io/vlog-studio/`

사용자 도메인이나 `<사용자명>.github.io` 루트에 배포할 때는 `BASE_PATH=/`로 빌드합니다.

## 휴대폰 홈 화면에 설치

- **iPhone (Safari)**: 배포 주소 열기 → 공유 버튼 → `홈 화면에 추가`
- **Android (Chrome)**: 배포 주소 열기 → 메뉴 `⋮` → `앱 설치` 또는 `홈 화면에 추가`

한 번 온라인에서 열면 앱 파일이 캐시되어 오프라인에서도 열고 기록할 수 있습니다. 새 버전이 배포되면 상단에 `업데이트` 배너가 표시되며, 업데이트해도 IndexedDB 기록은 그대로 유지됩니다.

> iOS에서는 Safari 탭과 홈 화면 앱의 저장소가 분리됩니다. Safari에서 작성한 기록을 홈 화면 앱으로 옮기려면 JSON 백업 → 복원을 사용하세요.

## 폴더 구조

```
index.html               앱 셸, iOS 메타 태그, 테마 깜빡임 방지
vite.config.js           base path(/vlog-studio/), Tailwind, PWA(manifest·workbox)
vitest.config.js         테스트 설정
public/                  favicon.svg, apple-touch-icon.png, icons/(192·512·maskable)
scripts/
  generate-icons.mjs     의존성 없이 PNG 아이콘 생성 (npm run icons)
  check-dist.mjs         빌드 결과물의 하위 경로·manifest·SW 검사
src/
  main.js                라우트 등록, 시작
  router.js              해시 라우터 (이동 전 자동 저장 flush)
  pwa.js                 Service Worker 등록, 업데이트 배너
  styles.css             Tailwind + 디자인 토큰(라이트/다크) + 컴포넌트
  lib/                   순수 로직 (테스트 대상)
    dates.js             로컬 날짜(YYYY-MM-DD) 파싱·표시·범위, UTC 밀림 방지
    sort.js              정렬(촬영일→수정일→생성일)·검색·필터
    schema.js            데이터 스키마 v1, 정규화·마이그레이션, 복제, 백업 검증
    progress.js          진행률, 촬영 완료율, 영상 길이 합계
    markdown.js          AI 대본 작성용 Markdown 내보내기
    constants.js, ids.js, path.js
  data/
    db.js                IndexedDB (projects · meta · media 스토어)
    repo.js              프로젝트 CRUD, 복제, 백업/복원
    autosave.js          디바운스 자동 저장 + 화면 이동/숨김 시 flush
  ui/                    DOM 헬퍼, 시트·다이얼로그, 아이콘, 입력 바인딩, 테마
  views/
    home.js              프로젝트 목록
    projectForm.js       프로젝트 생성/정보 수정
    detail.js            상세 화면 셸 (하단 탭, 메뉴, 저장 상태)
    settings.js          백업·복원·테마·저장 공간
    tabs/plan.js         촬영 전 기획
    tabs/route.js        동선
    tabs/shots.js        촬영 체크리스트
    tabs/field.js        현장 기록
    tabs/edit.js         촬영 후 스토리 + 편집 장면 구성
tests/                   dates · sort · schema(복제·백업·Markdown) · storage(IndexedDB·자동 저장)
```

## 데이터

- 프로젝트 1개 = IndexedDB `projects` 스토어의 문서 1개 (`id`, `schemaVersion`, `createdAt`, `updatedAt` 포함). 기획·동선·체크리스트·현장 기록·스토리·편집 장면이 모두 이 문서 안에 있습니다.
- 날짜는 현지 날짜 문자열 `YYYY-MM-DD`로 저장하고 `YYYY.MM.DD`로 표시합니다.
- 백업 JSON: `{ app: "vlog-studio", schemaVersion, exportedAt, projectCount, projects: [...] }`. 가져올 때 형식·버전·필수 항목·ID 중복을 검사하고, `합치기` 또는 `전체 교체`를 확인 후 실행합니다.
- 스키마를 바꿀 때는 `SCHEMA_VERSION`을 올리고 `migrateProject()`에 변환 단계를 추가합니다. IndexedDB 업그레이드는 스토어를 추가만 하고 삭제하지 않습니다.
- 음성 메모 확장용으로 현장 기록에 `attachments: []` 필드와 빈 `media` 스토어가 준비되어 있습니다.
