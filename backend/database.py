import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager

from config import settings


@contextmanager
def get_conn() -> Iterator[sqlite3.Connection]:
    conn = sqlite3.connect(settings.db_path_abs)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
    finally:
        conn.close()
