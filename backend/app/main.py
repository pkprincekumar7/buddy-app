from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api_routes import router as api_router
from app.database import Base, engine
from app.routers.llm import router as llm_router
from app.settings import settings


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    yield


app = FastAPI(title="Buddy360 API", lifespan=lifespan)


@app.get("/health")
def health_check():
    return {"status": "ok"}


_origins = [o.strip() for o in settings.cors_origins.split(",") if o.strip()]
_allow_origins = _origins if _origins else ["http://localhost:5173", "http://127.0.0.1:5173"]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_allow_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router, prefix="/api/v1")
app.include_router(llm_router, prefix="/api/v1")
