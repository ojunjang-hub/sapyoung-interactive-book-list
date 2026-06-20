from pathlib import Path

from fastapi import APIRouter, Depends, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse

from auth import verify_admin
from config import settings
from database import get_conn

router = APIRouter()

_CHUNK = 1024 * 1024  # 1MB


def _validate_isbn(isbn13: str) -> str:
    isbn = isbn13.strip()
    if not isbn.isdigit() or len(isbn) != 13:
        raise HTTPException(400, "ISBN13 형식이 올바르지 않습니다")
    return isbn


@router.post("/books/{isbn13}/attachments")
async def upload_attachment(
    isbn13: str,
    file: UploadFile,
    file_type: str = Form(...),
    description: str = Form(""),
    version: str = Form(""),
    _: str = Depends(verify_admin),
):
    isbn13 = _validate_isbn(isbn13)
    with get_conn() as conn:
        if not conn.execute(
            "SELECT 1 FROM books WHERE isbn13 = ?", (isbn13,)
        ).fetchone():
            raise HTTPException(404, "도서를 찾을 수 없습니다")

    # 파일명에서 경로 성분 제거(경로 탈출 방지)
    safe_name = Path(file.filename or "unnamed").name or "unnamed"
    dest_dir: Path = settings.file_storage_path_abs / isbn13
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / safe_name

    # 크기 제한을 강제하며 청크 단위로 기록(전체를 메모리에 적재하지 않음)
    written = 0
    try:
        with dest.open("wb") as out:
            while chunk := await file.read(_CHUNK):
                written += len(chunk)
                if written > settings.max_upload_bytes:
                    out.close()
                    dest.unlink(missing_ok=True)
                    raise HTTPException(
                        413,
                        f"파일이 너무 큽니다(최대 {settings.max_upload_bytes // (1024*1024)}MB)",
                    )
                out.write(chunk)
    finally:
        await file.close()

    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO attachments
              (isbn13, file_type, filename, description, version, file_path)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (isbn13, file_type, safe_name, description, version, str(dest)),
        )
        attachment_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
        conn.commit()

    return {"ok": True, "id": attachment_id, "filename": safe_name}


@router.get("/books/{isbn13}/attachments/{attachment_id}")
async def download_attachment(isbn13: str, attachment_id: int):
    with get_conn() as conn:
        row = conn.execute(
            "SELECT filename, file_path FROM attachments WHERE id = ? AND isbn13 = ?",
            (attachment_id, isbn13),
        ).fetchone()

    if not row:
        raise HTTPException(404, "첨부파일을 찾을 수 없습니다")

    path = Path(row["file_path"])
    if not path.exists():
        raise HTTPException(404, "파일이 존재하지 않습니다")

    return FileResponse(path, filename=row["filename"])


@router.delete("/books/{isbn13}/attachments/{attachment_id}")
async def delete_attachment(
    isbn13: str,
    attachment_id: int,
    _: str = Depends(verify_admin),
):
    with get_conn() as conn:
        row = conn.execute(
            "SELECT file_path FROM attachments WHERE id = ? AND isbn13 = ?",
            (attachment_id, isbn13),
        ).fetchone()

        if not row:
            raise HTTPException(404, "첨부파일을 찾을 수 없습니다")

        path = Path(row["file_path"])
        if path.exists():
            path.unlink()

        conn.execute("DELETE FROM attachments WHERE id = ?", (attachment_id,))
        conn.commit()

    return {"ok": True}
