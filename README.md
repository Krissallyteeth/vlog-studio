# Vlog Studio

촬영 전 기획(前期策划)부터 동선(行程)·촬영 체크리스트(必拍镜头), 현장 기록(现场记录), 촬영 후 이야기(故事感)·편집 구성(剪辑)까지 한 프로젝트 안에서 관리하는 모바일 우선 PWA입니다.

- Vanilla JavaScript (ES Modules) · Vite · Tailwind CSS v4 (공식 Vite 플러그인) · IndexedDB · vite-plugin-pwa
- 백엔드 없음. **모든 데이터는 사용 중인 기기의 브라우저(IndexedDB)에만 저장**되며, 서버 업로드나 기기 간 동기화는 없습니다. 정기적으로 `백업·설정 → 백업 파일 저장`으로 JSON을 보관하세요.

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
