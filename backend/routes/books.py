import json

from fastapi import APIRouter, HTTPException, Query

from database import get_conn

router = APIRouter()

LIST_COLUMNS = (
    "isbn13, title, author, pub_date, "
    "department_effective AS department, "
    "category_effective AS category, "
    "series, price_sales, cover_url, stock_status"
)

SORT_MAP = {
    "pub_date_desc": "pub_date DESC",
    "pub_date_asc": "pub_date ASC",
    "title_asc": "title ASC",
    "title_desc": "title DESC",
    "price_asc": "price_sales ASC",
    "price_desc": "price_sales DESC",
}

JSON_FIELDS = (
    "aladin_category",
    "store_links",
    "quotable_phrases",
)

# 상세 페이지에 노출할 공개 컬럼만 선별 (내부 컬럼·미사용 AI 필드 제외)
DETAIL_COLUMNS = (
    "isbn13, title, author, publisher, pub_date, "
    "department_effective AS department, "
    "category_effective   AS category, "
    "series, pages, price_standard, price_sales, cover_url, "
    "description, full_description, publisher_description, author_intro, "
    "endorsements, toc, quotable_phrases, aladin_category, "
    "sales_point, stock_status, store_links"
)


def _build_filters(
    q, department, category, series, year, price_min, price_max
) -> tuple[list[str], list]:
    where, params = ["1=1"], []
    if q:
        where.append("(title LIKE ? OR author LIKE ?)")
        params += [f"%{q}%", f"%{q}%"]
    if department:
        where.append("department_effective = ?")
        params.append(department)
    if category:
        where.append("category_effective = ?")
        params.append(category)
    if series:
        where.append("series = ?")
        params.append(series)
    if year:
        where.append("substr(pub_date, 1, 4) = ?")
        params.append(str(year))
    if price_min is not None:
        where.append("price_sales >= ?")
        params.append(price_min)
    if price_max is not None:
        where.append("price_sales <= ?")
        params.append(price_max)
    return where, params


@router.get("/books")
async def list_books(
    q: str | None = Query(None),
    department: str | None = Query(None),
    category: str | None = Query(None),
    series: str | None = Query(None),
    year: int | None = Query(None),
    price_min: int | None = Query(None),
    price_max: int | None = Query(None),
    sort: str = Query("pub_date_desc"),
    page: int = Query(1, ge=1),
    size: int = Query(50, ge=1, le=2000),
):
    where, params = _build_filters(
        q, department, category, series, year, price_min, price_max
    )
    where_sql = " AND ".join(where)
    order = SORT_MAP.get(sort, "pub_date DESC")

    with get_conn() as conn:
        total = conn.execute(
            f"SELECT COUNT(*) FROM books_effective WHERE {where_sql}", params
        ).fetchone()[0]

        rows = conn.execute(
            f"""
            SELECT {LIST_COLUMNS}
            FROM books_effective
            WHERE {where_sql}
            ORDER BY {order}
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


@router.get("/filters")
async def get_filters():
    with get_conn() as conn:

        def distinct(col: str) -> list[str]:
            return [
                r[0]
                for r in conn.execute(
                    f"""
                    SELECT DISTINCT {col} AS v
                    FROM books_effective
                    WHERE {col} IS NOT NULL AND {col} != ''
                    ORDER BY v
                    """
                ).fetchall()
            ]

        departments = distinct("department_effective")
        categories = distinct("category_effective")
        series = distinct("series")
        years = [
            r[0]
            for r in conn.execute(
                """
                SELECT DISTINCT substr(pub_date, 1, 4) AS y
                FROM books_effective
                WHERE pub_date IS NOT NULL AND pub_date != ''
                ORDER BY y DESC
                """
            ).fetchall()
        ]

    return {
        "departments": departments,
        "categories": categories,
        "series": series,
        "years": years,
    }


@router.get("/books/{isbn13}")
async def get_book(isbn13: str):
    with get_conn() as conn:
        row = conn.execute(
            f"SELECT {DETAIL_COLUMNS} FROM books_effective WHERE isbn13 = ?",
            (isbn13,),
        ).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="도서를 찾을 수 없습니다")

        book = dict(row)

        for field in JSON_FIELDS:
            raw = book.get(field)
            if isinstance(raw, str) and raw:
                try:
                    book[field] = json.loads(raw)
                except json.JSONDecodeError:
                    pass

        book["attachments"] = [
            dict(r)
            for r in conn.execute(
                """
                SELECT id, file_type, filename, description, version, uploaded_at
                FROM attachments
                WHERE isbn13 = ?
                ORDER BY uploaded_at DESC
                """,
                (isbn13,),
            ).fetchall()
        ]

    return book
