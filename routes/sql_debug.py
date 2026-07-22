# routes/sql_debug.py
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import requests, re, traceback

router = APIRouter()


# ── Helpers ───────────────────────────────────────────────────────────────────
def call_chat_agent(prompt: str, agent_url: str, token: str) -> str:
    headers = {}
    if token:
        headers["Authorization"] = f"token {token}"
    full_url = f"{agent_url.rstrip('/')}/invoke"
    print(f"Calling chat agent: {full_url}", flush=True)
    r = requests.post(
        full_url,
        json={"input": {"messages": [{"type": "human", "content": prompt}]}},
        headers=headers,
        timeout=90,
        verify=False
    )
    if not r.ok:
        raise Exception(f"Agent {r.status_code}: {r.text[:300]}")
    return r.json()["output"]["messages"][-1]["content"]


def extract_sql_block(text: str) -> str:
    match = re.search(r"```(?:sql)?\n?(.*?)```", text, re.DOTALL | re.IGNORECASE)
    return match.group(1).strip() if match else text.strip()


def extract_tables_from_query(query: str) -> list:
    pattern = r'(?:FROM|JOIN)\s+([\w]+(?:\.[\w]+)?)'
    matches = re.findall(pattern, query, re.IGNORECASE)
    seen, tables = set(), []
    for m in matches:
        key = m.lower()
        if key not in seen:
            seen.add(key)
            tables.append(m)
    return tables


def format_rows_for_ai(columns: list, rows: list, max_rows: int = 10) -> str:
    if not rows:
        return "(no rows returned)"
    header = " | ".join(str(c) for c in columns)
    divider = "-" * len(header)
    sample = "\n".join(" | ".join(str(v) for v in row) for row in rows[:max_rows])
    result = f"{header}\n{divider}\n{sample}"
    if len(rows) > max_rows:
        result += f"\n... ({len(rows)} total rows)"
    return result


# ── Models ────────────────────────────────────────────────────────────────────
class SuggestDebugRequest(BaseModel):
    query: str
    dialect: str = "redshift"
    chat_agent_url: str
    token: str = ""

class RunQueryRequest(BaseModel):
    sql: str

class RunLocalRequest(BaseModel):
    sql: str

class InterpretRequest(BaseModel):
    original_query: str
    debug_sql: str
    columns: list
    rows: list
    chat_agent_url: str
    token: str = ""

class GenerateInsertsRequest(BaseModel):
    original_query: str
    followup_results: list
    chat_agent_url: str
    token: str = ""

class SaveSamplesRequest(BaseModel):
    tables: list


# ── POST /debug/suggest ───────────────────────────────────────────────────────
@router.post("/suggest")
async def suggest_debug_query(req: SuggestDebugRequest):
    tables = extract_tables_from_query(req.query)
    prompt = (
        f"You are a senior data engineer debugging a SQL query.\n\n"
        f"Dialect: {req.dialect}\n"
        f"Tables involved: {', '.join(tables)}\n\n"
        f"Original query:\n```sql\n{req.query}\n```\n\n"
        f"Your job: suggest a minimal diagnostic SELECT query that:\n"
        f"1. Samples a small number of rows (LIMIT 2-3) from the main driving table\n"
        f"2. Includes the JOIN key columns so we can verify joinability\n"
        f"3. Includes 1-2 timestamp or date columns for filtering\n"
        f"4. Uses a reasonable date filter (last 10 days or similar) to keep results small\n"
        f"5. Does NOT run the full query - just samples the source data\n\n"
        f"Respond with:\n"
        f"- One short sentence explaining what this query checks\n"
        f"- The SQL query in a ```sql block\n\n"
        f"Keep it simple and focused on verifying the JOIN keys exist and are populated."
    )
    try:
        response = call_chat_agent(prompt, req.chat_agent_url, req.token)
        debug_sql = extract_sql_block(response)
        explanation = re.sub(r"```.*?```", "", response, flags=re.DOTALL).strip()
        explanation = explanation.split("\n")[0].strip()
        return {"debug_sql": debug_sql, "explanation": explanation, "tables": tables}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── POST /debug/run ───────────────────────────────────────────────────────────
@router.post("/run")
async def run_query(req: RunQueryRequest):
    from db.redshift import execute_query
    try:
        return execute_query(req.sql)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# # ── POST /debug/run-local ─────────────────────────────────────────────────────
# @router.post("/run-local")
# async def run_local(req: RunLocalRequest):
#     import psycopg2
#     try:
#         conn = psycopg2.connect(
#             dbname="heads01", user="1", password="1",
#             host="localhost", port="5432"
#         )
#         cur = conn.cursor()
#         cur.execute(req.sql)
#         conn.commit()
#         conn.close()
#         return {"status": "ok"}
#     except Exception as e:
#         raise HTTPException(status_code=500, detail=str(e))


# ── POST /debug/interpret ─────────────────────────────────────────────────────
@router.post("/interpret")
async def interpret_results(req: InterpretRequest):
    tables = extract_tables_from_query(req.original_query)
    result_text = format_rows_for_ai(req.columns, req.rows)

    prompt = (
        f"You are a senior data engineer analyzing query results.\n\n"
        f"Original query:\n```sql\n{req.original_query}\n```\n\n"
        f"Debug query run:\n```sql\n{req.debug_sql}\n```\n\n"
        f"Results ({len(req.rows)} rows):\n{result_text}\n\n"
        f"Your tasks:\n"
        f"1. Briefly interpret what these results tell us about the data (2-3 sentences)\n"
        f"2. Identify the actual JOIN key values from the results\n"
        f"3. For EACH table involved ({', '.join(tables)}), suggest a focused lookup query that:\n"
        f"   - Uses real key values from the results above\n"
        f"   - Retrieves only rows that would participate in the original JOIN\n"
        f"   - Includes LIMIT 100\n\n"
        f"Format your response EXACTLY like this:\n\n"
        f"## Interpretation\n"
        f"[2-3 sentences]\n\n"
        f"## Follow-up Queries\n\n"
        f"Targets: [table name]\n"
        f"```sql\n[query]\n```\n\n"
        f"Targets: [table name]\n"
        f"```sql\n[query]\n```\n\n"
        f"One Targets: line immediately before each sql block."
    )

    try:
        response = call_chat_agent(prompt, req.chat_agent_url, req.token)
        print(f"Interpret AI response (first 1000):\n{response[:1000]}", flush=True)

        sql_blocks = re.findall(r'```(?:sql)?\n?(.*?)```', response, re.DOTALL | re.IGNORECASE)
        labels = re.findall(r'Targets?:\s*([^\n]+)', response, re.IGNORECASE)

        followups = []
        for i, sql in enumerate(sql_blocks):
            label = re.sub(r'[#*`]', '', labels[i]).strip()[:80] if i < len(labels) else f"Follow-up {i + 1}"
            followups.append({"label": label, "sql": sql.strip()})

        interp_match = re.search(r'##\s*Interpretation\s*\n(.*?)(?=##|\Z)', response, re.DOTALL)
        interpretation = interp_match.group(1).strip() if interp_match else response[:500]

        return {"interpretation": interpretation, "followup_queries": followups, "raw": response}
    except Exception as e:
        print(f"Interpret error: {traceback.format_exc()}", flush=True)
        raise HTTPException(status_code=500, detail=str(e))


# # ── POST /debug/generate-inserts ──────────────────────────────────────────────
# @router.post("/generate-inserts")
# async def generate_inserts(req: GenerateInsertsRequest):
#     results_summary = []
#     for entry in req.followup_results:
#         table = entry.get("table", "unknown")
#         columns = entry.get("columns", [])
#         rows = entry.get("rows", [])
#         results_summary.append(f"Table: {table}\n{format_rows_for_ai(columns, rows, max_rows=5)}")

#     results_text = "\n\n".join(results_summary)

#     prompt = (
#         f"You are a senior data engineer preparing sample data for a local PostgreSQL database.\n\n"
#         f"Original query (shows the JOIN relationships):\n```sql\n{req.original_query}\n```\n\n"
#         f"Sample data retrieved from Redshift for each table:\n{results_text}\n\n"
#         f"Your task:\n"
#         f"1. Identify rows across tables that can be successfully JOINed together using the JOIN conditions in the original query\n"
#         f"2. Generate INSERT statements for ONLY those joinable rows - no orphan rows\n"
#         f"3. Use PostgreSQL syntax (not Redshift)\n"
#         f"4. Add ON CONFLICT DO NOTHING to each INSERT so re-running is safe\n"
#         f"5. Include schema prefix in table names (e.g. INSERT INTO \"ah\".\"his_hga_lot\" ...)\n"
#         f"6. Only include columns that appear in the sample data\n\n"
#         f"Format your response as:\n\n"
#         f"## Joinable Rows Analysis\n"
#         f"[1-2 sentences explaining which rows join and why]\n\n"
#         f"## INSERT Statements\n\n"
#         f"```sql\n-- Table: [table name]\nINSERT INTO ...\n```\n\n"
#         f"```sql\n-- Table: [table name]\nINSERT INTO ...\n```"
#     )

#     try:
#         response = call_chat_agent(prompt, req.chat_agent_url, req.token)
#         print(f"Generate-inserts AI response (first 1000):\n{response[:1000]}", flush=True)

#         sql_blocks = re.findall(r'```(?:sql)?\n?(.*?)```', response, re.DOTALL | re.IGNORECASE)

#         analysis_match = re.search(r'##\s*Joinable Rows Analysis\s*\n(.*?)(?=##|\Z)', response, re.DOTALL)
#         analysis = analysis_match.group(1).strip() if analysis_match else ""

#         inserts = []
#         for sql in sql_blocks:
#             sql = sql.strip()
#             table_match = re.search(r'--\s*Table:\s*([^\n]+)', sql, re.IGNORECASE)
#             table_label = table_match.group(1).strip() if table_match else "unknown"
#             inserts.append({"table": table_label, "sql": sql})

#         return {"analysis": analysis, "inserts": inserts, "raw": response}
#     except Exception as e:
#         print(f"Generate-inserts error: {traceback.format_exc()}", flush=True)
#         raise HTTPException(status_code=500, detail=str(e))


# ── POST /debug/save-samples ──────────────────────────────────────────────────
@router.post("/save-samples")
async def save_samples(req: SaveSamplesRequest):
    from db.local_postgres import insert_sample_rows
    results = []
    for entry in req.tables:
        full_table = entry.get("table", "")
        columns = entry.get("columns", [])
        rows = entry.get("rows", [])
        if not full_table or not columns or not rows:
            results.append({"table": full_table, "status": "skipped", "reason": "empty"})
            continue
        schema, table = full_table.split(".", 1) if "." in full_table else ("public", full_table)
        try:
            r = insert_sample_rows(schema, table, columns, rows)
            results.append({"table": full_table, "status": "ok", **r})
        except Exception as e:
            results.append({"table": full_table, "status": "error", "reason": str(e)})
    return {"results": results}