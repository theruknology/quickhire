"""
RAG pipeline — CV ingestion + semantic search + AI pre-screening.
Uses langchain_chroma / langchain_huggingface (proven on this machine).
"""
from langchain_chroma import Chroma
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_community.document_loaders import PyPDFLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_groq import ChatGroq
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.messages import HumanMessage, SystemMessage
from tenacity import retry, stop_after_attempt, wait_exponential
from config import CHROMA_DB_PATH, GROQ_API_KEY
import os, json

os.environ["GROQ_API_KEY"] = GROQ_API_KEY

# --- Global init (same pattern as reference project) ---
print("⚙️  Initializing Embedding Model (one-time setup)...")
embedding_function = HuggingFaceEmbeddings(model_name="all-MiniLM-L6-v2")

vector_db = Chroma(
    persist_directory=CHROMA_DB_PATH,
    embedding_function=embedding_function,
)


# ─── Ingestion ────────────────────────────────────────────────────────
def process_and_store_cv(pdf_path: str, candidate_id: str, candidate_name: str):
    """Load a PDF, chunk it, and upsert into ChromaDB."""
    loader = PyPDFLoader(pdf_path)
    documents = loader.load()

    full_text = "\n".join([d.page_content for d in documents])

    for doc in documents:
        doc.metadata["candidate_id"] = candidate_id
        doc.metadata["candidate_name"] = candidate_name

    text_splitter = RecursiveCharacterTextSplitter(
        chunk_size=1000, chunk_overlap=200, length_function=len
    )
    chunks = text_splitter.split_documents(documents)

    vector_db.add_documents(chunks)
    print(f"✅ Saved {len(chunks)} chunks for {candidate_name}")
    return {"status": "success", "chunks": len(chunks), "full_text": full_text}


# ─── Search ───────────────────────────────────────────────────────────
def search_candidates(job_description: str, n_results: int = 10):
    """Semantic search over all stored CVs."""
    results = vector_db.similarity_search_with_score(job_description, k=n_results)

    seen = set()
    candidates = []
    for doc, score in results:
        cid = doc.metadata.get("candidate_id", "unknown")
        if cid in seen:
            continue
        seen.add(cid)
        match_pct = round(max(0, min(100, (1 - score) * 100)))
        candidates.append({
            "id": cid,
            "name": doc.metadata.get("candidate_name", cid),
            "score": match_pct,
            "status": "In Review",
            "core_competencies": ["Extracted via RAG"],
        })
    return candidates


# ─── AI Pre-Screening ────────────────────────────────────────────────
@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=15))
def _llm_call(chain, inputs):
    return chain.invoke(inputs)


def screen_candidate(cv_text: str, job_description: str, company_name: str = ""):
    """
    Use Groq LLM to pre-screen a candidate CV against the job description.
    Returns a structured dict with score, reasoning, matching/missing skills.
    """
    llm = ChatGroq(model_name="llama-3.3-70b-versatile", temperature=0.1)

    prompt = ChatPromptTemplate.from_template("""
You are an elite AI Technical Recruiter for {company}.
Analyze this resume against the job requirements below.

JOB DESCRIPTION:
{job_description}

CANDIDATE RESUME:
{cv_text}

Return your analysis as valid JSON with these exact keys:
{{
  "match_score": <number 0-100>,
  "verdict": "<PASS or FAIL>",
  "matching_skills": ["skill1", "skill2"],
  "missing_skills": ["skill1", "skill2"],
  "reasoning": "<2-3 sentence explanation>",
  "recommended_questions": ["question1", "question2", "question3"]
}}

Return ONLY the JSON, no markdown or extra text.
""")

    chain = prompt | llm
    response = _llm_call(chain, {
        "company": company_name or "the hiring company",
        "job_description": job_description,
        "cv_text": cv_text[:4000],  # Truncate to stay within token limits
    })

    # Parse the JSON from the LLM response
    content = response.content.strip()
    # Try to extract JSON if wrapped in markdown
    if "```" in content:
        content = content.split("```")[1]
        if content.startswith("json"):
            content = content[4:]
        content = content.strip()

    try:
        result = json.loads(content)
    except json.JSONDecodeError:
        result = {
            "match_score": 0,
            "verdict": "FAIL",
            "matching_skills": [],
            "missing_skills": ["Unable to parse"],
            "reasoning": "LLM returned invalid JSON.",
            "recommended_questions": [],
        }

    return result


# ─── Question Generation ──────────────────────────────────────────────

def generate_interview_questions(job_description: str, company_name: str = ""):
    """
    Generate 4 interview questions based on job description:
    - 3 multiple choice questions about concepts
    - 1 LeetCode-style coding question
    Returns a list of question objects.
    """
    llm = ChatGroq(model_name="llama-3.3-70b-versatile", temperature=0.7)

    prompt = ChatPromptTemplate.from_template("""
You are an expert technical interview designer for {company}.
Based on this job description, generate exactly 4 interview questions:
- 3 multiple-choice questions (conceptual) about the key technologies/skills
- 1 LeetCode-style coding problem

JOB DESCRIPTION:
{job_description}

Return ONLY valid JSON (no markdown) with this exact structure:
{{
  "questions": [
    {{
      "type": "mcq",
      "text": "Question text here?",
      "options": ["A) Option 1", "B) Option 2", "C) Option 3", "D) Option 4"],
      "answer": "B",
      "difficulty": "medium",
      "explanation": "Brief explanation of why this is correct"
    }},
    {{
      "type": "mcq",
      "text": "Question text here?",
      "options": ["A) Option 1", "B) Option 2", "C) Option 3", "D) Option 4"],
      "answer": "C",
      "difficulty": "medium",
      "explanation": "Brief explanation"
    }},
    {{
      "type": "mcq",
      "text": "Question text here?",
      "options": ["A) Option 1", "B) Option 2", "C) Option 3", "D) Option 4"],
      "answer": "A",
      "difficulty": "hard",
      "explanation": "Brief explanation"
    }},
    {{
      "type": "coding",
      "text": "Coding problem description here. Include example inputs/outputs.",
      "difficulty": "medium",
      "constraints": "Any constraints on the problem",
      "starter_code": "def solve(input_data):\\n    pass",
      "test_cases": [
        {{"input": "example1", "output": "expected_output1"}},
        {{"input": "example2", "output": "expected_output2"}}
      ]
    }}
  ]
}}
""")

    chain = prompt | llm
    response = _llm_call(chain, {
        "company": company_name or "the hiring company",
        "job_description": job_description[:3000],  # Truncate to token limits
    })

    content = response.content.strip()
    # Extract JSON if wrapped in markdown
    if "```" in content:
        content = content.split("```")[1]
        if content.startswith("json"):
            content = content[4:]
        content = content.strip()

    try:
        result = json.loads(content)
        return result.get("questions", [])
    except json.JSONDecodeError as e:
        print(f"Failed to parse questions JSON: {e}")
        return []


INTERVIEW_HINT_SYSTEM = """You are the in-editor interview assistant during a live coding assessment.

Primary objective: help the candidate make progress through **hints and reflection**, not by doing the work for them.

Non-negotiable constraints (assessment integrity):
- Do **not** give a complete solution, final algorithm spelled out step-by-step for their exact task, or copy-paste-ready code blocks that solve the challenge.
- Do **not** rewrite their whole function/class or patch every bug line-by-line; you may cite at most a **few words** of their code by paraphrase (e.g. "the condition in your inner loop"), never a full corrected version.
- Do **not** leak multiple-choice answers, hidden tests, or anything that would short-circuit evaluation.
- If they demand a direct answer, refuse in one short phrase and pivot to one concrete **next question** or **conceptual nudge**.

You should use **both** the ROLE/PROBLEM CONTEXT and the **CURRENT IDE CONTENTS** they sent: relate your hint to what they actually wrote (e.g. structure, an off-by-one risk, a missing case) when relevant.

Allowed and encouraged:
- Suggest **what to check next** (invariants, boundaries, empty input, typical edge cases) without naming the full resolving logic.
- Name **general** patterns only when pedagogy requires ("two-pointer thinking", "prefix sums as an idea") without mapping it verbatim to their file.
- Ask **one or two sharp questions** that narrow their debugging or design space.

Voice: concise, calm senior engineer (roughly 3–6 short sentences, or a few tight bullets). No filler."""


@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=15))
def _hint_llm_invoke(llm, messages: list):
    return llm.invoke(messages)


def generate_code_hints(
    code_context: str,
    problem_description: str,
    user_query: str,
    api_key: str | None = None,
    provider: str = "groq",
):
    """
    Interview assistant: Groq (or optional BYO key OpenAI / Groq) with a strict hint-only system prompt.
    Uses problem/company context plus the candidate's live editor contents.
    """
    provider = (provider or "groq").strip().lower()

    if api_key:
        if provider == "openai":
            try:
                from langchain_openai import ChatOpenAI

                llm = ChatOpenAI(api_key=api_key, model="gpt-4o-mini", temperature=0.55)
            except Exception:
                llm = ChatGroq(
                    model_name="llama-3.3-70b-versatile",
                    api_key=api_key,
                    temperature=0.55,
                )
        else:
            llm = ChatGroq(
                model_name="llama-3.3-70b-versatile",
                api_key=api_key,
                temperature=0.55,
            )
    else:
        llm = ChatGroq(model_name="llama-3.3-70b-versatile", temperature=0.55)

    code_block = (code_context or "").strip() or "(Editor is empty or not provided.)"
    problem_block = (problem_description or "").strip() or "(No company/role context was provided.)"

    human = f"""ROLE / PROBLEM CONTEXT (framing only — do not quote secrets or tests verbatim):
{problem_block[:6000]}

CURRENT IDE CONTENTS (candidate code as of this message — read-only context):
```
{code_block[:12000]}
```

CANDIDATE QUESTION:
{(user_query or "").strip()[:4000]}
"""

    messages = [SystemMessage(content=INTERVIEW_HINT_SYSTEM), HumanMessage(content=human)]
    response = _hint_llm_invoke(llm, messages)
    return (response.content or "").strip()
