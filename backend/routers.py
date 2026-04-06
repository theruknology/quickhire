"""
REST endpoints — the glue connecting frontends to the AI engine.
"""
import os
import uuid
import json
from fastapi import APIRouter, UploadFile, File, HTTPException, Form, Body
from typing import Optional
from pydantic import BaseModel
import rag
import database

router = APIRouter()


@router.get("/api/debug/db-interview-sessions")
def debug_db_interview_sessions_columns():
    """Dev helper: confirm which SQLite file is used and session table columns (debug session d7f86e)."""
    conn = database.get_connection()
    try:
        rows = conn.execute("PRAGMA table_info(interview_sessions)").fetchall()
        cols = [r[1] for r in rows]
    finally:
        conn.close()
    return {
        "db_path": os.path.abspath(database.DB_FILE),
        "interview_sessions_columns": cols,
        "has_telemetry_data": "telemetry_data" in cols,
    }


# ═══════════════════════════════════════════════════════════════════════
# COMPANY endpoints
# ═══════════════════════════════════════════════════════════════════════

@router.post("/api/company")
async def create_company(
    name: str = Form(...),
    job_title: str = Form(...),
    job_description: str = Form(...),
    requirements: str = Form("[]"),
):
    """Company uploads its info and job description. Questions are generated immediately."""
    company_id = str(uuid.uuid4())
    try:
        reqs = json.loads(requirements)
    except json.JSONDecodeError:
        reqs = [r.strip() for r in requirements.split(",") if r.strip()]

    database.save_company(company_id, name, job_title, job_description, reqs)

    # Generate questions immediately
    questions_data = rag.generate_interview_questions(
        job_description=job_description,
        company_name=name
    )

    if questions_data:
        database.save_interview_questions(company_id, questions_data)
    
    return {
        "company_id": company_id,
        "message": f"Company '{name}' created with {len(questions_data) if questions_data else 0} interview questions ready."
    }


@router.get("/api/company/{company_id}")
def get_company(company_id: str):
    company = database.get_company(company_id)
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")
    company["requirements"] = json.loads(company.get("requirements", "[]"))
    return company


@router.get("/api/companies")
def list_companies():
    companies = database.get_all_companies()
    for c in companies:
        c["requirements"] = json.loads(c.get("requirements", "[]"))
    return {"companies": companies}


@router.post("/api/companies/clear")
def clear_companies():
    """Clear all companies from the database (admin endpoint)."""
    database.clear_all_companies()
    return {"message": "All companies cleared."}


# ═══════════════════════════════════════════════════════════════════════
# CANDIDATE CV Upload + Pre-screening pipeline
# ═══════════════════════════════════════════════════════════════════════

@router.post("/api/upload-cv")
async def upload_cv(
    file: UploadFile = File(...),
    candidate_name: str = Form(""),
    candidate_email: str = Form(""),
    company_id: str = Form(""),
):
    """
    Candidate uploads their CV.
    Pipeline: PDF → Chunk → Embed into ChromaDB → AI Pre-Screen → Store result.
    """
    if not file.filename or not file.filename.endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported")

    name = candidate_name or file.filename.replace(".pdf", "")

    # 1. Save temp file
    os.makedirs("/tmp/quickhire", exist_ok=True)
    temp_path = f"/tmp/quickhire/{uuid.uuid4()}_{file.filename}"
    with open(temp_path, "wb") as f:
        f.write(await file.read())

    # 2. Ingest into ChromaDB
    candidate_id = str(uuid.uuid4())
    ingest_result = rag.process_and_store_cv(temp_path, candidate_id, name)
    os.remove(temp_path)

    # 3. AI Pre-screening (only if a company_id is provided)
    screening = None
    status = "pending"
    score = 0

    if company_id:
        company = database.get_company(company_id)
        if company:
            screening = rag.screen_candidate(
                cv_text=ingest_result["full_text"],
                job_description=company["job_description"],
                company_name=company["name"],
            )
            score = screening.get("match_score", 0)
            status = "passed" if screening.get("verdict", "").upper() == "PASS" else "failed"

    # 4. Save to DB
    database.save_candidate(candidate_id, name, candidate_email, company_id, ingest_result["chunks"], status)
    if screening:
        database.update_candidate_screening(candidate_id, score, screening, status)

    return {
        "candidate_id": candidate_id,
        "name": name,
        "chunks": ingest_result["chunks"],
        "screening": screening,
        "status": status,
    }


# ═══════════════════════════════════════════════════════════════════════
# DASHBOARD endpoints
# ═══════════════════════════════════════════════════════════════════════

@router.get("/api/dashboard/stats")
def get_stats(company_id: Optional[str] = None):
    return database.get_dashboard_stats(company_id)


@router.get("/api/dashboard/candidates")
def get_candidates(company_id: Optional[str] = None):
    """Return candidates from the DB, enriched with screening data."""
    if company_id:
        rows = database.get_candidates_for_company(company_id)
    else:
        # Fallback: return all
        conn = database.get_connection()
        raw = conn.execute("SELECT * FROM candidates ORDER BY screening_score DESC").fetchall()
        conn.close()
        rows = []
        for r in raw:
            d = dict(r)
            d["screening_result"] = json.loads(d.get("screening_result", "{}"))
            rows.append(d)

    candidates = []
    for r in rows:
        sr = r.get("screening_result", {})
        candidates.append({
            "id": r["id"],
            "name": r["name"],
            "score": sr.get("match_score", r.get("screening_score", 0)),
            "status": r["status"].capitalize(),
            "core_competencies": sr.get("matching_skills", []),
            "missing_skills": sr.get("missing_skills", []),
            "reasoning": sr.get("reasoning", ""),
            "recommended_questions": sr.get("recommended_questions", []),
        })

    # Fallback demo data if DB is empty
    if not candidates:
        candidates = [
            {"id": "demo-1", "name": "Alice Smith", "score": 92, "status": "Passed",
             "core_competencies": ["React", "TypeScript", "Python"],
             "missing_skills": [], "reasoning": "Demo data", "recommended_questions": []},
        ]

    return {"candidates": candidates}


@router.get("/api/candidate/{candidate_id}")
def get_candidate_detail(candidate_id: str):
    c = database.get_candidate(candidate_id)
    if not c:
        raise HTTPException(status_code=404, detail="Candidate not found")
    return c


# ═══════════════════════════════════════════════════════════════════════
# INTERVIEW endpoints
# ═══════════════════════════════════════════════════════════════════════

@router.get("/api/interview/questions/{company_id}")
def get_interview_questions(company_id: str):
    """Get or generate interview questions for a company."""
    questions = database.get_interview_questions(company_id)

    if not questions:
        # Generate questions if they don't exist
        company = database.get_company(company_id)
        if not company:
            raise HTTPException(status_code=404, detail="Company not found")
        
        questions_data = rag.generate_interview_questions(
            job_description=company["job_description"],
            company_name=company["name"]
        )

        if questions_data:
            database.save_interview_questions(company_id, questions_data)
            questions = database.get_interview_questions(company_id)

    return {"questions": questions}


class SubmitCodeBody(BaseModel):
    code: str
    problem_id: Optional[str] = None


class McqAnswerBody(BaseModel):
    question_id: str
    selected_answer: str


@router.post("/api/interview/session/start")
async def start_interview_session(
    candidate_id: str = Body(...),
    company_id: str = Body(...),
    candidate_name: str = Body(""),
):
    """Create a new interview session for a candidate."""
    company = database.get_company(company_id)
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")

    database.ensure_candidate_for_interview(candidate_id, company_id, candidate_name)
    session_id = database.create_interview_session(candidate_id, company_id, candidate_name)

    return {
        "session_id": session_id,
        "candidate_id": candidate_id,
        "company": {"id": company_id, "name": company["name"]},
        "status": "in_progress",
    }


@router.post("/api/interview/session/{session_id}/upload-cv")
async def upload_interview_cv(
    session_id: str,
    file: UploadFile = File(...),
    candidate_name: str = Form(""),
):
    """Upload CV for interview session."""
    session = database.get_interview_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    
    if not file.filename or not file.filename.endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported")
    
    # Save temp file
    os.makedirs("/tmp/quickhire", exist_ok=True)
    temp_path = f"/tmp/quickhire/{uuid.uuid4()}_{file.filename}"
    with open(temp_path, "wb") as f:
        f.write(await file.read())
    
    # Store CV path in session
    database.update_interview_session_cv(session_id, temp_path, candidate_name or "Candidate")
    
    return {
        "status": "success",
        "message": f"CV uploaded for {candidate_name or 'candidate'}",
        "cv_path": temp_path
    }


@router.get("/api/interview/session/{session_id}")
def get_interview_session(session_id: str):
    """Get interview session details."""
    session = database.get_interview_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


@router.post("/api/interview/session/{session_id}/telemetry")
def post_interview_telemetry(session_id: str, payload: dict = Body(...)):
    """Merge behavioral telemetry into the interview session (used by final report)."""
    session = database.get_interview_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    database.store_telemetry_data(session_id, payload)
    return {"status": "ok"}


@router.post("/api/interview/session/{session_id}/answer")
def submit_mcq_answer(session_id: str, body: McqAnswerBody):
    """Submit an MCQ answer."""
    session = database.get_interview_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    mcq_scores = session.get("mcq_scores", {})
    mcq_scores[body.question_id] = body.selected_answer

    database.update_interview_session(session_id, {"mcq_scores": mcq_scores})

    return {"status": "success", "message": "Answer recorded"}


@router.post("/api/interview/session/{session_id}/submit-code")
def submit_code_solution(session_id: str, body: SubmitCodeBody):
    """Submit code solution for coding problem."""
    session = database.get_interview_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    database.update_interview_session(
        session_id,
        {
            "code_submission": body.code,
            "status": "code_submitted"
        }
    )
    
    return {"status": "success", "message": "Code submission recorded"}


@router.post("/api/interview/session/{session_id}/hint")
def get_contextual_hint(
    session_id: str,
    code_context: str,
    user_query: str,
    api_key: str = None
):
    """Get a hint based on code context and user query."""
    session = database.get_interview_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    
    company = database.get_company(session["company_id"])
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")
    
    # Get the coding question details (simplified)
    questions = database.get_interview_questions(session["company_id"])
    coding_problem = next((q for q in questions if q["type"] == "coding"), None)
    
    if not coding_problem:
        return {"hint": "Review the problem statement carefully."}
    
    hint = rag.generate_code_hints(
        code_context=code_context,
        problem_description=coding_problem["text"],
        user_query=user_query,
        api_key=api_key
    )
    
    # Track hint usage
    database.update_interview_session(session_id, {"hints_used": 1})
    
    return {"hint": hint}


@router.post("/api/interview/session/{session_id}/complete")
def complete_interview(session_id: str):
    """Mark interview as complete and generate report with CV and behavioral data."""
    session = database.get_interview_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    
    # Mark session as completed
    database.complete_interview_session(session_id)
    
    # Generate report using Groq
    company = database.get_company(session["company_id"])
    candidate = database.get_candidate(session["candidate_id"])
    
    questions = database.get_interview_questions(session["company_id"])
    mcq_questions = [q for q in questions if q["type"] == "mcq"]
    code_question = next((q for q in questions if q["type"] == "coding"), None)
    
    # Calculate MCQ score
    mcq_score = 0
    mcq_performance = {}
    if mcq_questions:
        correct = 0
        for mq in mcq_questions:
            user_answer = session["mcq_scores"].get(mq["id"], "")
            correct_answer = mq.get("answer", "")
            is_correct = user_answer == correct_answer
            if is_correct:
                correct += 1
            mcq_performance[mq["id"]] = {
                "question": mq["text"],
                "user_answer": user_answer,
                "correct_answer": correct_answer,
                "is_correct": is_correct
            }
        mcq_score = (correct / len(mcq_questions)) * 100
    
    # Parse telemetry data for behavioral analysis
    td = session.get("telemetry_data", {})
    if isinstance(td, str):
        telemetry = json.loads(td or "{}")
    else:
        telemetry = td or {}
    behavioral_analysis = {
        "keystrokes": telemetry.get("keystrokes", 0),
        "delete_ratio": telemetry.get("delete_ratio", 0),
        "wpm": telemetry.get("wpm", 0),
        "tab_switches": telemetry.get("tab_switch_count", 0),
        "copy_paste_count": telemetry.get("copy_paste_count", 0),
        "focus_loss_count": telemetry.get("focus_loss_count", 0),
    }
    
    # Code performance (with behavioral data)
    code_performance = {
        "problem": code_question["text"] if code_question else "N/A",
        "submitted": len(session.get("code_submission", "")) > 0,
        "hints_used": session.get("hints_used", 0),
        "code_length": len(session.get("code_submission", "")),
        "status": "submitted",
        "behavioral_data": behavioral_analysis
    }
    
    # Calculate score with behavioral weighting
    code_score = 50 if code_performance["submitted"] else 0
    # Adjust code score based on behavior (reduce if suspicious patterns)
    if behavioral_analysis["copy_paste_count"] > 2:
        code_score *= 0.8
    if behavioral_analysis["focus_loss_count"] > 5:
        code_score *= 0.9
    
    overall_score = (mcq_score * 0.4) + (code_score * 0.6)
    
    # Get CV content if available
    cv_analysis = ""
    if session.get("cv_path"):
        try:
            from langchain_community.document_loaders import PyPDFLoader
            loader = PyPDFLoader(session["cv_path"])
            docs = loader.load()
            cv_text = "\n".join([d.page_content for d in docs])
        except Exception as e:
            cv_text = f"CV could not be processed: {str(e)}"
            
        cv_analysis = f"CV Summary: {cv_text[:500]}..." if cv_text else "No CV analyzed"
    
    report_data = {
        "mcq_performance": mcq_performance,
        "code_performance": code_performance,
        "overall_score": overall_score,
        "candidate_name": session.get("candidate_name", "Unknown"),
        "cv_analyzed": bool(session.get("cv_path")),
        "behavioral_data": behavioral_analysis,
        "feedback": f"Candidate scored {mcq_score:.0f}% on MCQs. Code: {'Submitted' if code_performance['submitted'] else 'Not submitted'}. Hints used: {code_performance['hints_used']}.",
        "recommendations": "Strong technical knowledge demonstrated" if overall_score >= 70 else "Recommend follow-up discussion"
    }
    
    report_id = database.save_interview_report(
        session_id,
        session["candidate_id"],
        session["company_id"],
        report_data
    )
    
    return {
        "status": "completed",
        "report_id": report_id,
        "overall_score": overall_score,
        "mcq_score": mcq_score,
        "code_score": code_score,
        "behavioral_data": behavioral_analysis,
        "feedback": report_data["feedback"],
        "recommendations": report_data.get("recommendations", ""),
        "mcq_performance": mcq_performance,
        "code_performance": code_performance,
        "cv_analyzed": report_data.get("cv_analyzed", False),
    }


@router.get("/api/interview/report/{report_id}")
def get_interview_report(report_id: str):
    """Get detailed interview report by id."""
    row = database.get_interview_report_by_report_id(report_id)
    if not row:
        raise HTTPException(status_code=404, detail="Report not found")
    return row


@router.get("/api/interview/session/{session_id}/report")
def get_interview_report_for_session(session_id: str):
    """Latest report for a session (candidate + company dashboards)."""
    row = database.get_interview_report(session_id)
    if not row:
        raise HTTPException(status_code=404, detail="Report not found for this session")
    return row


@router.get("/api/company/{company_id}/candidate-updates")
def get_company_candidate_updates(company_id: str):
    """Get all candidate session updates for a company."""
    updates = database.get_company_candidate_updates(company_id)
    return {"updates": updates}

