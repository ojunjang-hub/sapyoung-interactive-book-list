# 사회평론 도서목록 웹

사회평론의 414페이지 연간 인쇄 도서목록을 대체하는 인터랙티브 웹 카탈로그.

## 현재 상태 (2026-06-20)

빌드 순서 §1~7 완료. 이후 코드 리뷰 기반 보안/정합성 보강 및 UX 개선 6건 반영.
§8(인터랙티브 요소), §9(외부 공개 배포) 미착수.

| 단계 | 내용 | 상태 |
|------|------|------|
| §1 | IDML 추출 | ✅ 완료 |
| §2 | 알라딘 API 보강 | ✅ 완료 |
| §3 | SQLite DB 구축 | ✅ 완료 |
| §4 | 그리드 + 검색 + 필터 화면 | ✅ 완료 |
| §5 | 상세 페이지 + 외부 서점 링크 | ✅ 완료 |
| §6 | 관리자 화면 | ✅ 완료 |
| §7 | Claude AI 자연어 검색 | ✅ 완료 |
| — | 보안/정합성 보강 + UX 개선 6건 | ✅ 완료 |
| §8 | 인터랙티브 요소 (연관도서·읽는순서·MBTI) | ⏳ 미착수 |
| §9 | 외부 공개 배포 (사내 리눅스 서버) | ⏳ 미착수 |

### 최근 변경 (2026-06-20)

- **공개/내부 뷰 분리**: 기본 `public`, `?mode=internal`로 내부 모드 전환(localStorage로 유지). 공개 뷰에서 관리자 링크·부서 필터·내부 지표(판매지수) 숨김.
- **검색 모드 토글**: 첫 화면에서 `일반 검색`(제목·저자 매칭) / `AI 검색`(Claude) 선택.
- **브라우저 뒤로가기**: History API로 목록↔상세, 필터·검색어·정렬·스크롤 위치 복원.
- **서점 링크 정상화**: 교보문고·예스24 링크를 ISBN 기반 정상 URL로 교체(상세 `book.js`에서 생성).
- **표지 누락 대응**: 표지 있는 책을 정렬·신간 영역에서 우선 노출, 누락분은 알라딘 재수급.
- **상세 페이지 정리**: 판매가·알라딘 분류 제거(판매지수는 내부 뷰 전용).
- **보안 보강**: 관리자 키 fail-closed(`changeme`/빈값 거부), 상수시간 비교, 파일 업로드 경로 정제·크기 제한, AI 검색 IP 레이트리밋, 알라딘 키 `.env` 이전, 상세 API 컬럼 화이트리스트, 관리자 쓰기 시 AI 인덱스·공개 JSON 자동 재생성, 프롬프트 캐싱.

---

## 도서 데이터

- **원본**: 인디자인 IDML 파일 4개 (본문 3 + 백리스트 1)
- **총 882권** — 알라딘 API로 표지·설명·목차·서점 링크 보강
- **중복 처리**: 본문 부서 우선, 백리스트 단독 124권은 백리스트로 유지

| 부서 | 권수 |
|------|------|
| 아카데미 | 517 |
| 교양 | 155 |
| 백리스트 | 124 |
| 어린이 | 86 |

---

## 기술 스택

| 구분 | 기술 |
|------|------|
| 백엔드 | Python 3.14 + FastAPI + uvicorn |
| DB | SQLite (WAL 모드, `books_effective` 뷰) |
| 프런트 | 바닐라 HTML/CSS/JS (빌드 도구 없음) |
| AI 검색 | Claude Haiku (`claude-haiku-4-5-20251001`) + 프롬프트 캐싱 |
| 이미지 | 알라딘 CDN (`cover200` 썸네일, `cover500` 상세) |

---

## 프로젝트 구조

```
sapyoung_interactive_book_list/
├── .env                        # 환경 변수 (API 키 등 — git 미추적)
├── books.db                    # SQLite 정본 DB (git 미추적)
├── start_server.bat            # 윈도우 실행 스크립트 (경로 독립적)
├── backend/
│   ├── main.py                 # FastAPI 앱 진입점 (lifespan: AI 인덱스 빌드)
│   ├── config.py               # pydantic-settings 환경 변수
│   ├── database.py             # SQLite 연결 헬퍼
│   ├── auth.py                 # 관리자 인증 (X-Admin-Key, fail-closed)
│   ├── publish.py              # 공개용 정적 JSON(books.json) 재생성
│   └── routes/
│       ├── books.py            # 도서 목록·상세·필터 API
│       ├── admin.py            # 관리자 CRUD + 신간 추가 API
│       ├── files.py            # 파일 업로드·다운로드·삭제
│       └── search.py           # Claude AI 자연어 검색 (레이트리밋)
├── public/                     # 정적 파일 (FastAPI가 서빙)
│   ├── index.html / main.js    # 목록 페이지 (그리드 + 검색 토글 + 라우팅)
│   ├── book.html / book.js     # 상세 페이지
│   ├── admin.html / admin.js   # 관리자 화면
│   ├── util.js                 # 공통 유틸 (esc, 뷰 모드)
│   ├── config.js               # API 베이스 URL 설정
│   ├── style.css               # 공통 스타일
│   └── data/books.json         # 공개용 정적 스냅샷 (백엔드 폴백)
├── _workspace/                 # 빌드 중간 산출물·일회성 스크립트 (git 미추적)
└── .claude/                    # 하네스 에이전트·스킬 정의 (git 미추적)
```

---

## 로컬 실행

### 1. 환경 변수 설정

`.env` 파일 (실제 키 값은 커밋 금지 — `.gitignore`로 제외됨):

```
ALADIN_TTB_KEY=your_ttb_key
DB_PATH=./books.db
FILE_STORAGE_PATH=./storage
ADMIN_API_KEY=set_a_strong_key      ← 'changeme'/빈값이면 관리자 API가 막힘(fail-closed)
ANTHROPIC_API_KEY=sk-ant-...
PORT=8000
CORS_ORIGINS=http://localhost:8000
# 선택 (기본값 존재)
# MAX_UPLOAD_BYTES=52428800          # 업로드 최대 크기 (기본 50MB)
# AI_SEARCH_RATE_PER_MIN=15          # IP당 AI 검색 분당 한도
```

### 2. 의존성 설치

```bash
pip install fastapi uvicorn pydantic-settings python-multipart anthropic httpx
```

### 3. 서버 실행

```bash
# 프로젝트 루트에서
python -m uvicorn main:app --app-dir backend --reload --port 8000
# 또는 윈도우: start_server.bat 더블클릭 (경로 독립적)
```

### 4. 브라우저 접속

| URL | 설명 |
|-----|------|
| `http://localhost:8000` | 도서 목록 (그리드 + 검색 토글) |
| `http://localhost:8000/?mode=internal` | 내부 뷰(관리자 링크·부서 필터·판매지수 표시) |
| `http://localhost:8000/book.html?isbn=ISBN13` | 도서 상세 |
| `http://localhost:8000/admin.html` | 관리자 화면 |

---

## 공개(public) / 내부(internal) 뷰

- 외부 공개용과 사내 참조용을 겸하므로 두 가지 뷰 모드를 둔다. **기본값은 항상 `public`**.
- `?mode=internal`로 내부 모드 전환 → `localStorage`에 저장되어 페이지 이동 간 유지. `?mode=public`으로 해제.
- **public**: 상단 관리자 링크, 부서 필터(아카데미/백리스트 등 사내 사업부 구분), 상세 판매지수 등 내부 지표 숨김.
- **internal**: 위 항목 모두 노출.

---

## 검색 모드 / 라우팅

- **검색 모드 토글**: 첫 화면에서 `일반 검색`(제목·저자 텍스트 매칭, 목록 필터 재사용) / `AI 검색`(Claude 자연어) 선택. 기본은 일반 검색.
- **뒤로가기**: 화면 전환·필터 변경마다 History API로 항목을 남기고, 목록↔상세 이동 및 필터·검색어·정렬·스크롤 위치를 복원.

---

## API 엔드포인트

### 공개 API

| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/api/health` | 서버 상태 확인 |
| GET | `/api/books` | 도서 목록 (검색·필터·정렬·페이지) |
| GET | `/api/books/{isbn13}` | 도서 상세 + 첨부파일 목록 (공개 컬럼만) |
| GET | `/api/filters` | 필터 옵션 (부서·분류·시리즈·연도) |
| GET | `/api/books/{isbn13}/attachments/{id}` | 첨부파일 다운로드 |
| POST | `/api/search/natural` | AI 자연어 검색 (IP 레이트리밋) |

### 관리자 API (X-Admin-Key 헤더 필요)

| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/api/admin/verify` | 키 인증 확인 |
| GET | `/api/admin/books` | 전체 도서 목록 (오버라이드 정보 포함) |
| POST | `/api/admin/books/add` | ISBN13으로 신간 추가 (알라딘 보강) |
| PATCH | `/api/admin/books/{isbn13}/classification` | 부서·분류 편집 |
| PATCH | `/api/admin/books/{isbn13}/status` | 재고 상태 변경 |
| PATCH | `/api/admin/books/{isbn13}/cover` | 표지 URL 수정 |
| DELETE | `/api/admin/overrides/{isbn13}` | 분류 오버라이드 초기화 |
| POST | `/api/books/{isbn13}/attachments` | 파일 업로드 (크기 제한·경로 정제) |
| DELETE | `/api/books/{isbn13}/attachments/{id}` | 파일 삭제 |

> 관리자 쓰기(추가·분류·재고·표지·오버라이드 해제) 후 AI 검색 인덱스와 공개 JSON(`public/data/books.json`)을 자동 재생성한다.

---

## DB 스키마

```sql
books            -- 원본 도서 데이터 (882행)
admin_overrides  -- 관리자 분류 오버라이드 (isbn13 PK)
attachments      -- 파일 첨부 (강의계획서 등)

books_effective  -- 뷰: COALESCE(override, original) 적용
                 --   department_effective, category_effective
```

분류 편집은 `admin_overrides`에만 기록되어 원본 데이터를 보존하며,
`books_effective` 뷰를 통해 공개 API에 즉시 반영됩니다.

---

## AI 자연어 검색 동작 방식

1. 서버 시작 시 882권을 `isbn|제목|저자|분류|소개(60자)` 형식으로 압축 인덱스 생성 (메모리 적재)
2. 사용자 질의 → `POST /api/search/natural` (IP당 분당 호출 한도 적용)
3. 압축 인덱스를 캐시되는 system 블록(프롬프트 캐싱), 질의를 user 메시지로 **Claude Haiku**에 전달
4. Claude가 적합 도서 1~5권 + 추천 이유 + 요약 반환 (JSON)
5. ISBN으로 DB 조회 → 풍부한 도서 데이터와 합산 → 그리드 표시

벡터 DB 불필요. 현재 도서 규모(882권)에서 압축 인덱스 방식으로 충분. 관리자 변경 시 인덱스 자동 재빌드.

---

## 관리자 화면 기능

접속: `http://localhost:8000/admin.html` → API 키 입력

- **신간 추가**: ISBN13 입력 → 알라딘 보강으로 도서 추가(부서는 '미분류'로 들어가며 분류 편집 필요)
- **도서 검색**: 제목·저자·ISBN 검색, 부서·재고상태 필터
- **분류 편집**: 부서·분류 수정 → `admin_overrides`에 저장 (원본 보존)
- **분류 초기화**: 오버라이드 삭제 → 원본 분류 복원
- **재고 상태 변경**: 재고있음 / 품절 / 절판
- **표지 URL 수정**: 알라딘 CDN URL 직접 입력
- **파일 관리**: 강의계획서 등 첨부파일 업로드·다운로드·삭제

---

## 서점 링크 / 표지 이미지

### 서점 링크 (상세 페이지)

ISBN13 기반으로 `book.js`에서 직접 생성하며 모두 새 탭에서 열린다.

| 서점 | URL 패턴 |
|------|----------|
| 교보문고 | `https://search.kyobobook.co.kr/search?keyword={isbn}` |
| 예스24 | `https://www.yes24.com/product/search?query={isbn}` |
| 알라딘 | 보강된 상품 링크, 없으면 `https://www.aladin.co.kr/shop/wproduct.aspx?ISBN={isbn}` |

### 표지 이미지 규격

| 경로 | 크기 | 용도 |
|------|------|------|
| `cover200` | ~10KB / 200px | 목록 그리드 썸네일 |
| `cover500` | ~37KB / 500px | 상세 페이지 커버 |
| `coversum` | ~3KB / 89px | 저화질 |

DB와 books.json의 `cover_url`은 `cover200`으로 저장. 상세 페이지(`book.js`)에서 `cover500`으로 치환하여 표시.
표지가 없는 책은 목록·신간 영역에서 후순위로 정렬되며, 누락분은 알라딘 ItemLookUp으로 재수급(`_workspace/enrich_covers.py`).

---

## 다음 단계 (§8~§9)

- **연관 도서**: 같은 시리즈·분류의 도서를 상세 페이지 하단에 표시
- **읽는 순서 제안**: Claude가 시리즈 순서 또는 난이도 순 큐레이션
- **배포 준비 (§9)**: 사내 리눅스 서버 이식, `ADMIN_API_KEY` 강한 값 설정, CORS 설정, 노출됐던 알라딘 TTB 키 재발급
