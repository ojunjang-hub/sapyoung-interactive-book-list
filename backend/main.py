from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from config import PROJECT_ROOT, settings


class HTMLNoCacheStatics(StaticFiles):
    """HTML 응답은 항상 재검증하도록 no-cache를 붙인다.

    index.html이 브라우저 캐시에 박혀 있으면 CSS/JS의 ?v= 버전 갱신이
    반영되지 않는다(낡은 style.css를 계속 로드). HTML만 no-cache로 두고
    버전 문자열이 붙은 정적 자산은 그대로 캐시되게 한다.
    """

    async def get_response(self, path, scope):
        response = await super().get_response(path, scope)
        ctype = response.headers.get("content-type", "")
        if ctype.startswith("text/html"):
            response.headers["Cache-Control"] = "no-cache, must-revalidate"
        return response
from routes import admin, books, files, search
from routes.search import load_index


@asynccontextmanager
async def lifespan(app: FastAPI):
    load_index()
    yield


app = FastAPI(title="사회평론 도서목록 API", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(books.router, prefix="/api")
app.include_router(admin.router, prefix="/api/admin")
app.include_router(files.router, prefix="/api")
app.include_router(search.router, prefix="/api/search")


@app.get("/api/health")
async def health():
    return {"status": "ok"}


PUBLIC_DIR = PROJECT_ROOT / "public"
if PUBLIC_DIR.is_dir():
    app.mount("/", HTMLNoCacheStatics(directory=PUBLIC_DIR, html=True), name="static")

