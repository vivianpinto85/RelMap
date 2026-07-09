import subprocess, sys

# ── Agent ──────────────────────────────────────────────────────────────────────
from langchain_openai import ChatOpenAI
from langgraph.graph import StateGraph, END
from langchain_core.messages import SystemMessage, HumanMessage
from typing import TypedDict, Optional, List
from pydantic import BaseModel, Field
from fastapi import FastAPI, Query
from langserve import add_routes
import uvicorn

# ── LLM — swap base_url/key for whatever local or cloud LLM you have ──────────
llm = ChatOpenAI(
    base_url="http://localhost:8080/v1",  # or real Anthropic/OpenAI endpoint
    api_key="dummy",
    model="@bedrock-sbx/us.anthropic.claude-sonnet-4-6",
    temperature=0,
)

class SQLFix(BaseModel):
    has_issues: bool = Field(description="Whether the query has correctness issues")
    issues: List[str] = Field(description="Short list of identified issues")
    fixed_query: str = Field(description="The corrected SQL query")
    explanation: str = Field(description="Concise explanation of what was wrong and why the fix works")

structured_llm = llm.with_structured_output(SQLFix)

class SQLAnalysisState(TypedDict):
    query: str
    schema: Optional[str]
    error: Optional[str]
    sample_result: Optional[str]
    dialect: Optional[str]
    result: Optional[dict]

SYSTEM_PROMPT = """You are an expert SQL reviewer. Check for: wrong join type, 
wrong join keys, fan-out from one-to-many joins, cartesian products, GROUP BY 
mismatches, NULL handling, ambiguous columns. Respond with structured fields."""

def analyze(state: SQLAnalysisState) -> dict:
    parts = [
        f"SQL dialect: {state.get('dialect') or 'unspecified'}",
        f"Query:\n```sql\n{state['query']}\n```"
    ]
    if state.get("schema"):
        parts.append(f"Schema:\n{state['schema']}")
    if state.get("error"):
        parts.append(f"Error:\n{state['error']}")
    response: SQLFix = structured_llm.invoke(
        [SystemMessage(content=SYSTEM_PROMPT), HumanMessage(content="\n\n".join(parts))]
    )
    return {"result": response.model_dump()}

graph = StateGraph(SQLAnalysisState)
graph.add_node("analyze", analyze)
graph.set_entry_point("analyze")
graph.add_edge("analyze", END)
sql_agent = graph.compile()

# ── FastAPI ────────────────────────────────────────────────────────────────────
app = FastAPI(title="sql-fix-agent")
add_routes(app, sql_agent, path="/sql-agent")

@app.get("/sql-agent/analyze")
async def analyze_get(query: str = Query(...), dialect: str = Query("redshift")):
    result = sql_agent.invoke({
        "query": query, "dialect": dialect,
        "schema": None, "error": None,
        "sample_result": None, "result": None,
    })
    return result["result"]

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8903, log_level="info")