from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.database import init_db
from app.routers import analysis, export_import, model_configs, plans, run_batches, sessions, tools

load_dotenv()


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(title="Llaboratory", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(tools.router, prefix="/api")
app.include_router(model_configs.router, prefix="/api")
app.include_router(plans.router, prefix="/api")
app.include_router(sessions.router, prefix="/api")
app.include_router(run_batches.router, prefix="/api")
app.include_router(analysis.router, prefix="/api")
app.include_router(export_import.router, prefix="/api")


@app.get("/api/health")
def health():
    return {"status": "ok"}
