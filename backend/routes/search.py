import json
import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from config import settings
from database import get_conn

router = APIRouter()

_book_index: str = ""


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

_USER_TEMPLATE = """\
도서 인덱스 (형식: ISBN|제목|저자|분야|소개):
{index}

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
async def natural_search(req: SearchRequest):
    if not _book_index:
        raise HTTPException(503, "인덱스 준비 중입니다. 잠시 후 다시 시도하세요.")

    api_key = settings.anthropic_api_key
    if not api_key:
        raise HTTPException(503, "ANTHROPIC_API_KEY가 설정되지 않았습니다.")

    import anthropic  # lazy import — only needed when actually called

    client = anthropic.Anthropic(api_key=api_key)
    user_msg = _USER_TEMPLATE.format(index=_book_index, query=req.query)

    result = None
    last_err = None
    for attempt in range(3):
        try:
            msg = client.messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=1024,
                system=_SYSTEM,
                messages=[{"role": "user", "content": user_msg}],
            )
            raw = msg.content[0].text.strip()
            # strip possible markdown fences
            if raw.startswith("```"):
                raw = raw.split("```")[1]
                if raw.startswith("json"):
                    raw = raw[4:]
            result = json.loads(raw)
            break
        except json.JSONDecodeError as e:
            last_err = f"JSON 파싱 실패: {e}"
        except Exception as e:
            last_err = str(e)

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
