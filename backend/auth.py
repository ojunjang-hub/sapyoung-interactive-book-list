import secrets

from fastapi import Security, HTTPException, status
from fastapi.security import APIKeyHeader

from config import settings

_api_key_header = APIKeyHeader(name="X-Admin-Key", auto_error=False)

# 기본값/빈 값으로는 관리자 기능을 절대 열지 않는다(fail-closed).
_INSECURE_KEYS = {"", "changeme"}


async def verify_admin(api_key: str = Security(_api_key_header)) -> str:
    configured = settings.admin_api_key
    if configured in _INSECURE_KEYS:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="관리자 키가 설정되지 않았습니다(ADMIN_API_KEY).",
        )
    if not api_key or not secrets.compare_digest(api_key, configured):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="관리자 인증 실패",
        )
    return api_key
