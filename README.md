# QuickHire

**AI-assisted hiring demo:** company job setup, CV ingestion with semantic search, Groq-powered screening and question generation, and a candidate interview experience with a **hint-only** in-editor assistant, telemetry, and scored reports.

This README is **orchestration- and LLM-focused**: how requests flow, where each model call happens, which prompts apply, and how LangChain / LangGraph / Chroma fit together. For a broader file-by-file tour, see [`docs/CODEBASE_GUIDE.md`](docs/CODEBASE_GUIDE.md).

---

## Table of contents

1. [Visual system map](#1-visual-system-map)
2. [Orchestration layers](#2-orchestration-layers)
3. [LLM call inventory](#3-llm-call-inventory)
4. [RAG and embeddings pipeline](#4-rag-and-embeddings-pipeline)
5. [REST-driven LLM flows](#5-rest-driven-llm-flows)
6. [WebSocket interview orchestration](#6-websocket-interview-orchestration)
7. [LangGraph agent (Socratic graph)](#7-langgraph-agent-socratic-graph)
8. [Prompt and message construction](#8-prompt-and-message-construction)
9. [Reliability: retries and fallbacks](#9-reliability-retries-and-fallbacks)
10. [Configuration and secrets](#10-configuration-and-secrets)
11. [Running locally](#11-running-locally)
12. [Known gaps and documentation debt](#12-known-gaps-and-documentation-debt)

---

## 1. Visual system map

High-level placement of **human actors**, **apps**, **API**, **data stores**, and **external LLM**.

```mermaid
flowchart TB
  subgraph actors [Actors]
    HR[Company / HR]
    CAND[Candidate]
  end

  subgraph fe [Frontends]
    FC[frontend-company<br/>Vite · React · ~port 3000]
    FCan[frontend-candidate<br/>Vite · React · Monaco · ~port 3001]
  end

  subgraph be [Backend FastAPI · port 8000]
    REST[REST router<br/>routers.py]
    WS[WebSocket<br/>ws_handler.py]
    RAG[rag.py<br/>RAG + LLM chains]
    AG[agent.py<br/>LangGraph + Groq]
  end

  subgraph data [Local data & infra]
    SQL[(SQLite<br/>quickhire.db)]
    CHR[(ChromaDB<br/>vector store)]
    RD[(Redis<br/>telemetry lists)]
  end

  subgraph ext [External]
    GROQ[Groq API<br/>Llama 3.3 70B etc.]
    HF[HuggingFace<br/>embeddings model]
  end

  HR --> FC
  CAND --> FCan
  FC --> REST
  FCan --> REST
  FCan --> WS

  REST --> SQL
  REST --> CHR
  REST --> RAG
  WS --> RD
  WS --> RAG
  WS --> AG

  RAG --> CHR
  RAG --> GROQ
  AG --> GROQ
  RAG -.->|loads| HF
```

**Legend**

| Edge | Meaning |
|------|---------|
| `REST` | HTTP JSON; durable interview/session state |
| `WS` | Real-time telemetry + assistant chat |
| `RAG` | Chroma + LangChain `ChatGroq` (and optional `ChatOpenAI`) |
| `AG` | LangGraph state machine + `ChatGroq` (reserved / alternate path) |

---

## 2. Orchestration layers

The backend stacks **transport**, **business logic**, and **model orchestration** in distinct layers.

```mermaid
flowchart LR
  subgraph L1 [L1 · Transport]
    HTTP[FastAPI HTTP]
    WSS[FastAPI WebSocket]
  end

  subgraph L2 [L2 · Application]
    RT[routers.py endpoints]
    WH[ws_handler.py loop]
    DB[(database.py)]
  end

  subgraph L3 [L3 · AI orchestration]
    LC[LangChain: prompts, chains, invoke]
    LG[LangGraph: StateGraph, nodes]
    TEN[tenacity: retries]
  end

  subgraph L4 [L4 · Models & tools]
    CG[ChatGroq]
    EM[HF Embeddings + Chroma]
  end

  HTTP --> RT
  WSS --> WH
  RT --> DB
  WH --> DB
  RT --> LC
  WH --> LC
  WH --> LG
  LC --> CG
  LG --> CG
  LC --> EM
  TEN -.-> LC
  TEN -.-> LG
```

**Responsibilities (explicit)**

| Layer | Module(s) | Responsibility |
|-------|-----------|----------------|
| L1 | `main.py` | App factory, CORS, router mount, DB init on lifespan |
| L2 | `routers.py`, `ws_handler.py`, `database.py` | Auth-less demo CRUD, session lifecycle, WS message typing |
| L3 | `rag.py`, `agent.py` | Prompt templates, message lists, graph execution, parsing LLM output |
| L4 | `langchain_groq`, `langchain_chroma`, `langchain_huggingface` | Model I/O, vector persistence |

---

## 3. LLM call inventory

Every **Groq (or optional OpenAI)** touchpoint, with **trigger**, **module**, **wrapper**, and **default model behavior**.

```mermaid
flowchart TB
  subgraph triggers [What triggers an LLM call]
    T1[POST /api/company]
    T2[POST /api/upload-cv + company_id]
    T3[GET /api/interview/questions lazy gen]
    T4[POST /api/interview/session/id/hint]
    T5[WS chat message]
    T6[process_chat_message - if used]
  end

  subgraph calls [Functions]
    F1[rag.screen_candidate]
    F2[rag.generate_interview_questions]
    F3[rag.generate_code_hints]
    F4[agent.graph_app.invoke]
  end

  T1 --> F2
  T2 --> F1
  T3 --> F2
  T4 --> F3
  T5 --> F3
  T6 --> F4
```

### 3.1 Summary table

| # | Entrypoint | Function | Primary model (default) | Temperature (typical) | Output shape |
|---|------------|----------|-------------------------|------------------------|--------------|
| 1 | `POST /api/upload-cv` (with `company_id`) | `rag.screen_candidate` | `llama-3.3-70b-versatile` | 0.1 | JSON dict: score, verdict, skills, reasoning |
| 2 | `POST /api/company`, lazy question fetch | `rag.generate_interview_questions` | same | 0.7 | List of question objects (MCQ + coding) |
| 3 | `POST .../hint` (REST) | `rag.generate_code_hints` | same (or BYO) | 0.55 | Plain text hint |
| 4 | `WS` `type: chat` | `rag.generate_code_hints` | same (or BYO) | 0.55 | Plain text (sent as `chat_response`) |
| 5 | `agent.process_chat_message` | LangGraph → `socratic_hint_agent` | same | 0.2 | Plain text reply |

**Interview report completion** (`POST .../complete`): the code comment references Groq, but **scoring and feedback strings are rule-based** (MCQ correctness, submission flag, telemetry heuristics). There is **no additional LLM call** there today.

### 3.2 Model selection inside `generate_code_hints`

```mermaid
flowchart TD
  A[generate_code_hints called] --> B{api_key present?}
  B -->|No| G[ChatGroq env GROQ_API_KEY]
  B -->|Yes| C{provider == openai?}
  C -->|Yes| D[ChatOpenAI gpt-4o-mini]
  D --> E{import / init OK?}
  E -->|No| F[ChatGroq with api_key]
  E -->|Yes| H[Use OpenAI]
  C -->|No Groq path| F
```

---

## 4. RAG and embeddings pipeline

**Retrieval-Augmented Generation** here means: **chunk CVs → embed → store in Chroma → (optional) similarity search**; **screening** uses **full extracted PDF text** passed to Groq, not only top-k chunks.

### 4.1 Ingestion flow

```mermaid
sequenceDiagram
  participant Client
  participant API as routers.upload_cv
  participant RAG as rag.process_and_store_cv
  participant PDF as PyPDFLoader
  participant SPL as RecursiveCharacterTextSplitter
  participant CHR as Chroma

  Client->>API: POST multipart PDF
  API->>RAG: process_and_store_cv(path, candidate_id, name)
  RAG->>PDF: load pages
  PDF-->>RAG: documents + text
  RAG->>SPL: split chunk_size 1000 overlap 200
  SPL-->>RAG: chunks
  RAG->>CHR: add_documents with metadata
  RAG-->>API: chunks count + full_text
  Note over API,RAG: full_text drives screen_candidate Groq call
```

### 4.2 Embedding model (no LLM)

| Component | Value |
|-----------|--------|
| Class | `HuggingFaceEmbeddings` |
| Model id | `all-MiniLM-L6-v2` |
| Vector store | `Chroma` with `persist_directory=CHROMA_DB_PATH` |
| Chunking | `RecursiveCharacterTextSplitter`, size 1000, overlap 200 |

### 4.3 Semantic search (available API)

`rag.search_candidates(job_description, n_results)` runs **similarity_search_with_score** over Chroma and deduplicates by `candidate_id`. Wire this to a dashboard endpoint if you want “find similar CVs to this JD.”

---

## 5. REST-driven LLM flows

### 5.1 Company creation → question generation

```mermaid
sequenceDiagram
  participant FE as frontend-company
  participant RT as POST /api/company
  participant DB as database
  participant GQ as rag.generate_interview_questions
  participant LLM as Groq

  FE->>RT: Form: name, job_title, job_description, requirements
  RT->>DB: save_company
  RT->>GQ: job_description, company_name
  GQ->>LLM: ChatPromptTemplate + JD slice 3000 chars
  LLM-->>GQ: JSON string
  GQ->>GQ: strip markdown fences, json.loads
  GQ-->>RT: list questions
  RT->>DB: save_interview_questions
  RT-->>FE: company_id + message
```

**Orchestration detail:** Question generation uses a **single-shot** `ChatPromptTemplate | ChatGroq` chain (`_llm_call`), not LangGraph. Creative variance is higher (`temperature=0.7`).

### 5.2 CV upload → screening

```mermaid
sequenceDiagram
  participant FE as Client
  participant RT as POST /api/upload-cv
  participant RAG as rag.process_and_store_cv
  participant SC as rag.screen_candidate
  participant LLM as Groq

  FE->>RT: PDF + optional company_id
  RT->>RAG: ingest + Chroma
  RAG-->>RT: full_text
  alt company_id set
    RT->>SC: cv_text, job_description, company_name
    SC->>LLM: Recruiter prompt temp 0.1
    LLM-->>SC: JSON
    SC-->>RT: structured screening
    RT->>DB: save candidate + screening JSON
  end
```

**Orchestration detail:** Screening uses **low temperature (0.1)** for stable JSON-style behavior.

### 5.3 REST hint endpoint (alternate to WebSocket)

`POST /api/interview/session/{session_id}/hint` with query params resolves the **coding** question from DB and calls `generate_code_hints` with that question text as `problem_description`. It increments `hints_used` on the session (see `database.update_interview_session` in flow).

---

## 6. WebSocket interview orchestration

**Route:** `WS /ws/interview/{session_id}` (`ws_handler.py`).

### 6.1 Message types (orchestration diagram)

```mermaid
stateDiagram-v2
  [*] --> Connected: accept WS
  Connected --> Telemetry: type telemetry
  Connected --> Init: type init
  Connected --> Chat: type chat
  Telemetry --> Redis: LPUSH telemetry session_id
  Init --> AgentMem: set_session_context
  Init --> Client: init_ack
  Chat --> RAG: generate_code_hints
  Chat --> Client: chat_response
```

| `type` | Handler action | Side effects |
|--------|----------------|--------------|
| `telemetry` | `redis.lpush("telemetry:{session_id}", json)` | Events in Redis list (consumer not shown in-stack) |
| `init` | Load company by `company_id`; build string; `set_session_context(session_id, ctx)` | In-memory dict in `agent.py` |
| `chat` | `rag.generate_code_hints(editor_code, get_session_context(...), user_msg, ...)` | Groq/OpenAI call; error string on failure |

### 6.2 Session context string format (after `init`)

Exact f-string from `ws_handler.py`:

```
Company: {name}
Role: {job_title}
Description: {job_description}
```

This becomes the **`problem_description`** argument to `generate_code_hints` (truncated to 6000 chars inside the user message body).

### 6.3 Chat payload (recommended client shape)

| Field | Role |
|-------|------|
| `message` | Candidate question only |
| `editor_code` | Full Monaco buffer snapshot |
| `api_key` | Optional BYO key |
| `provider` | `"groq"` (default) or `"openai"` |

**Frontend note:** `frontend-candidate/src/App.tsx` currently uses a **`MockWebSocket`** that simulates canned responses and never opens `ws://localhost:8000/ws/interview/...`. Telemetry may still be **`POST`**ed to REST. For end-to-end Groq hints over WS, replace the mock with a native `WebSocket` and send `init` after connect.

### 6.4 Sequence: real WebSocket chat (intended)

```mermaid
sequenceDiagram
  participant UI as AiAssistant + App
  participant WS as FastAPI WS
  participant MEM as agent session context
  participant RAG as generate_code_hints
  participant G as Groq

  UI->>WS: init + company_id
  WS->>MEM: set_session_context
  WS-->>UI: init_ack
  UI->>WS: chat + message + editor_code
  WS->>MEM: get_session_context
  WS->>RAG: code + JD context + question
  RAG->>G: SystemMessage + HumanMessage
  G-->>RAG: assistant text
  RAG-->>WS: stripped string
  WS-->>UI: chat_response
```

---

## 7. LangGraph agent (Socratic graph)

**File:** `agent.py`.

### 7.1 Graph topology

```mermaid
flowchart LR
  START([ENTRY]) --> N[hint_agent node]
  N --> END([END])

  subgraph state [AgentState]
    M[messages: Annotated list add_messages]
  end

  N --> M
```

**This is a single-node graph:** entry → `socratic_hint_agent` → END. There is no branching, tool-calling, or ReAct loop in this module (unlike heavier hiring graphs in separate reference projects).

### 7.2 State definition

| Field | Type | Reducer |
|-------|------|---------|
| `messages` | `list` | `add_messages` from LangGraph (appends new AI/Human/System messages) |

### 7.3 Node behavior (`socratic_hint_agent`)

1. Takes `state["messages"]`.
2. If no `SystemMessage` yet, prepends `_build_system_prompt()` (optionally empty company block).
3. Invokes `ChatGroq(model_name="llama-3.3-70b-versatile", temperature=0.2)` with full message list.
4. Returns `{"messages": [response]}`.

### 7.4 `process_chat_message` orchestration

```mermaid
flowchart TD
  A[process_chat_message input] --> B{SystemMessage in history?}
  B -->|No and ctx exists| C[Insert system prompt with COMPANY CONTEXT]
  B -->|Yes or no ctx| D[Keep list]
  C --> E[Append HumanMessage user_input]
  D --> E
  E --> F[graph_app.invoke messages]
  F --> G[Return last message content]
```

**Current WS path:** WebSocket **`chat`** uses **`rag.generate_code_hints`**, not `process_chat_message`. LangGraph remains available for future multi-turn chat history or server-side tooling.

---

## 8. Prompt and message construction

### 8.1 Screening (`screen_candidate`)

- **Pattern:** `ChatPromptTemplate.from_template(...)` → `ChatGroq`
- **Role:** “elite AI Technical Recruiter” for `{company}`
- **Structured output:** JSON keys `match_score`, `verdict`, `matching_skills`, `missing_skills`, `reasoning`, `recommended_questions`
- **Post-process:** Strip markdown code fences; `json.loads`; fallback dict on failure

### 8.2 Interview questions (`generate_interview_questions`)

- **Pattern:** Template chain
- **Output contract:** Exactly **4** questions in JSON: **3 × `mcq`**, **1 × `coding`** with `starter_code`, `test_cases`, etc.
- **JD truncation:** `job_description[:3000]`

### 8.3 Hints (`generate_code_hints`)

- **Pattern:** **Chat messages**, not a template chain:
  - `SystemMessage(INTERVIEW_HINT_SYSTEM)` — long integrity / no-solution policy
  - `HumanMessage` built from three blocks:
    1. Role/problem context (**≤ 6000** chars)
    2. IDE contents in a fenced code block (**≤ 12000** chars)
    3. Candidate question (**≤ 4000** chars)

The system prompt text is defined in `rag.py` as **`INTERVIEW_HINT_SYSTEM`** (markdown emphasis in text is sent as-is to the model).

### 8.4 LangGraph system prompt (`_build_system_prompt`)

Short Socratic mentor instructions; max **3 sentences** in instructions; appends raw `COMPANY CONTEXT` block when `set_session_context` populated.

---

## 9. Reliability: retries and fallbacks

| Mechanism | Where | Policy |
|-----------|-------|--------|
| `@retry` + `_llm_call` | `rag.py` screening, questions | 3 attempts, exponential backoff 1–15s |
| `@retry` + `_hint_llm_invoke` | `rag.py` hints | 3 attempts, 1–15s |
| `@retry` + `_call_groq` | `agent.py` graph node | 5 attempts, 2–30s |
| JSON parse failure | `screen_candidate`, `generate_interview_questions` | Fallback empty list or error-shaped dict |
| OpenAI import failure in hints | `generate_code_hints` | Fallback to `ChatGroq(api_key=...)` |
| WS Groq failure | `ws_handler.py` | Catch-all → user-visible error string with exception type name |

---

## 10. Configuration and secrets

| Variable | Purpose |
|----------|---------|
| `GROQ_API_KEY` | Default Groq authentication (`config.py` sets `os.environ` for LangChain) |
| `REDIS_HOST`, `REDIS_PORT` | Redis for WS telemetry lists |
| `CHROMA_DB_PATH` | Chroma persistence directory |
| `SQLITE_DB_PATH` | SQLite file; relative paths resolved under `backend/` |

**Never commit** real `.env` files; use `.gitignore` patterns at repo root.

---

## 11. Running locally

| Service | Command | Port |
|---------|---------|------|
| Backend | `cd backend && source venv/bin/activate && uvicorn main:app --reload` | 8000 |
| Company UI | `cd frontend-company && npm run dev` | 3000 |
| Candidate UI | `cd frontend-candidate && npm run dev` | 3001 |

**Dependencies:** Redis optional for strict telemetry queue behavior; Groq key required for real LLM output.

---

## 12. Known gaps and documentation debt

| Item | Detail |
|------|--------|
| **Mock WebSocket** | Candidate app does not hit FastAPI WS for chat unless you replace `MockWebSocket`. |
| **`complete` vs Groq** | Comment in `routers.py` says “Generate report using Groq”; implementation is heuristic scoring only. |
| **LangGraph vs hints** | WS chat uses `generate_code_hints`; LangGraph in `agent.py` is a separate, extensible path. |
| **`process_chat_message`** | Not wired to current WS handler; kept for LangGraph extension. |
| **Hint REST vs WS** | Both call the same `generate_code_hints`; REST also bumps `hints_used`. |
| **Code execution** | `CodeEditor` “run tests” / submit are stubs; evaluation is not a sandboxed runner in-repo. |

---

## Quick reference: file map (AI-related)

| File | AI / orchestration role |
|------|-------------------------|
| `backend/rag.py` | Chroma, embeddings, CV ingest, screening chain, question chain, **hint messages** + `INTERVIEW_HINT_SYSTEM` |
| `backend/agent.py` | LangGraph `StateGraph`, session context dict, `ChatGroq` Socratic node |
| `backend/ws_handler.py` | WS loop, Redis telemetry, `init` → context, `chat` → `generate_code_hints` |
| `backend/routers.py` | REST triggers for screening, questions, optional REST hint, **non-LLM** report |
| `backend/config.py` | Env + SQLite path normalization |
| `frontend-candidate/src/components/AiAssistant.tsx` | Chat UI + payload shape |
| `frontend-candidate/src/App.tsx` | Telemetry merge + **MockWebSocket** |

---

*README generated to match the QuickHire repository structure. If diagrams fail to render, use a Markdown viewer with Mermaid support (GitHub, many IDEs, or `mermaid-cli`).*
