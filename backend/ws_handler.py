"""
WebSocket endpoint for the candidate interview environment.
Handles chat (→ rag.generate_code_hints + session context) and telemetry (→ Redis queue).
"""
import json
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from redis_client import get_redis_client
from agent import get_session_context, set_session_context
import database
import rag

router = APIRouter()


class ConnectionManager:
    def __init__(self):
        self.active: dict[str, WebSocket] = {}

    async def connect(self, ws: WebSocket, session_id: str):
        await ws.accept()
        self.active[session_id] = ws

    def disconnect(self, session_id: str):
        self.active.pop(session_id, None)

    async def send(self, session_id: str, data: dict):
        ws = self.active.get(session_id)
        if ws:
            await ws.send_text(json.dumps(data))

manager = ConnectionManager()


@router.websocket("/ws/interview/{session_id}")
async def interview_ws(websocket: WebSocket, session_id: str):
    await manager.connect(websocket, session_id)
    r = get_redis_client()

    try:
        while True:
            raw = await websocket.receive_text()
            payload = json.loads(raw)
            msg_type = payload.get("type")

            if msg_type == "telemetry":
                r.lpush(f"telemetry:{session_id}", json.dumps(payload.get("data", {})))

            elif msg_type == "init":
                # The candidate frontend sends company context at connection start
                company_id = payload.get("company_id", "")
                if company_id:
                    company = database.get_company(company_id)
                    if company:
                        ctx = f"Company: {company['name']}\nRole: {company['job_title']}\nDescription: {company['job_description']}"
                        set_session_context(session_id, ctx)
                await manager.send(session_id, {"type": "init_ack", "message": "Session initialized."})

            elif msg_type == "chat":
                user_msg = (payload.get("message") or "").strip()
                editor_code = (payload.get("editor_code") or "").strip()
                api_key = payload.get("api_key")
                provider = (payload.get("provider") or "groq").strip().lower()

                # Legacy: single string with "Code context:\n..." prefix from older clients
                if editor_code == "" and user_msg.startswith("Code context:\n"):
                    rest = user_msg[len("Code context:\n") :]
                    if "\n\n" in rest:
                        editor_code, user_msg = rest.split("\n\n", 1)
                        user_msg = user_msg.strip()
                    else:
                        editor_code, user_msg = rest, ""

                if not user_msg:
                    ai_reply = "Ask a question about your approach or where you're stuck — I'll reply with hints only, not full solutions."
                else:
                    try:
                        ai_reply = rag.generate_code_hints(
                            code_context=editor_code,
                            problem_description=get_session_context(session_id),
                            user_query=user_msg,
                            api_key=api_key,
                            provider=provider,
                        )
                    except Exception as e:
                        ai_reply = (
                            "Could not reach the AI right now. Check your API key or try again. "
                            f"({type(e).__name__})"
                        )

                await manager.send(session_id, {
                    "type": "chat_response",
                    "message": ai_reply,
                })
    except WebSocketDisconnect:
        manager.disconnect(session_id)
