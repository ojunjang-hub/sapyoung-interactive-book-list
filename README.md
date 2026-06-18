# 사회평론 도서목록 웹

사회평론의 414페이지 연간 인쇄 도서목록을 대체하는 인터랙티브 웹 카탈로그.

## 현재 상태 (2026-06-18)

빌드 순서 §1~7 완료. §8(인터랙티브 요소), §9(외부 공개 배포) 미착수.

| 단계 | 내용 | 상태 |
|------|------|------|
| §1 | IDML 추출 | ✅ 완료 |
| §2 | 알라딘 API 보강 | ✅ 완료 |
| §3 | SQLite DB 구축 | ✅ 완료 |
| §4 | 그리드 + 검색 + 필터 화면 | ✅ 완료 |
| §5 | 상세 페이지 + 외부 서점 링크 | ✅ 완료 |
| §6 | 관리자 화면 | ✅ 완료 |
| §7 | Claude AI 자연어 검색 | ✅ 완료 |
| §8 | 인터랙티브 요소 (연관도서·읽는순서·MBTI) | ⏳ 미착수 |
| §9 | 외부 공개 배포 (사내 리눅스 서버) | ⏳ 미착수 |

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
| AI 검색 | Claude Haiku (`claude-haiku-4-5-20251001`) |
| 이미지 | 알라딘 CDN (`cover200` 썸네일, `cover500` 상세) |

---

## 프로젝트 구조

```
sapyoung_interactive_book_list/
├── .env                        # 환경 변수 (API 키 등)
├── books.db                    # SQLite 정본 DB
├── backend/
│   ├── main.py                 # FastAPI 앱 진입점 (lifespan: AI 인덱스 빌드)
│   ├── config.py               # pydantic-settings 환경 변수
│   ├── database.py             # SQLite 연결 헬퍼
│   ├── auth.py                 # 관리자 인증 (X-Admin-Key)
│   └── routes/
│       ├── books.py            # 도서 목록·상세·필터 API
│       ├── admin.py            # 관리자 CRUD API
│       ├── files.py            # 파일 업로드·다운로드·삭제
│       └── search.py           # Claude AI 자연어 검색
├── public/                     # 정적 파일 (FastAPI가 서빙)
│   ├── index.html / main.js    # 목록 페이지 (그리드 + AI 검색 바)
│   ├── book.html / book.js     # 상세 페이지
│   ├── admin.html / admin.js   # 관리자 화면
│   ├── config.js               # API 베이스 URL 설정
│   ├── style.css               # 공통 스타일
│   └── data/books.json         # 공개용 정적 스냅샷 (백엔드 폴백)
├── _workspace/                 # 빌드 중간 산출물 (스크립트·리포트)
└── .claude/                    # 하네스 에이전트·스킬 정의
```

---

## 로컬 실행

### 1. 환경 변수 설정

`.env` 파일 확인:

```
ALADIN_TTB_KEY=ttbojunjang2101001
DB_PATH=./books.db
FILE_STORAGE_PATH=./storage
ADMIN_API_KEY=changeme_before_deploy    ← 배포 전 반드시 변경
ANTHROPIC_API_KEY=sk-ant-...
PORT=8000
CORS_ORIGINS=http://localhost:8000
```

### 2. 의존성 설치

```bash
pip install fastapi uvicorn pydantic-settings python-multipart anthropic
```

### 3. 서버 실행

```bash
cd backend
python -m uvicorn main:app --reload --port 8000
```

### 4. 브라우저 접속

| URL | 설명 |
|-----|------|
| `http://localhost:8000` | 도서 목록 (그리드 + AI 검색) |
| `http://localhost:8000/book.html?isbn=ISBN13` | 도서 상세 |
| `http://localhost:8000/admin.html` | 관리자 화면 |

---

## API 엔드포인트

### 공개 API

| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/api/health` | 서버 상태 확인 |
| GET | `/api/books` | 도서 목록 (검색·필터·정렬·페이지) |
| GET | `/api/books/{isbn13}` | 도서 상세 + 첨부파일 목록 |
| GET | `/api/filters` | 필터 옵션 (부서·분류·시리즈·연도) |
| GET | `/api/books/{isbn13}/attachments/{id}` | 첨부파일 다운로드 |
| POST | `/api/search/natural` | AI 자연어 검색 |

### 관리자 API (X-Admin-Key 헤더 필요)

| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/api/admin/verify` | 키 인증 확인 |
| GET | `/api/admin/books` | 전체 도서 목록 (오버라이드 정보 포함) |
| PATCH | `/api/admin/books/{isbn13}/classification` | 부서·분류 편집 |
| PATCH | `/api/admin/books/{isbn13}/status` | 재고 상태 변경 |
| PATCH | `/api/admin/books/{isbn13}/cover` | 표지 URL 수정 |
| DELETE | `/api/admin/overrides/{isbn13}` | 분류 오버라이드 초기화 |
| POST | `/api/books/{isbn13}/attachments` | 파일 업로드 |
| DELETE | `/api/books/{isbn13}/attachments/{id}` | 파일 삭제 |

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
2. 사용자 질의 → `POST /api/search/natural`
3. 압축 인덱스 + 질의를 **Claude Haiku**에 전달 (~3만 토큰, 호출당 약 $0.008)
4. Claude가 적합 도서 1~5권 + 추천 이유 + 요약 반환 (JSON)
5. ISBN으로 DB 조회 → 풍부한 도서 데이터와 합산 → 그리드 표시

벡터 DB 불필요. 현재 도서 규모(882권)에서 압축 인덱스 방식으로 충분.

---

## 관리자 화면 기능

접속: `http://localhost:8000/admin.html` → API 키 입력

- **도서 검색**: 제목·저자·ISBN 검색, 부서·재고상태 필터
- **분류 편집**: 부서·분류 수정 → `admin_overrides`에 저장 (원본 보존)
- **분류 초기화**: 오버라이드 삭제 → 원본 분류 복원
- **재고 상태 변경**: 재고있음 / 품절 / 절판
- **표지 URL 수정**: 알라딘 CDN URL 직접 입력
- **파일 관리**: 강의계획서 등 첨부파일 업로드·다운로드·삭제

---

## 표지 이미지 규격

알라딘 CDN URL 경로 규칙:

| 경로 | 크기 | 용도 |
|------|------|------|
| `cover200` | ~10KB / 200px | 목록 그리드 썸네일 |
| `cover500` | ~37KB / 500px | 상세 페이지 커버 |
| `coversum` | ~3KB / 89px | 사용 안 함 (원본, 저화질) |
| `coverl` | 404 | 존재하지 않음 (사용 금지) |

DB와 books.json의 `cover_url`은 `cover200`으로 저장. 상세 페이지(`book.js`)에서 `cover500`으로 치환하여 표시.

---

## 다음 단계 (§8)

- **연관 도서**: 같은 시리즈·분류의 도서를 상세 페이지 하단에 표시
- **읽는 순서 제안**: Claude가 시리즈 순서 또는 난이도 순 큐레이션
- **배포 준비 (§9)**: 사내 리눅스 서버 이식, ADMIN_API_KEY 변경, CORS 설정
