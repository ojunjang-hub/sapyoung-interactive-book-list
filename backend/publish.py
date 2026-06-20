"""공개용 정적 JSON(public/data/books.json) 재생성.

관리자 변경(분류/재고/표지/신간) 후 정본 books.db에서 다시 뽑아
정적 폴백 데이터가 백엔드와 어긋나지 않게 한다. books.db는 읽기만 한다.
"""
import json
import sqlite3

from config import PROJECT_ROOT, settings

PUBLIC_JSON_PATH = PROJECT_ROOT / "public" / "data" / "books.json"

# 목록/폴백에 필요한 경량 필드만 (상세 신규 필드는 API에서 제공)
_PUBLIC_COLUMNS = (
    "isbn13, title, author, publisher, pub_date, "
    "department_effective AS department, "
    "category_effective   AS category, "
    "series, price_standard, price_sales, "
    "cover_url, description, stock_status, store_links"
)


def rebuild_public_json() -> int:
    PUBLIC_JSON_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(settings.db_path_abs))
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute(
            f"SELECT {_PUBLIC_COLUMNS} FROM books_effective ORDER BY pub_date DESC"
        ).fetchall()
    finally:
        conn.close()

    data = []
    for r in rows:
        d = dict(r)
        if d.get("store_links"):
            try:
                d["store_links"] = json.loads(d["store_links"])
            except Exception:
                pass
        data.append(d)

    PUBLIC_JSON_PATH.write_text(
        json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return len(data)
