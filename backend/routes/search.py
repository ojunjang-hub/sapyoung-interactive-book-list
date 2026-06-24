import difflib
import json
import logging
import re
import time
from collections import deque

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from config import settings
from database import get_conn

router = APIRouter()

_book_index: str = ""
# 인덱스 각 줄 번호(0-base) → ISBN13 매핑. 모델에는 짧은 번호만 노출해
# 13자리 ISBN을 잘못 옮겨 적는 문제를 방지한다.
_index_isbns: list[str] = []

# 요청마다 새로 만들지 않고 재사용하는 Anthropic 클라이언트(연결 풀 재사용).
_client = None

# ── 간단한 IP별 슬라이딩 윈도우 레이트리밋 (단일 프로세스 인메모리) ──
_RATE_WINDOW = 60.0
_rate_log: dict[str, deque] = {}


def _check_rate(ip: str) -> None:
    limit = settings.ai_search_rate_per_min
    now = time.monotonic()
    dq = _rate_log.setdefault(ip, deque())
    while dq and now - dq[0] > _RATE_WINDOW:
        dq.popleft()
    if len(dq) >= limit:
        raise HTTPException(429, "요청이 너무 잦습니다. 잠시 후 다시 시도하세요.")
    dq.append(now)


# 인덱스 한 줄에 담을 소개문 최대 길이. 너무 짧으면 모델이 주제를 파악하지 못해
# 추천 적합도가 떨어진다(첫 문장 60자만 쓰던 기존 방식의 문제).
_DESC_MAX = 180


def _clean_desc(*candidates: str | None) -> str:
    """비어 있지 않은 첫 후보를 골라 한 줄로 정규화하고 길이를 제한한다."""
    for text in candidates:
        if text and text.strip():
            s = " ".join(text.split())  # 개행·연속 공백 정리
            return s[:_DESC_MAX].strip()
    return ""


def _title_key(s: str | None) -> str:
    """제목 비교용 정규화: 공백·기호 제거, 소문자화."""
    return re.sub(r"[^0-9a-z가-힣]", "", (s or "").lower())


def _title_matches(actual: str | None, claimed: str | None) -> bool:
    """모델이 돌려준 제목과 실제 도서 제목이 같은 책을 가리키는지 검증.

    모델이 가끔 엉뚱한 줄 번호(id)를 골라 해설과 책이 어긋나는 경우를 걸러낸다.
    모델이 제목을 주지 않으면(빈 값) 검증을 건너뛴다(통과).
    """
    if not claimed:
        return True
    a, b = _title_key(actual), _title_key(claimed)
    if not a or not b:
        return True
    if a in b or b in a:
        return True
    return difflib.SequenceMatcher(None, a, b).ratio() >= 0.5


def _build_index() -> tuple[str, list[str]]:
    with get_conn() as conn:
        rows = conn.execute(
            """
            SELECT isbn13, title, author, series,
                   department_effective AS department,
                   category_effective   AS category,
                   description, full_description
            FROM books_effective
            WHERE stock_status IS NULL OR stock_status != '절판'
            ORDER BY pub_date DESC
            """
        ).fetchall()

    lines = []
    isbns = []
    for i, r in enumerate(rows):
        # description이 비면 full_description 앞부분으로 보강
        desc = _clean_desc(r["description"], r["full_description"])
        isbns.append(r["isbn13"])
        lines.append(
            f"{i}|{r['title'] or ''}|{r['author'] or ''}"
            f"|{r['department'] or ''}|{r['category'] or ''}"
            f"|{r['series'] or ''}|{desc}"
        )
    return "\n".join(lines), isbns


def load_index() -> None:
    global _book_index, _index_isbns
    _book_index, _index_isbns = _build_index()
    logging.info("AI 검색 인덱스 빌드 완료: %d권", len(_index_isbns))


_SYSTEM = (
    "당신은 출판사 사회평론의 도서 큐레이터입니다. "
    "제공된 도서 인덱스에서 사용자 질의에 가장 적합한 도서를 추천합니다. "
    "질의의 주제·분야·대상 독자(예: 어린이/일반/전공)·목적을 두루 고려해 "
    "의미적으로 관련된 책을 고르세요. 제목에 검색어가 그대로 없더라도 "
    "소개·분야·시리즈로 보아 주제가 맞으면 적합한 후보입니다."
)

# 인덱스는 요청마다 동일하므로 system 블록으로 분리해 프롬프트 캐싱한다.
_INDEX_HEADER = "도서 인덱스 (형식: 번호|제목|저자|부서|분야|시리즈|소개):\n"

_USER_TEMPLATE = """\
사용자 질의: {query}

위 인덱스에서 질의에 가장 적합한 도서를 골라 아래 JSON 형식으로만 응답하라 (다른 텍스트 없이).

규칙:
- 관련성이 높은 순으로 최대 5권. 질의와 어느 정도라도 관련된 책이 있으면 빈 배열을 반환하지 말고 가장 가까운 책을 추천하라. 정말로 관련 도서가 하나도 없을 때만 books를 빈 배열로 두라.
- "id"에는 반드시 고른 줄의 맨 앞 번호를 그대로 적어라. 번호를 임의로 바꾸지 마라.
- "title"에는 그 줄의 제목을 그대로 옮겨 적어라(번호와 제목이 어긋나지 않도록 하는 검증용).
- "reason"은 그 책이 질의에 왜 맞는지 1~2문장으로, 해당 책의 실제 내용에 근거해 쓴다.
{{
  "books": [
    {{"id": 12, "title": "그 줄의 제목", "reason": "추천 이유 1~2문장"}}
  ],
  "summary": "전반적 검색 결과 설명 1문장"
}}"""


class SearchRequest(BaseModel):
    query: str


# 동기 블로킹 핸들러(sqlite + 수 초가 걸리는 모델 호출)이므로 async가 아닌 def로
# 선언해 FastAPI가 스레드풀에서 실행하게 한다(이벤트 루프를 막지 않음).
@router.post("/natural")
def natural_search(req: SearchRequest, request: Request):
    _check_rate(request.client.host if request.client else "unknown")

    if not _book_index:
        raise HTTPException(503, "인덱스 준비 중입니다. 잠시 후 다시 시도하세요.")

    api_key = settings.anthropic_api_key
    if not api_key:
        raise HTTPException(503, "ANTHROPIC_API_KEY가 설정되지 않았습니다.")

    import anthropic  # lazy import — only needed when actually called

    global _client
    if _client is None:
        _client = anthropic.Anthropic(api_key=api_key)
    client = _client
    user_msg = _USER_TEMPLATE.format(query=req.query)
    # 고정 인덱스는 캐시되는 system 블록, 가변 질의는 user 메시지로 분리
    system_blocks = [
        {"type": "text", "text": _SYSTEM},
        {
            "type": "text",
            "text": _INDEX_HEADER + _book_index,
            "cache_control": {"type": "ephemeral"},
        },
    ]

    def _call_model():
        msg = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=1024,
            system=system_blocks,
            messages=[{"role": "user", "content": user_msg}],
        )
        raw = msg.content[0].text.strip()
        # strip possible markdown fences
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        return json.loads(raw)

    # SDK가 429/5xx는 자동 재시도하므로, 여기서는 모델이 잘못된 JSON을 준 경우만 재시도.
    result = None
    last_err = None
    for _attempt in range(3):
        try:
            result = _call_model()
            break
        except json.JSONDecodeError as e:
            last_err = f"JSON 파싱 실패: {e}"
        except anthropic.APIError as e:
            # 인증/요청 오류 등은 재시도해도 동일 — 즉시 중단
            last_err = str(e)
            break

    if result is None:
        logging.error("AI 검색 실패: %s", last_err)
        raise HTTPException(503, f"AI 검색 일시 불가: {last_err}")

    # 모델이 고른 줄 번호(id)를 ISBN으로 환원한다. 잘못된/범위 밖 번호는 버린다.
    picks: list[tuple[str, str, str]] = []  # (isbn13, reason, claimed_title)
    seen: set[str] = set()
    for rec in result.get("books", []):
        try:
            idx = int(rec.get("id"))
        except (TypeError, ValueError):
            continue
        if not (0 <= idx < len(_index_isbns)):
            continue
        isbn = _index_isbns[idx]
        if isbn in seen:
            continue
        seen.add(isbn)
        picks.append((isbn, rec.get("reason", ""), rec.get("title", "")))

    if not picks:
        return {"books": [], "summary": result.get("summary", "")}

    isbns = [p[0] for p in picks]
    placeholders = ",".join("?" * len(isbns))
    with get_conn() as conn:
        rows = conn.execute(
            f"""
            SELECT isbn13, title, author, cover_url,
                   price_sales, stock_status,
                   department_effective AS department,
                   category_effective  AS category
            FROM books_effective
            WHERE isbn13 IN ({placeholders})
            """,
            isbns,
        ).fetchall()

    detail_map = {r["isbn13"]: dict(r) for r in rows}
    enriched = []
    for isbn, reason, claimed_title in picks:
        detail = detail_map.get(isbn)
        if not detail:
            continue
        # 모델이 엉뚱한 번호를 골라 해설과 책이 어긋난 경우를 제외한다.
        if not _title_matches(detail.get("title"), claimed_title):
            logging.warning(
                "AI 검색 제목 불일치로 제외: 실제='%s' / 모델='%s'",
                detail.get("title"), claimed_title,
            )
            continue
        enriched.append({**detail, "ai_reason": reason})

    logging.info("자연어 검색: '%s' → %d권", req.query, len(enriched))
    return {"books": enriched, "summary": result.get("summary", "")}
