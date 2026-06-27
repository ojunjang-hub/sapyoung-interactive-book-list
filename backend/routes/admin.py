import json
import logging
import re
import sqlite3

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from aladin_scrape import download_cover, scrape_contents
from auth import verify_admin
from config import PROJECT_ROOT, settings
from database import get_conn
from publish import rebuild_public_json
from routes.search import load_index

router = APIRouter()


def _refresh_derived() -> None:
    """관리자 변경을 파생 산출물에 반영: AI 검색 인덱스 + 공개 정적 JSON.
    하나가 실패해도 다른 하나는 시도하며, 관리자 동작 자체는 막지 않는다."""
    try:
        load_index()
    except Exception:
        logging.exception("AI 검색 인덱스 재빌드 실패")
    try:
        rebuild_public_json()
    except Exception:
        logging.exception("공개 JSON 재생성 실패")

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


class BookUpdate(BaseModel):
    """도서 종합 편집. 보낸(set) 필드만 갱신한다(model_dump(exclude_unset=True))."""
    title: str | None = None
    author: str | None = None
    publisher: str | None = None
    pub_date: str | None = None
    series: str | None = None
    pages: int | None = None
    price_standard: int | None = None
    price_sales: int | None = None
    cover_url: str | None = None
    stock_status: str | None = None
    description: str | None = None
    full_description: str | None = None
    publisher_description: str | None = None
    author_intro: str | None = None
    endorsements: str | None = None
    quotable_phrases: str | None = None
    toc: str | None = None
    department: str | None = None  # → admin_overrides
    category: str | None = None    # → admin_overrides


# books 테이블에서 직접 편집 가능한 컬럼 (department/category는 overrides로 분리)
_EDITABLE_COLS = {
    "title", "author", "publisher", "pub_date", "series", "pages",
    "price_standard", "price_sales", "cover_url", "stock_status",
    "description", "full_description", "publisher_description",
    "author_intro", "endorsements", "quotable_phrases", "toc",
}


_VALID_STATUSES = {"재고있음", "품절", "절판", ""}


async def _fetch_aladin(isbn13: str) -> dict:
    if not settings.aladin_ttb_key:
        raise HTTPException(503, "ALADIN_TTB_KEY가 설정되지 않았습니다.")
    params = {
        "ttbkey": settings.aladin_ttb_key,
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


# 알라딘 표지 URL의 크기 세그먼트(coversum/cover500/…)를 cover200으로 정규화.
# API의 cover 필드는 coversum(89px) 저해상도를 주므로, 정본 데이터와 동일하게
# cover200으로 맞춰야 그리드는 200px, 상세는 book.js가 cover500으로 치환한다.
_COVER_SIZE_RE = re.compile(r"(/product/\d+/\d+/)[^/]+/")


def _cover200(url: str | None) -> str | None:
    if not url:
        return url
    return _COVER_SIZE_RE.sub(r"\1cover200/", url, count=1)


def _map_aladin_item(item: dict) -> dict:
    sub = item.get("subInfo") or {}
    series_info = item.get("seriesInfo") or {}
    store_links = {}
    link = item.get("link", "")
    if link:
        store_links["aladin"] = link

    # 알라딘 분류: categoryName(예: "국내도서>인문학>...") 경로를 파이프라인과 동일한
    # [{categoryId, categoryName}] 형태로 저장(프런트 상세의 '알라딘 분류'가 이 형태를 사용).
    cat_name = (item.get("categoryName") or "").strip()
    aladin_category = (
        [{"categoryId": item.get("categoryId"), "categoryName": cat_name}]
        if cat_name else []
    )
    # 분야 초기값: 부서는 '미분류'(관리자 보정 필요), 분야는 알라딘 최심 카테고리명.
    # department_src를 채워야 books_effective.department_effective가 NULL이 아니어서
    # 목록 필터·파인더에 노출된다.
    category_src = cat_name.split(">")[-1].strip() if cat_name else None

    return {
        "title": item.get("title"),
        "author": item.get("author"),
        "publisher": item.get("publisher"),
        "pub_date": item.get("pubDate"),
        "department_src": "미분류",
        "category_src": category_src,
        "price_standard": item.get("priceStandard"),
        "price_sales": item.get("priceSales"),
        "cover_url": _cover200(item.get("cover")),  # coversum → cover200 정규화
        "description": item.get("description"),
        "stock_status": item.get("stockStatus") or "재고있음",
        "series": series_info.get("seriesName"),
        # 목차·상세는 item 최상위/ subInfo에서(지시서 매핑 기준). API가 비워 주면 그대로 빈 값.
        "toc": sub.get("toc"),
        "full_description": item.get("fullDescription"),
        "publisher_description": item.get("fullDescription2"),
        "aladin_category": json.dumps(aladin_category, ensure_ascii=False),
        "store_links": json.dumps(store_links, ensure_ascii=False),
        "aladin_enriched": 1,
    }


@router.get("/verify")
async def verify_key(_: str = Depends(verify_admin)):
    return {"ok": True}


# 이미 있는 도서를 덮어쓸 때는 알라딘 서지 데이터만 갱신하고,
# 관리자 분류(부서/분야 출처)는 보존한다. admin_overrides는 애초에 건드리지 않는다.
_PRESERVE_ON_OVERWRITE = {"department_src", "category_src"}


def _overwrite_book(conn, isbn: str, fields: dict) -> None:
    upd = {k: v for k, v in fields.items() if k not in _PRESERVE_ON_OVERWRITE}
    assignments = ", ".join(f"{c} = ?" for c in upd) + ", updated_at = datetime('now')"
    conn.execute(
        f"UPDATE books SET {assignments} WHERE isbn13 = ?",
        [*upd.values(), isbn],
    )


@router.post("/books/add")
async def add_book_by_isbn(body: AddBookRequest, _: str = Depends(verify_admin)):
    isbn = body.isbn13.strip().replace("-", "")
    if not isbn.isdigit() or len(isbn) != 13:
        raise HTTPException(400, "ISBN13 형식이 올바르지 않습니다 (13자리 숫자)")

    item = await _fetch_aladin(isbn)
    fields = _map_aladin_item(item)

    # 목차·책소개·저자소개·출판사 서평은 API가 비워 주므로 상품 페이지 스크래핑으로 보충.
    # API가 채워 준 값이 있으면 그것을 우선하고, 빈 필드만 스크래핑 결과로 메운다.
    scraped = await scrape_contents(isbn, item.get("link"))
    for k, v in scraped.items():
        if v and not (fields.get(k) or "").strip():
            fields[k] = v

    # 표지를 서버에 직접 저장하고 cover_url을 로컬 경로로 교체(알라딘 CDN 의존 제거).
    # 원본 URL은 cover_remote_url에 보존. 실패하면 원격 URL을 그대로 둔다.
    local_cover = await download_cover(
        isbn, fields.get("cover_url"), PROJECT_ROOT / "public" / "covers"
    )
    if local_cover:
        fields["cover_remote_url"] = fields.get("cover_url")
        fields["cover_url"] = local_cover

    with get_conn() as conn:
        exists = conn.execute(
            "SELECT 1 FROM books WHERE isbn13 = ?", (isbn,)
        ).fetchone()

        if exists:
            # 이미 있는 도서 → 알라딘 최신 데이터로 덮어쓰기(분류는 보존)
            _overwrite_book(conn, isbn, fields)
            action = "updated"
        else:
            cols = ["isbn13"] + list(fields.keys())
            vals = [isbn] + list(fields.values())
            placeholders = ", ".join(["?"] * len(cols))
            col_sql = ", ".join(cols)
            try:
                conn.execute(
                    f"INSERT INTO books ({col_sql}) VALUES ({placeholders})",
                    vals,
                )
                action = "added"
            except sqlite3.IntegrityError:
                # 확인과 INSERT 사이의 경쟁 조건 → 덮어쓰기로 처리
                _overwrite_book(conn, isbn, fields)
                action = "updated"
        conn.commit()

    _refresh_derived()  # 추가/갱신을 AI 검색 인덱스 + 공개 JSON에 반영
    return {
        "ok": True,
        "action": action,
        "isbn13": isbn,
        "title": fields.get("title"),
        "cover_url": fields.get("cover_url"),
    }


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
    _refresh_derived()  # 분류 변경을 인덱스 + 공개 JSON에 반영
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
    _refresh_derived()  # 재고 상태(절판 등) 변경을 인덱스 + 공개 JSON에 반영
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
    _refresh_derived()  # 표지 URL은 공개 JSON에 포함 → 재발행
    return {"ok": True}


@router.patch("/books/{isbn13}")
async def update_book(
    isbn13: str,
    body: BookUpdate,
    _: str = Depends(verify_admin),
):
    """도서 종합 편집: books 테이블 컬럼 + 분류(overrides)를 한 번에 갱신."""
    data = body.model_dump(exclude_unset=True)
    data.pop("department", None)
    data.pop("category", None)
    # 분류는 값이 실제로 있을 때만 변경(빈값/미전송은 무시 — 초기화는 리셋 버튼)
    dept_val = (body.department or None) if body.department else None
    cat_val = (body.category or None) if body.category else None

    cols = {k: v for k, v in data.items() if k in _EDITABLE_COLS}
    if "stock_status" in cols and cols["stock_status"] not in _VALID_STATUSES:
        raise HTTPException(400, f"유효하지 않은 상태: {cols['stock_status']}")
    if "title" in cols and not (cols["title"] or "").strip():
        raise HTTPException(400, "제목은 비울 수 없습니다")

    with get_conn() as conn:
        if not conn.execute(
            "SELECT 1 FROM books WHERE isbn13 = ?", (isbn13,)
        ).fetchone():
            raise HTTPException(404, "도서를 찾을 수 없습니다")

        if cols:
            # 빈 문자열은 NULL로 정규화(빈 텍스트 = 값 없음)
            assignments = ", ".join(f"{c} = ?" for c in cols) + ", updated_at = datetime('now')"
            params = [(v if v != "" else None) for v in cols.values()]
            conn.execute(
                f"UPDATE books SET {assignments} WHERE isbn13 = ?",
                [*params, isbn13],
            )

        if dept_val is not None or cat_val is not None:
            conn.execute(
                """
                INSERT INTO admin_overrides (isbn13, department, category, modified_at)
                VALUES (?, ?, ?, datetime('now'))
                ON CONFLICT(isbn13) DO UPDATE SET
                  department  = COALESCE(excluded.department, admin_overrides.department),
                  category    = COALESCE(excluded.category,   admin_overrides.category),
                  modified_at = excluded.modified_at
                """,
                (isbn13, dept_val, cat_val),
            )
        conn.commit()

    _refresh_derived()  # 편집 내용을 AI 인덱스 + 공개 JSON에 반영
    return {"ok": True}


@router.delete("/overrides/{isbn13}")
async def delete_override(isbn13: str, _: str = Depends(verify_admin)):
    with get_conn() as conn:
        conn.execute("DELETE FROM admin_overrides WHERE isbn13 = ?", (isbn13,))
        conn.commit()
    _refresh_derived()  # 오버라이드 해제(분류 원복)를 인덱스 + 공개 JSON에 반영
    return {"ok": True}
