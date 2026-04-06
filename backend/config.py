import os
from dotenv import load_dotenv

# Backend package root (directory containing this file). Used so relative paths in .env
# do not depend on the shell's cwd when starting uvicorn (evidence: two quickhire.db
# files — only the one under backend/ was migrated; cwd=repo root used the other).
_BACKEND_ROOT = os.path.dirname(os.path.abspath(__file__))
load_dotenv()

# --- All config is read from environment / .env ---
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
REDIS_HOST = os.getenv("REDIS_HOST", "localhost")
REDIS_PORT = int(os.getenv("REDIS_PORT", 6379))
CHROMA_DB_PATH = os.getenv("CHROMA_DB_PATH", "./chroma_db")

_sqlite_raw = os.getenv("SQLITE_DB_PATH", "./quickhire.db")
if os.path.isabs(_sqlite_raw):
    SQLITE_DB_PATH = os.path.normpath(_sqlite_raw)
else:
    SQLITE_DB_PATH = os.path.normpath(os.path.join(_BACKEND_ROOT, _sqlite_raw))
