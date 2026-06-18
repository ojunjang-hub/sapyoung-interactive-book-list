from pathlib import Path

from fastapi import APIRouter, Depends, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse

from auth import verify_admin
from config import settings
from database import get_conn

router = APIRouter()


@router.post("/books/{isbn13}/attachments")
async def upload_attachment(
    isbn13: str,
    file: UploadFile,
    file_type: str = Form(...),
    description: str = Form(""),
    version: str = Form(""),
    _: str = Depends(verify_admin),
):
    with get_conn() as conn:
        if not conn.execute(
            "SELECT 1 FROM books WHERE isbn13 = ?", (isbn13,)
        ).fetchone():
            raise HTTPException(404, "도서를 찾을 수 없습니다")

    dest_dir: Path = settings.file_storage_path_abs / isbn13
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / (file.filename or "unnamed")
    dest.write_bytes(await file.read())

    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO attachments
              (isbn13, file_type, filename, description, version, file_path)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (isbn13, file_type, file.filename, description, version, str(dest)),
        )
        attachment_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
        conn.commit()

    return {"ok": True, "id": attachment_id, "filename": file.filename}


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
