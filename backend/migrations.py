#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""정본 books.db에 대한 멱등(idempotent) 스키마 마이그레이션.

정본 데이터(books)는 건드리지 않고, 부가 테이블만 CREATE TABLE IF NOT EXISTS로
추가한다. build_db.py는 DB를 통째로 다시 만들므로(정본 재구축 금지) 이 모듈은
그와 분리된 안전한 증분 마이그레이션 경로다.

- 서버 기동 시 main.py의 lifespan에서 run_migrations()가 자동 실행된다.
- 수동 실행: `python migrations.py` (backend 디렉토리 기준, 어느 경로에서든 동작).
  여러 번 실행해도 오류 없이 동일 결과를 보장한다.
"""
import sqlite3
import sys
from pathlib import Path

# 단독 실행(python migrations.py) 시에도 flat import(config)가 동작하도록 보장
sys.path.insert(0, str(Path(__file__).resolve().parent))

from config import settings  # noqa: E402

# 마케팅 카드: 편집부가 관리자 화면에서 수기 입력하는 홍보용 콘텐츠.
# 정본 서지 데이터(books)와 섞지 않도록 isbn13 조인 키로 분리한다(오버라이드 원칙).
# card_status(thin/partial/thick)는 컬럼으로 저장하지 않고 조회 시 계산한다.
_MARKETING_CARDS_SQL = """
CREATE TABLE IF NOT EXISTS marketing_cards (
  isbn13            TEXT PRIMARY KEY REFERENCES books(isbn13) ON DELETE CASCADE,
  obi_copy          TEXT,   -- 띠지 문구
  back_cover_copy   TEXT,   -- 뒷표지 문구(추천사 포함)
  promo_copy        TEXT,   -- 카드뉴스 문구
  editor_comment    TEXT,   -- 편집자 코멘트
  promo_points      TEXT,   -- 홍보 참고 포인트
  key_quotes        TEXT,   -- 본문 핵심 인용문
  target_reader     TEXT,   -- 타깃 독자 한 줄
  topical_keywords  TEXT,   -- 시사/시즌 연결 키워드
  promo_priority    TEXT DEFAULT '일반',  -- 신간/스테디/일반
  source_note       TEXT,   -- 문구 출처 메모
  updated_by        TEXT,   -- 마지막 수정자
  updated_at        TEXT    -- 마지막 수정 시각(ISO 8601)
);
"""


def _ensure_column(conn: sqlite3.Connection, table: str, column: str, decl: str) -> None:
    """table에 column이 없으면 ALTER TABLE ADD COLUMN으로 추가한다(멱등).

    ALTER TABLE ADD COLUMN은 기존 데이터/컬럼을 건드리지 않으므로 정본 보존에 안전하다.
    """
    cols = {r[1] for r in conn.execute(f"PRAGMA table_info({table})")}
    if column not in cols:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {decl}")


def run_migrations(conn: sqlite3.Connection) -> None:
    """열린 커넥션에 대해 마이그레이션을 적용한다(멱등)."""
    conn.executescript(_MARKETING_CARDS_SQL)
    # 부제(subtitle): '제목 - 부제'로 합쳐져 있던 부제를 분리 저장하기 위한 컬럼
    _ensure_column(conn, "books", "subtitle", "TEXT")
    conn.commit()


def main() -> None:
    db_path = settings.db_path_abs
    print(f"마이그레이션 대상 DB: {db_path}")
    conn = sqlite3.connect(str(db_path))
    try:
        run_migrations(conn)
    finally:
        conn.close()
    print("마이그레이션 완료: marketing_cards, books.subtitle")


if __name__ == "__main__":
    main()
