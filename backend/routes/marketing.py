"""마케팅 카드 — 관리자 전용 API.

편집부가 수기 입력하는 홍보용 콘텐츠(marketing_cards)를 다룬다. 모든 엔드포인트는
관리자 인증(X-Admin-Key)을 요구하며, 공개 영역(GET /api/books, public/data/books.json,
export)에는 절대 포함되지 않는다.

card_status는 컬럼으로 저장하지 않고 핵심 8개 필드의 채움 개수로 조회 시 계산한다:
  0개 → thin, 1~5개 → partial, 6개 이상 → thick
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from auth import verify_admin
from database import get_conn

router = APIRouter()

# card_status 계산 기준이 되는 핵심 8개 필드
CORE_FIELDS = (
    "obi_copy", "back_cover_copy", "promo_copy", "editor_comment",
    "promo_points", "key_quotes", "target_reader", "topical_keywords",
)

# marketing_cards의 전체(수기 입력) 필드 — updated_at은 서버가 기록하므로 제외
_EDITABLE_FIELDS = (*CORE_FIELDS, "promo_priority", "source_note", "updated_by")

# 응답에 항상 포함할 카드 필드(빈 기본 구조용)
_CARD_FIELDS = (*_EDITABLE_FIELDS, "updated_at")

_VALID_PRIORITY = {"신간", "스테디", "일반"}


def compute_status(card: dict) -> str:
    """핵심 8개 필드의 채움 개수로 카드 상태를 계산한다."""
    filled = sum(1 for f in CORE_FIELDS if (card.get(f) or "").strip())
    if filled == 0:
        return "thin"
    if filled >= 6:
        return "thick"
    return "partial"


def filled_count_sql(alias: str = "m") -> str:
    """핵심 8개 필드 중 비어있지 않은 개수를 세는 SQL 식.

    LEFT JOIN으로 카드가 없으면(NULL) COALESCE로 0이 되어 thin으로 계산된다.
    관리자 목록 쿼리(admin.py)에서 재사용한다.
    """
    terms = [f"(COALESCE({alias}.{f}, '') != '')" for f in CORE_FIELDS]
    return "(" + " + ".join(terms) + ")"


def card_status_case_sql(alias: str = "m") -> str:
    """채움 개수 → thin/partial/thick 문자열로 변환하는 SQL CASE 식."""
    cnt = filled_count_sql(alias)
    return (
        f"CASE WHEN {cnt} = 0 THEN 'thin' "
        f"WHEN {cnt} >= 6 THEN 'thick' ELSE 'partial' END"
    )


def _empty_card(isbn13: str) -> dict:
    card = {f: None for f in _CARD_FIELDS}
    card["isbn13"] = isbn13
    card["promo_priority"] = "일반"
    return card


class MarketingCardUpdate(BaseModel):
    """마케팅 카드 upsert. 보낸(set) 필드만 갱신한다(exclude_unset)."""
    obi_copy: str | None = None
    back_cover_copy: str | None = None
    promo_copy: str | None = None
    editor_comment: str | None = None
    promo_points: str | None = None
    key_quotes: str | None = None
    target_reader: str | None = None
    topical_keywords: str | None = None
    promo_priority: str | None = None
    source_note: str | None = None
    updated_by: str | None = None


# books 얇은 카드 필드(export?include_thin_fields=true). books_effective에서 조인.
_THIN_SELECT = (
    "b.title, b.subtitle, b.author, "
    "b.department_effective AS department, "
    "b.category_effective   AS category, "
    "b.pub_date, b.description, b.full_description, "
    "b.toc, b.publisher_description"
)


# ── 참고: /export는 /{isbn13}보다 먼저 선언해야 'export'가 경로 파라미터로 잡히지 않음 ──

@router.get("/export")
async def export_marketing(
    include_thin_fields: bool = Query(False),
    _: str = Depends(verify_admin),
):
    """전체 마케팅 카드를 JSON 배열로 반환. 마케팅 추천 시스템의 데이터 공급 경로."""
    with get_conn() as conn:
        cards = [dict(r) for r in conn.execute(
            "SELECT * FROM marketing_cards ORDER BY updated_at DESC"
        ).fetchall()]

        thin_by_isbn = {}
        if include_thin_fields and cards:
            isbns = [c["isbn13"] for c in cards]
            ph = ",".join("?" * len(isbns))
            rows = conn.execute(
                f"SELECT b.isbn13, {_THIN_SELECT} "
                f"FROM books_effective b WHERE b.isbn13 IN ({ph})",
                isbns,
            ).fetchall()
            thin_by_isbn = {r["isbn13"]: dict(r) for r in rows}

    result = []
    for card in cards:
        card["card_status"] = compute_status(card)
        if include_thin_fields:
            card["thin_fields"] = thin_by_isbn.get(card["isbn13"], {})
        result.append(card)
    return {"total": len(result), "items": result}


@router.get("/{isbn13}")
async def get_marketing(isbn13: str, _: str = Depends(verify_admin)):
    """마케팅 카드 조회. 카드가 없으면 빈 기본 구조를 반환한다(404 아님)."""
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM marketing_cards WHERE isbn13 = ?", (isbn13,)
        ).fetchone()
    card = dict(row) if row else _empty_card(isbn13)
    card["card_status"] = compute_status(card)
    return card


@router.put("/{isbn13}")
async def upsert_marketing(
    isbn13: str,
    body: MarketingCardUpdate,
    _: str = Depends(verify_admin),
):
    """마케팅 카드 upsert. 보낸 필드만 갱신하고 updated_at을 서버에서 기록한다."""
    data = body.model_dump(exclude_unset=True)

    if "promo_priority" in data:
        pri = (data["promo_priority"] or "").strip()
        if pri and pri not in _VALID_PRIORITY:
            raise HTTPException(400, f"유효하지 않은 우선순위: {pri}")
        data["promo_priority"] = pri or "일반"

    # 빈 문자열은 NULL로 정규화(빈 텍스트 = 값 없음)
    data = {k: (v if v != "" else None) for k, v in data.items()}

    with get_conn() as conn:
        if not conn.execute(
            "SELECT 1 FROM books WHERE isbn13 = ?", (isbn13,)
        ).fetchone():
            raise HTTPException(400, "존재하지 않는 ISBN입니다(books 테이블에 없음)")

        # upsert: updated_at은 datetime('now') SQL 리터럴로 서버가 기록(파라미터 아님)
        cols = list(data.keys())
        insert_cols = ["isbn13", *cols, "updated_at"]
        value_exprs = ["?"] * (1 + len(cols)) + ["datetime('now')"]
        set_pairs = [f"{c} = excluded.{c}" for c in cols] + ["updated_at = datetime('now')"]
        conn.execute(
            f"""
            INSERT INTO marketing_cards ({", ".join(insert_cols)})
            VALUES ({", ".join(value_exprs)})
            ON CONFLICT(isbn13) DO UPDATE SET {", ".join(set_pairs)}
            """,
            [isbn13, *data.values()],
        )
        conn.commit()

        row = conn.execute(
            "SELECT * FROM marketing_cards WHERE isbn13 = ?", (isbn13,)
        ).fetchone()

    card = dict(row)
    card["card_status"] = compute_status(card)
    return {"ok": True, "card": card}
