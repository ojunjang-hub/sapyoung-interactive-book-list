from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from config import PROJECT_ROOT, settings
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
    app.mount("/", StaticFiles(directory=PUBLIC_DIR, html=True), name="static")

