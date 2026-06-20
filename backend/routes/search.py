import json
import logging
import time
from collections import deque

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from config import settings
from database import get_conn

router = APIRouter()

_book_index: str = ""

# ── 간단한 IP별 슬라이딩 윈도우 레이트리밋 (단일 프로세스 인메모리) ──
_RATE_WINDOW = 60.0
_rate_log: dict[str, deque] = {}


def _check_rate(ip: str) -> None:
    limit = settings.ai_search_rate_per_min
    now = time.monotonic()
    dq = _rate_log.setdefault(ip, deque())
    while dq and now - dq[0] > _RATE_WINDOW:
        dq.popleft()
    if not dq:
        # 비어 있으면 키 누적을 막기 위해 제거 후 빠르게 통과
        _rate_log.pop(ip, None)
        _rate_log[ip] = deque([now])
        return
    if len(dq) >= limit:
        raise HTTPException(429, "요청이 너무 잦습니다. 잠시 후 다시 시도하세요.")
    dq.append(now)


def _build_index() -> str:
    with get_conn() as conn:
        rows = conn.execute(
            """
            SELECT isbn13, title, author,
                   category_effective AS category,
                   description
            FROM books_effective
            WHERE stock_status IS NULL OR stock_status != '절판'
            ORDER BY pub_date DESC
            """
        ).fetchall()

    lines = []
    for r in rows:
        desc = r["description"] or ""
        short = desc.replace("\n", " ").split(".")[0][:60].strip()
        lines.append(
            f"{r['isbn13']}|{r['title'] or ''}|{r['author'] or ''}"
            f"|{r['category'] or ''}|{short}"
        )
    return "\n".join(lines)


def load_index() -> None:
    global _book_index
    _book_index = _build_index()
    logging.info("AI 검색 인덱스 빌드 완료: %d권", len(_book_index.splitlines()))


_SYSTEM = (
    "당신은 출판사 사회평론의 도서 큐레이터입니다. "
    "제공된 도서 인덱스에서 사용자 질의에 가장 적합한 도서를 추천합니다."
)

# 인덱스는 요청마다 동일하므로 system 블록으로 분리해 프롬프트 캐싱한다.
_INDEX_HEADER = "도서 인덱스 (형식: ISBN|제목|저자|분야|소개):\n"

_USER_TEMPLATE = """\
사용자 질의: {query}

적합한 도서 1~5권을 선택하고 아래 JSON 형식으로만 응답하라 (다른 텍스트 없이):
{{
  "books": [
    {{"isbn13": "9788900000000", "reason": "추천 이유 1~2문장"}}
  ],
  "summary": "전반적 검색 결과 설명 1문장"
}}"""


class SearchRequest(BaseModel):
    query: str


@router.post("/natural")
async def natural_search(req: SearchRequest, request: Request):
    _check_rate(request.client.host if request.client else "unknown")

    if not _book_index:
        raise HTTPException(503, "인덱스 준비 중입니다. 잠시 후 다시 시도하세요.")

    api_key = settings.anthropic_api_key
    if not api_key:
        raise HTTPException(503, "ANTHROPIC_API_KEY가 설정되지 않았습니다.")

    import anthropic  # lazy import — only needed when actually called

    client = anthropic.Anthropic(api_key=api_key)
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

    isbns = [b["isbn13"] for b in result.get("books", [])]
    if not isbns:
        return {"books": [], "summary": result.get("summary", "")}

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
    for rec in result["books"]:
        detail = detail_map.get(rec["isbn13"])
        if detail:
            enriched.append({**detail, "ai_reason": rec.get("reason", "")})

    logging.info("자연어 검색: '%s' → %d권", req.query, len(enriched))
    return {"books": enriched, "summary": result.get("summary", "")}
