from fastapi import Depends, HTTPException, Security, status
from fastapi.security import APIKeyHeader

from config import settings

_api_key_header = APIKeyHeader(name="X-Admin-Key", auto_error=False)


async def verify_admin(api_key: str = Security(_api_key_header)) -> str:
    if not api_key or api_key != settings.admin_api_key:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="관리자 인증 실패",
        )
    return api_key
