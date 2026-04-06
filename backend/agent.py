"""
LangGraph agent — Socratic Hint Agent for the interview sandbox.
Now accepts company context so hints are tailored to the actual role.
"""
import os
from typing import Annotated, TypedDict
from langchain_groq import ChatGroq
from langchain_core.messages import HumanMessage, SystemMessage
from langgraph.graph import StateGraph, END
from langgraph.graph.message import add_messages
from tenacity import retry, stop_after_attempt, wait_exponential
from dotenv import load_dotenv
from config import GROQ_API_KEY

load_dotenv()
os.environ["GROQ_API_KEY"] = GROQ_API_KEY


class AgentState(TypedDict):
    messages: Annotated[list, add_messages]


@retry(stop=stop_after_attempt(5), wait=wait_exponential(multiplier=1, min=2, max=30))
def _call_groq(model, messages):
    return model.invoke(messages)


def _build_system_prompt(company_context: str = "") -> str:
    base = (
        "You are an expert senior engineering mentor inside a sandboxed coding assessment. "
        "You are monitoring a candidate taking a live coding test. "
        "You MUST NOT give direct answers or write code for them. "
        "Give Socratic hints — ask leading questions, point out edge cases, "
        "and gently guide them toward the solution. "
        "Keep every response to a maximum of 3 sentences."
    )
    if company_context:
        base += f"\n\nCOMPANY CONTEXT:\n{company_context}"
    return base


# We store per-session company context here (in prod this would be Redis)
_session_contexts: dict[str, str] = {}


def set_session_context(session_id: str, context: str):
    _session_contexts[session_id] = context


def get_session_context(session_id: str) -> str:
    return _session_contexts.get(session_id, "")


def socratic_hint_agent(state: AgentState):
    model = ChatGroq(model_name="llama-3.3-70b-versatile", temperature=0.2)
    messages = state["messages"]

    if not any(isinstance(m, SystemMessage) for m in messages):
        # Default prompt without company context
        messages = [SystemMessage(content=_build_system_prompt())] + messages

    response = _call_groq(model, messages)
    return {"messages": [response]}


workflow = StateGraph(AgentState)
workflow.add_node("hint_agent", socratic_hint_agent)
workflow.set_entry_point("hint_agent")
workflow.add_edge("hint_agent", END)
graph_app = workflow.compile()


def process_chat_message(user_input: str, history: list | None = None, session_id: str = "") -> str:
    """Invoke the graph and return the AI response text."""
    msgs = list(history or [])

    # Inject company context as system prompt if available
    ctx = _session_contexts.get(session_id, "")
    if ctx and not any(isinstance(m, SystemMessage) for m in msgs):
        msgs.insert(0, SystemMessage(content=_build_system_prompt(ctx)))

    msgs.append(HumanMessage(content=user_input))
    result = graph_app.invoke({"messages": msgs})
    return result["messages"][-1].content
