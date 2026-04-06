"""
QuickHire Backend — FastAPI entry point.

Run with:
    uvicorn main:app --reload
"""
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from database import init_db
from routers import router as api_router
from ws_handler import router as ws_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Run once per process (including uvicorn --reload workers). Applies schema + migrations.
    init_db()
    yield


app = FastAPI(title="QuickHire Backend", version="1.0.0", lifespan=lifespan)

# CORS — wide-open for local dev
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router)
app.include_router(ws_router)


@app.get("/")
def root():
    return {"message": "QuickHire API is running 🚀"}
