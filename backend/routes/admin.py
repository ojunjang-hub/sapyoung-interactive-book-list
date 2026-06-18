import json

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from auth import verify_admin
from database import get_conn

router = APIRouter()

_ALADIN_KEY = "ttbojunjang2101001"
_ALADIN_URL = "http://www.aladin.co.kr/ttb/api/ItemLookUp.aspx"
_ALADIN_OPT = "Toc,Story,fulldescription,fulldescription2,phraseList,authors,ratingInfo,bestSellerRank"


class ClassificationUpdate(BaseModel):
    department: str | None = None
    category: str | None = None


class StatusUpdate(BaseModel):
    stock_status: str


class CoverUpdate(BaseModel):
    cover_url: str


class AddBookRequest(BaseModel):
    isbn13: str


_VALID_STATUSES = {"재고있음", "품절", "절판", ""}


async def _fetch_aladin(isbn13: str) -> dict:
    params = {
        "ttbkey": _ALADIN_KEY,
        "itemIdType": "ISBN13",
        "ItemId": isbn13,
        "output": "js",
        "Version": "20131101",
        "OptResult": _ALADIN_OPT,
    }
    async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
        resp = await client.get(_ALADIN_URL, params=params)
    resp.raise_for_status()
    data = json.loads(resp.content.decode("utf-8", errors="replace"))
    if isinstance(data, dict) and data.get("errorCode") is not None:
        code = data.get("errorCode")
        if code == 8:
            raise HTTPException(404, "알라딘에 등록되지 않은 ISBN입니다")
        raise HTTPException(502, f"알라딘 API 오류: errorCode={code}")
    items = data.get("item") if isinstance(data, dict) else None
    if not items:
        raise HTTPException(404, "알라딘에서 도서 정보를 찾을 수 없습니다")
    return items[0]


def _map_aladin_item(item: dict) -> dict:
    sub = item.get("subInfo") or {}
    series_info = item.get("seriesInfo") or {}
    store_links = {}
    link = item.get("link", "")
    if link:
        store_links["aladin"] = link
    return {
        "title": item.get("title"),
        "author": item.get("author"),
        "publisher": item.get("publisher"),
        "pub_date": item.get("pubDate"),
        "price_standard": item.get("priceStandard"),
        "price_sales": item.get("priceSales"),
        "cover_url": item.get("cover"),
        "description": item.get("description"),
        "stock_status": item.get("stockStatus") or "재고있음",
        "series": series_info.get("seriesName"),
        "toc": sub.get("toc"),
        "full_description": sub.get("fulldescription"),
        "publisher_description": sub.get("fulldescription2"),
        "aladin_category": json.dumps(item.get("categoryIdList", []), ensure_ascii=False),
        "store_links": json.dumps(store_links, ensure_ascii=False),
        "aladin_enriched": 1,
    }


@router.get("/verify")
async def verify_key(_: str = Depends(verify_admin)):
    return {"ok": True}


@router.post("/books/add")
async def add_book_by_isbn(body: AddBookRequest, _: str = Depends(verify_admin)):
    isbn = body.isbn13.strip().replace("-", "")
    if not isbn.isdigit() or len(isbn) != 13:
        raise HTTPException(400, "ISBN13 형식이 올바르지 않습니다 (13자리 숫자)")

    with get_conn() as conn:
        if conn.execute("SELECT 1 FROM books WHERE isbn13 = ?", (isbn,)).fetchone():
            raise HTTPException(409, "이미 목록에 있는 도서입니다")

    item = await _fetch_aladin(isbn)
    fields = _map_aladin_item(item)

    cols = ["isbn13"] + list(fields.keys())
    vals = [isbn] + list(fields.values())
    placeholders = ", ".join(["?"] * len(cols))
    col_sql = ", ".join(cols)

    with get_conn() as conn:
        conn.execute(
            f"INSERT INTO books ({col_sql}) VALUES ({placeholders})",
            vals,
        )
        conn.commit()

    return {"ok": True, "isbn13": isbn, "title": fields.get("title"), "cover_url": fields.get("cover_url")}


@router.get("/books")
async def list_books_admin(
    q: str | None = Query(None),
    department: str | None = Query(None),
    status_filter: str | None = Query(None),
    page: int = Query(1, ge=1),
    size: int = Query(50, ge=1, le=200),
    _: str = Depends(verify_admin),
):
    where, params = ["1=1"], []
    if q:
        where.append("(b.title LIKE ? OR b.author LIKE ? OR b.isbn13 = ?)")
        params += [f"%{q}%", f"%{q}%", q]
    if department:
        where.append("COALESCE(o.department, b.department_src) = ?")
        params.append(department)
    if status_filter:
        where.append("b.stock_status = ?")
        params.append(status_filter)

    where_sql = " AND ".join(where)

    with get_conn() as conn:
        total = conn.execute(
            f"""
            SELECT COUNT(*) FROM books b
            LEFT JOIN admin_overrides o ON b.isbn13 = o.isbn13
            WHERE {where_sql}
            """,
            params,
        ).fetchone()[0]

        rows = conn.execute(
            f"""
            SELECT
                b.isbn13, b.title, b.author, b.pub_date,
                b.department_src, b.category_src,
                b.stock_status, b.cover_url, b.price_sales,
                COALESCE(o.department, b.department_src) AS department,
                COALESCE(o.category,   b.category_src)   AS category,
                (o.isbn13 IS NOT NULL)                   AS has_override,
                o.modified_at                            AS override_modified_at
            FROM books b
            LEFT JOIN admin_overrides o ON b.isbn13 = o.isbn13
            WHERE {where_sql}
            ORDER BY b.pub_date DESC
            LIMIT ? OFFSET ?
            """,
            [*params, size, (page - 1) * size],
        ).fetchall()

    return {
        "total": total,
        "page": page,
        "size": size,
        "items": [dict(r) for r in rows],
    }


@router.patch("/books/{isbn13}/classification")
async def update_classification(
    isbn13: str,
    body: ClassificationUpdate,
    _: str = Depends(verify_admin),
):
    with get_conn() as conn:
        if not conn.execute(
            "SELECT 1 FROM books WHERE isbn13 = ?", (isbn13,)
        ).fetchone():
            raise HTTPException(404, "도서를 찾을 수 없습니다")
        conn.execute(
            """
            INSERT INTO admin_overrides (isbn13, department, category, modified_at)
            VALUES (?, ?, ?, datetime('now'))
            ON CONFLICT(isbn13) DO UPDATE SET
              department  = COALESCE(excluded.department, admin_overrides.department),
              category    = COALESCE(excluded.category,   admin_overrides.category),
              modified_at = excluded.modified_at
            """,
            (isbn13, body.department, body.category),
        )
        conn.commit()
    return {"ok": True}


@router.patch("/books/{isbn13}/status")
async def update_status(
    isbn13: str,
    body: StatusUpdate,
    _: str = Depends(verify_admin),
):
    if body.stock_status not in _VALID_STATUSES:
        raise HTTPException(400, f"유효하지 않은 상태: {body.stock_status}")
    with get_conn() as conn:
        result = conn.execute(
            "UPDATE books SET stock_status = ?, updated_at = datetime('now') WHERE isbn13 = ?",
            (body.stock_status or None, isbn13),
        )
        if result.rowcount == 0:
            raise HTTPException(404, "도서를 찾을 수 없습니다")
        conn.commit()
    return {"ok": True}


@router.patch("/books/{isbn13}/cover")
async def update_cover(
    isbn13: str,
    body: CoverUpdate,
    _: str = Depends(verify_admin),
):
    with get_conn() as conn:
        result = conn.execute(
            "UPDATE books SET cover_url = ?, updated_at = datetime('now') WHERE isbn13 = ?",
            (body.cover_url, isbn13),
        )
        if result.rowcount == 0:
            raise HTTPException(404, "도서를 찾을 수 없습니다")
        conn.commit()
    return {"ok": True}


@router.delete("/overrides/{isbn13}")
async def delete_override(isbn13: str, _: str = Depends(verify_admin)):
    with get_conn() as conn:
        conn.execute("DELETE FROM admin_overrides WHERE isbn13 = ?", (isbn13,))
        conn.commit()
    return {"ok": True}
