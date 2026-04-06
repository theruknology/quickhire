"""
Lightweight SQLite helpers.
"""
import json
import os
import sqlite3
import sys
import tempfile
import threading
import time
from config import SQLITE_DB_PATH

DB_FILE = SQLITE_DB_PATH

_migrate_lock = threading.Lock()


# #region agent log
_AGENT_LOG_PATHS = (
    "/home/theruknology/Desktop/llm/quickhire/.cursor/debug-d7f86e.log",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "debug-d7f86e.log"),
    os.path.join(tempfile.gettempdir(), "quickhire-debug-d7f86e.log"),
)


def _agent_dbg(hypothesis_id: str, location: str, message: str, data: dict | None = None):
    pl = {
        "sessionId": "d7f86e",
        "hypothesisId": hypothesis_id,
        "location": location,
        "message": message,
        "data": data or {},
        "timestamp": int(time.time() * 1000),
    }
    line = json.dumps(pl) + "\n"
    for path in _AGENT_LOG_PATHS:
        try:
            parent = os.path.dirname(path)
            if parent:
                os.makedirs(parent, exist_ok=True)
            with open(path, "a", encoding="utf-8") as _lf:
                _lf.write(line)
            break
        except OSError:
            continue
    try:
        print(f"[agent-debug] {line.rstrip()}", file=sys.stderr, flush=True)
    except OSError:
        pass


# #endregion


def _ensure_legacy_interview_session_columns(conn: sqlite3.Connection) -> None:
    """
    Old DB files lack columns the app now requires. Always re-check via PRAGMA on each
    connection (cheap). A process-global fast-path was able to skip verification and led
    to OperationalError: no such column telemetry_data on legacy files.
    """
    try:
        db_abs = os.path.abspath(DB_FILE)
        row = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='interview_sessions'"
        ).fetchone()
        if not row:
            # #region agent log
            _agent_dbg("H3", "database.py:_ensure", "no interview_sessions table yet", {"db": db_abs})
            # #endregion
            return
        cols = _existing_columns(conn, "interview_sessions")
        has_t = "telemetry_data" in cols
        has_cv = "cv_path" in cols
        # #region agent log
        _agent_dbg(
            "H1",
            "database.py:_ensure",
            "session columns snapshot",
            {"db": db_abs, "has_telemetry_data": has_t, "has_cv_path": has_cv},
        )
        # #endregion
        if has_t and has_cv:
            return
        # #region agent log
        _agent_dbg("H2", "database.py:_ensure", "running migrate_schema for legacy interview_sessions", {"db": db_abs})
        # #endregion
        migrate_schema(conn)
        conn.commit()
        cols2 = _existing_columns(conn, "interview_sessions")
        # #region agent log
        _agent_dbg(
            "H2",
            "database.py:_ensure",
            "post-migrate columns",
            {
                "db": db_abs,
                "has_telemetry_data": "telemetry_data" in cols2,
                "has_cv_path": "cv_path" in cols2,
            },
        )
        # #endregion
        if "telemetry_data" not in cols2 or "cv_path" not in cols2:
            raise sqlite3.OperationalError(
                "migrate_schema failed to add telemetry_data/cv_path to interview_sessions"
            )
    except sqlite3.Error as exc:
        try:
            conn.rollback()
        except sqlite3.Error:
            pass
        # #region agent log
        _agent_dbg(
            "H-ERR",
            "database.py:_ensure",
            "ensure_legacy_columns failed",
            {"db": os.path.abspath(DB_FILE), "error": str(exc)[:400]},
        )
        # #endregion
        raise


def get_connection():
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    with _migrate_lock:
        _ensure_legacy_interview_session_columns(conn)
    return conn

def _existing_columns(conn, table: str) -> set:
    return {row[1] for row in conn.execute(f"PRAGMA table_info({table})").fetchall()}


def _add_column_if_missing(conn, table: str, col: str, col_def: str):
    try:
        if col not in _existing_columns(conn, table):
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {col} {col_def}")
    except sqlite3.Error:
        pass


def migrate_schema(conn):
    """
    SQLite CREATE TABLE IF NOT EXISTS does not add new columns to old DB files.
    Runtime evidence: OperationalError no such column: cv_path, telemetry_data.
    """
    for col, definition in [
        ("candidate_name", "TEXT DEFAULT ''"),
        ("cv_path", "TEXT DEFAULT ''"),
        ("current_round", "INTEGER DEFAULT 1"),
        ("total_rounds", "INTEGER DEFAULT 4"),
        ("status", "TEXT DEFAULT 'in_progress'"),
        ("mcq_scores", "TEXT DEFAULT '{}'"),
        ("code_submission", "TEXT DEFAULT ''"),
        ("code_feedback", "TEXT DEFAULT ''"),
        ("telemetry_data", "TEXT DEFAULT '{}'"),
        ("hints_used", "INTEGER DEFAULT 0"),
        ("started_at", "TEXT DEFAULT (datetime('now'))"),
        ("completed_at", "TEXT"),
    ]:
        _add_column_if_missing(conn, "interview_sessions", col, definition)

    _add_column_if_missing(conn, "interview_questions", "extra_json", "TEXT DEFAULT '{}'")


def init_db():
    """Create tables if they don't exist."""
    conn = get_connection()
    cur = conn.cursor()

    cur.execute("""
        CREATE TABLE IF NOT EXISTS companies (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            job_title TEXT NOT NULL,
            job_description TEXT NOT NULL,
            requirements TEXT DEFAULT '[]',
            created_at TEXT DEFAULT (datetime('now'))
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS candidates (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            email TEXT DEFAULT '',
            company_id TEXT DEFAULT '',
            cv_chunks INTEGER DEFAULT 0,
            screening_score REAL DEFAULT 0,
            screening_result TEXT DEFAULT '{}',
            status TEXT DEFAULT 'pending',
            created_at TEXT DEFAULT (datetime('now'))
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS telemetry_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT,
            payload TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS interview_questions (
            id TEXT PRIMARY KEY,
            company_id TEXT NOT NULL,
            question_type TEXT NOT NULL,
            question_text TEXT NOT NULL,
            correct_answer TEXT DEFAULT '',
            options TEXT DEFAULT '[]',
            difficulty TEXT DEFAULT 'medium',
            order_index INTEGER DEFAULT 0,
            extra_json TEXT DEFAULT '{}',
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY(company_id) REFERENCES companies(id)
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS interview_sessions (
            id TEXT PRIMARY KEY,
            candidate_id TEXT NOT NULL,
            company_id TEXT NOT NULL,
            candidate_name TEXT DEFAULT '',
            cv_path TEXT DEFAULT '',
            current_round INTEGER DEFAULT 1,
            total_rounds INTEGER DEFAULT 4,
            status TEXT DEFAULT 'in_progress',
            mcq_scores TEXT DEFAULT '{}',
            code_submission TEXT DEFAULT '',
            code_feedback TEXT DEFAULT '',
            telemetry_data TEXT DEFAULT '{}',
            hints_used INTEGER DEFAULT 0,
            started_at TEXT DEFAULT (datetime('now')),
            completed_at TEXT DEFAULT NULL,
            FOREIGN KEY(candidate_id) REFERENCES candidates(id),
            FOREIGN KEY(company_id) REFERENCES companies(id)
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS interview_reports (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            candidate_id TEXT NOT NULL,
            company_id TEXT NOT NULL,
            mcq_performance TEXT DEFAULT '{}',
            code_performance TEXT DEFAULT '{}',
            overall_score REAL DEFAULT 0,
            feedback TEXT DEFAULT '',
            recommendations TEXT DEFAULT '',
            generated_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY(session_id) REFERENCES interview_sessions(id),
            FOREIGN KEY(candidate_id) REFERENCES candidates(id),
            FOREIGN KEY(company_id) REFERENCES companies(id)
        )
    """)

    migrate_schema(conn)
    conn.commit()
    # #region agent log
    _agent_dbg(
        "H0",
        "database.py:init_db",
        "init_db finished",
        {"db": os.path.abspath(DB_FILE)},
    )
    # #endregion
    conn.close()


# ─── Helpers ──────────────────────────────────────────────────────────

def save_company(company_id, name, job_title, job_description, requirements):
    conn = get_connection()
    conn.execute(
        "INSERT OR REPLACE INTO companies (id, name, job_title, job_description, requirements) VALUES (?,?,?,?,?)",
        (company_id, name, job_title, job_description, json.dumps(requirements))
    )
    conn.commit()
    conn.close()

def get_company(company_id):
    conn = get_connection()
    row = conn.execute("SELECT * FROM companies WHERE id = ?", (company_id,)).fetchone()
    conn.close()
    if row:
        return dict(row)
    return None

def get_all_companies():
    conn = get_connection()
    rows = conn.execute("SELECT * FROM companies ORDER BY created_at DESC").fetchall()
    conn.close()
    return [dict(r) for r in rows]

def save_candidate(cid, name, email, company_id, cv_chunks, status="pending"):
    conn = get_connection()
    conn.execute(
        "INSERT OR REPLACE INTO candidates (id, name, email, company_id, cv_chunks, status) VALUES (?,?,?,?,?,?)",
        (cid, name, email, company_id, cv_chunks, status)
    )
    conn.commit()
    conn.close()

def update_candidate_screening(cid, score, result_json, status):
    conn = get_connection()
    conn.execute(
        "UPDATE candidates SET screening_score=?, screening_result=?, status=? WHERE id=?",
        (score, json.dumps(result_json), status, cid)
    )
    conn.commit()
    conn.close()

def get_candidate(cid):
    conn = get_connection()
    row = conn.execute("SELECT * FROM candidates WHERE id = ?", (cid,)).fetchone()
    conn.close()
    if row:
        d = dict(row)
        d["screening_result"] = json.loads(d.get("screening_result", "{}"))
        d["requirements"] = []
        return d
    return None

def get_candidates_for_company(company_id):
    conn = get_connection()
    rows = conn.execute("SELECT * FROM candidates WHERE company_id = ? ORDER BY screening_score DESC", (company_id,)).fetchall()
    conn.close()
    results = []
    for r in rows:
        d = dict(r)
        d["screening_result"] = json.loads(d.get("screening_result", "{}"))
        results.append(d)
    return results

def get_dashboard_stats(company_id=None):
    conn = get_connection()
    if company_id:
        total = conn.execute("SELECT COUNT(*) FROM candidates WHERE company_id=?", (company_id,)).fetchone()[0]
        passed = conn.execute("SELECT COUNT(*) FROM candidates WHERE company_id=? AND status='passed'", (company_id,)).fetchone()[0]
    else:
        total = conn.execute("SELECT COUNT(*) FROM candidates").fetchone()[0]
        passed = conn.execute("SELECT COUNT(*) FROM candidates WHERE status='passed'").fetchone()[0]
    conn.close()
    return {
        "candidates_screened": total,
        "ai_pass_rate": round(passed / total, 2) if total > 0 else 0,
        "avg_time_to_code": 34,
    }


# ─── Interview Questions ──────────────────────────────────────────────

def save_interview_questions(company_id, questions_data):
    """Save generated questions for a company."""
    conn = get_connection()
    import uuid
    for i, q in enumerate(questions_data):
        q_id = str(uuid.uuid4())
        extra = {}
        for k in ("explanation", "constraints", "test_cases", "starter_code"):
            if k in q and q[k] is not None:
                extra[k] = q[k]
        extra_json = json.dumps(extra) if extra else "{}"
        conn.execute(
            """INSERT INTO interview_questions 
               (id, company_id, question_type, question_text, correct_answer, options, difficulty, order_index, extra_json)
               VALUES (?,?,?,?,?,?,?,?,?)""",
            (q_id, company_id, q['type'], q['text'], q.get('answer', ''),
             json.dumps(q.get('options', [])), q.get('difficulty', 'medium'), i, extra_json)
        )
    conn.commit()
    conn.close()

def get_interview_questions(company_id):
    """Get all questions for a company."""
    conn = get_connection()
    rows = conn.execute(
        "SELECT * FROM interview_questions WHERE company_id = ? ORDER BY order_index",
        (company_id,)
    ).fetchall()
    conn.close()
    questions = []
    for r in rows:
        d = dict(r)
        d['options'] = json.loads(d.get('options', '[]'))
        # Normalize to the same shape as LLM JSON (frontends use type/text/answer)
        d['type'] = d.get('question_type')
        d['text'] = d.get('question_text')
        d['answer'] = d.get('correct_answer') or ''
        try:
            extra = json.loads(d.get('extra_json') or '{}')
            if isinstance(extra, dict):
                for k, v in extra.items():
                    d[k] = v
        except json.JSONDecodeError:
            pass
        questions.append(d)
    return questions


# ─── Interview Sessions ───────────────────────────────────────────────

def ensure_candidate_for_interview(candidate_id, company_id, display_name: str):
    """Stub row so JOIN queries and FK expectations work for portal interview flows."""
    conn = get_connection()
    conn.execute(
        """INSERT OR IGNORE INTO candidates (id, name, email, company_id, cv_chunks, status)
           VALUES (?,?,?,?,?,?)""",
        (candidate_id, display_name or "Candidate", "", company_id, 0, "interview"),
    )
    conn.commit()
    conn.close()


def create_interview_session(candidate_id, company_id, candidate_name: str = ""):
    """Create a new interview session."""
    import uuid
    session_id = str(uuid.uuid4())
    conn = get_connection()
    conn.execute(
        """INSERT INTO interview_sessions (id, candidate_id, company_id, status, candidate_name)
           VALUES (?,?,?,?,?)""",
        (session_id, candidate_id, company_id, 'in_progress', candidate_name or ""),
    )
    conn.commit()
    conn.close()
    return session_id

def get_interview_session(session_id):
    """Get interview session details."""
    conn = get_connection()
    row = conn.execute(
        "SELECT * FROM interview_sessions WHERE id = ?",
        (session_id,)
    ).fetchone()
    conn.close()
    if row:
        d = dict(row)
        d['mcq_scores'] = json.loads(d.get('mcq_scores', '{}'))
        td = d.get('telemetry_data')
        if isinstance(td, str):
            try:
                d['telemetry_data'] = json.loads(td or '{}')
            except json.JSONDecodeError:
                d['telemetry_data'] = {}
        return d
    return None

def update_interview_session(session_id, data):
    """Update interview session with MCQ answers or code submission."""
    conn = get_connection()
    updates = []
    values = []
    for k, v in data.items():
        if k == 'mcq_scores':
            updates.append("mcq_scores = ?")
            values.append(json.dumps(v))
        elif k in ['code_submission', 'code_feedback', 'status']:
            updates.append(f"{k} = ?")
            values.append(v)
        elif k == 'hints_used':
            updates.append(f"{k} = {k} + ?")
            values.append(v)
    
    values.append(session_id)
    query = f"UPDATE interview_sessions SET {', '.join(updates)} WHERE id = ?"
    conn.execute(query, values)
    conn.commit()
    conn.close()

def complete_interview_session(session_id):
    """Mark interview session as completed."""
    conn = get_connection()
    conn.execute(
        "UPDATE interview_sessions SET status = 'completed', completed_at = datetime('now') WHERE id = ?",
        (session_id,)
    )
    conn.commit()
    conn.close()


# ─── Interview Reports ────────────────────────────────────────────────

def save_interview_report(session_id, candidate_id, company_id, report_data):
    """Save interview report."""
    import uuid
    report_id = str(uuid.uuid4())
    conn = get_connection()
    conn.execute(
        """INSERT INTO interview_reports 
           (id, session_id, candidate_id, company_id, mcq_performance, code_performance, 
            overall_score, feedback, recommendations)
           VALUES (?,?,?,?,?,?,?,?,?)""",
        (report_id, session_id, candidate_id, company_id,
         json.dumps(report_data.get('mcq_performance', {})),
         json.dumps(report_data.get('code_performance', {})),
         report_data.get('overall_score', 0),
         report_data.get('feedback', ''),
         report_data.get('recommendations', ''))
    )
    conn.commit()
    conn.close()
    return report_id

def get_interview_report(session_id):
    """Get interview report for a session."""
    conn = get_connection()
    row = conn.execute(
        "SELECT * FROM interview_reports WHERE session_id = ?",
        (session_id,)
    ).fetchone()
    conn.close()
    if row:
        d = dict(row)
        d['mcq_performance'] = json.loads(d.get('mcq_performance', '{}'))
        d['code_performance'] = json.loads(d.get('code_performance', '{}'))
        return d
    return None


def get_interview_report_by_report_id(report_id):
    conn = get_connection()
    row = conn.execute("SELECT * FROM interview_reports WHERE id = ?", (report_id,)).fetchone()
    conn.close()
    if row:
        d = dict(row)
        d['mcq_performance'] = json.loads(d.get('mcq_performance', '{}'))
        d['code_performance'] = json.loads(d.get('code_performance', '{}'))
        return d
    return None


def get_company_candidate_updates(company_id):
    """Get all candidate session updates for a company."""
    conn = get_connection()
    rows = conn.execute(
        """SELECT s.*,
                  COALESCE(NULLIF(TRIM(c.name), ''), NULLIF(TRIM(s.candidate_name), ''), s.candidate_id) AS name,
                  r.overall_score, r.feedback, r.id AS report_id
           FROM interview_sessions s
           LEFT JOIN candidates c ON s.candidate_id = c.id
           LEFT JOIN interview_reports r ON s.id = r.session_id
           WHERE s.company_id = ?
           ORDER BY s.started_at DESC""",
        (company_id,)
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]


# ─── Utilities ────────────────────────────────────────────────────────

def clear_all_companies():
    """Clear all companies from the database."""
    conn = get_connection()
    conn.execute("DELETE FROM companies")
    conn.commit()
    conn.close()

def update_interview_session_cv(session_id, cv_path, candidate_name):
    """Update interview session with CV path."""
    conn = get_connection()
    conn.execute(
        "UPDATE interview_sessions SET cv_path = ?, candidate_name = ? WHERE id = ?",
        (cv_path, candidate_name, session_id)
    )
    conn.commit()
    conn.close()

def store_telemetry_data(session_id, telemetry_data):
    """Store telemetry data for a session."""
    conn = get_connection()
    try:
        # #region agent log
        _tc = _existing_columns(conn, "interview_sessions")
        _agent_dbg(
            "H4",
            "database.py:store_telemetry_data",
            "before telemetry SELECT",
            {"telemetry_col": "telemetry_data" in _tc},
        )
        # #endregion
        row = conn.execute(
            "SELECT telemetry_data FROM interview_sessions WHERE id = ?",
            (session_id,),
        ).fetchone()
        raw = row["telemetry_data"] if row else "{}"
        existing = json.loads(raw or "{}") if isinstance(raw, str) else (raw or {})
        existing.update(telemetry_data)
        conn.execute(
            "UPDATE interview_sessions SET telemetry_data = ? WHERE id = ?",
            (json.dumps(existing), session_id),
        )
        conn.commit()
    finally:
        conn.close()
