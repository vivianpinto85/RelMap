from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
import psycopg2, hashlib, re, os, requests
from datetime import datetime

router = APIRouter()

DOCS_FOLDER = "docs"
os.makedirs(DOCS_FOLDER, exist_ok=True)

# ── DB connection (reuse same pattern as schema.py) ───────────────────────────
def get_local_conn():
    return psycopg2.connect(
        dbname="heads01", user="1", password="1", host="localhost", port="5432"
    )

# ── Ensure knowledge table exists ─────────────────────────────────────────────
def ensure_knowledge_table():
    conn = get_local_conn()
    cur = conn.cursor()
    cur.execute("""
        CREATE TABLE IF NOT EXISTS public.sql_knowledge (
            id              SERIAL PRIMARY KEY,
            query_hash      TEXT UNIQUE,
            original_file   TEXT,
            short_name      TEXT,
            doc_filename    TEXT,
            tables_involved TEXT[],
            processed_at    TIMESTAMP DEFAULT NOW()
        )
    """)
    conn.commit()
    conn.close()

ensure_knowledge_table()

# ── Extract table names from SQL ──────────────────────────────────────────────
def extract_tables(query: str) -> list[str]:
    # Match schema.table or plain table after FROM/JOIN keywords
    pattern = r'(?:FROM|JOIN)\s+([\w]+(?:\.[\w]+)?)'
    matches = re.findall(pattern, query, re.IGNORECASE)
    # Deduplicate, lowercase
    seen = set()
    tables = []
    for m in matches:
        key = m.lower()
        if key not in seen:
            seen.add(key)
            tables.append(m)
    return tables

# ── Hash a query ──────────────────────────────────────────────────────────────
def hash_query(query: str) -> str:
    return hashlib.md5(query.strip().encode()).hexdigest()

# ── Check if query already processed ─────────────────────────────────────────
def get_existing_knowledge(query_hash: str) -> Optional[dict]:
    conn = get_local_conn()
    cur = conn.cursor()
    cur.execute("""
        SELECT original_file, short_name, doc_filename, tables_involved
        FROM public.sql_knowledge
        WHERE query_hash = %s
    """, (query_hash,))
    row = cur.fetchone()
    conn.close()
    if row:
        return {
            "original_file":   row[0],
            "short_name":      row[1],
            "doc_filename":    row[2],
            "tables_involved": row[3],
        }
    return None

# ── Save knowledge record ─────────────────────────────────────────────────────
def save_knowledge_record(query_hash, original_file, short_name, doc_filename, tables):
    conn = get_local_conn()
    cur = conn.cursor()
    cur.execute("""
        INSERT INTO public.sql_knowledge
            (query_hash, original_file, short_name, doc_filename, tables_involved)
        VALUES (%s, %s, %s, %s, %s)
        ON CONFLICT (query_hash) DO UPDATE SET
            short_name   = EXCLUDED.short_name,
            doc_filename = EXCLUDED.doc_filename,
            processed_at = NOW()
    """, (query_hash, original_file, short_name, doc_filename, tables))
    conn.commit()
    conn.close()

# ── Call AI to document the query ─────────────────────────────────────────────
def ask_ai_to_document(query: str, ddl_map: dict, dialect: str, agent_url: str, token: str) -> dict:
    ddl_context = "\n\n".join([f"-- {tbl}\n{ddl}" for tbl, ddl in ddl_map.items()])

    prompt = f"""You are a senior data engineer. Analyze this SQL query and produce structured documentation.

SQL Dialect: {dialect}

Table DDL:
{ddl_context}

Query:
```sql
{query}
```

Respond ONLY with a JSON object (no markdown, no explanation outside JSON) with these exact keys:
{{
  "short_name": "3-5 word snake_case name summarizing what this query does (e.g. hga_lot_weekly_defect_summary)",
  "purpose": "1-2 sentences describing what business question this query answers",
  "tables_used": ["list", "of", "table", "names"],
  "key_columns": ["important", "columns", "used"],
  "interpretation": "How should someone interpret the result set? What do the rows mean?",
  "potential_issues": "Any SQL issues, performance concerns, or things to watch out for"
}}"""

    headers = {}
    if token:
        headers["Authorization"] = f"token {token}"

    r = requests.get(
        f"{agent_url}/analyze",
        params={"query": prompt, "dialect": "none"},
        headers=headers,
        timeout=90,
        verify=False
    )

    if not r.ok:
        raise Exception(f"AI call failed: {r.status_code} {r.text[:200]}")

    # The agent returns fixed_query field — we're hijacking it to return JSON
    # Use the chat agent instead for freeform response
    raise NotImplementedError("Use chat agent endpoint for documentation — see note below")

# ── Save markdown doc ──────────────────────────────────────────────────────────
def save_markdown_doc(original_file: str, short_name: str, ai_doc: dict, query: str, ddl_map: dict) -> str:
    base = os.path.splitext(original_file)[0]  # e.g. "a" from "a.sql"
    doc_filename = f"{base}_{short_name}.md"
    filepath = os.path.join(DOCS_FOLDER, doc_filename)

    ddl_section = "\n\n".join([f"### {tbl}\n```sql\n{ddl}\n```" for tbl, ddl in ddl_map.items()])

    content = f"""# {short_name.replace('_', ' ').title()}

**Original file:** `{original_file}`  
**Generated:** {datetime.now().strftime('%Y-%m-%d %H:%M')}  
**Dialect:** {ai_doc.get('dialect', 'Redshift')}  

---

## Purpose
{ai_doc.get('purpose', '')}

## Tables Used
{chr(10).join(f'- `{t}`' for t in ai_doc.get('tables_used', []))}

## Key Columns
{chr(10).join(f'- `{c}`' for c in ai_doc.get('key_columns', []))}

## How to Interpret Results
{ai_doc.get('interpretation', '')}

## Potential Issues
{ai_doc.get('potential_issues', '')}

---

## Original Query
```sql
{query}
```

## Schema Snapshot
{ddl_section}
"""

    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(content)

    return doc_filename


# ── Request model ─────────────────────────────────────────────────────────────
class ProcessRequest(BaseModel):
    filename: str
    query: str
    dialect: str = "redshift"
    chat_agent_url: str   # e.g. https://aistudio.wdc.com/.../proxy/PORT/agent
    token: str = ""

# ── POST /sql/process — main endpoint ─────────────────────────────────────────
@router.post("/process")
async def process_sql(request: ProcessRequest):
    query_hash = hash_query(request.query)

    # Check cache first
    existing = get_existing_knowledge(query_hash)
    if existing:
        doc_path = os.path.join(DOCS_FOLDER, existing["doc_filename"])
        doc_content = ""
        if os.path.exists(doc_path):
            with open(doc_path, 'r', encoding='utf-8') as f:
                doc_content = f.read()
        return {
            "status": "cached",
            "short_name":      existing["short_name"],
            "doc_filename":    existing["doc_filename"],
            "tables_involved": existing["tables_involved"],
            "doc_content":     doc_content,
        }

    # Extract tables
    tables = extract_tables(request.query)
    if not tables:
        raise HTTPException(status_code=400, detail="No tables found in query")

    # Fetch DDL from Redshift + create local tables
    from db.redshift import fetch_table_columns
    from db.local_postgres import create_local_table

    ddl_map = {}
    for full_name in tables:
        try:
            schema, table = full_name.split(".", 1) if "." in full_name else ("public", full_name)
            cols = fetch_table_columns(full_name)
            ddl = create_local_table(schema, table, cols)
            ddl_map[full_name] = ddl
        except Exception as e:
            ddl_map[full_name] = f"-- Could not fetch DDL: {e}"

    # Call chat agent for freeform documentation
    ddl_context = "\n\n".join([f"-- {tbl}\n{ddl}" for tbl, ddl in ddl_map.items()])

    doc_prompt = f"""You are a senior data engineer. Analyze this SQL query and produce structured documentation.

SQL Dialect: {request.dialect}

Table DDL:
{ddl_context}

Query:
```sql
{request.query}
```

Respond ONLY with a JSON object, no markdown fences, no explanation, just raw JSON:
{{
  "short_name": "3-5 word snake_case name (e.g. hga_lot_weekly_defect_summary)",
  "purpose": "1-2 sentences on what business question this answers",
  "tables_used": ["table1", "table2"],
  "key_columns": ["col1", "col2"],
  "interpretation": "How to read the result set",
  "potential_issues": "Any SQL concerns or performance notes"
}}"""

    headers = {}
    if request.token:
        headers["Authorization"] = f"token {request.token}"

    # Use chat agent (freeform) not sql-agent (structured output)
    chat_url = request.chat_agent_url
    try:
        r = requests.get(
            f"{chat_url}/analyze" if "/sql-agent" in chat_url else chat_url.rstrip("/") + "/../agent/invoke",
            timeout=90,
            verify=False
        )
    except Exception:
        pass

    # Simpler — just POST to chat agent invoke directly
    try:
        r = requests.post(
            f"{request.chat_agent_url.rstrip('/')}/invoke",
            json={"input": {"messages": [{"type": "human", "content": doc_prompt}]}},
            headers=headers,
            timeout=90,
            verify=False
        )
        if not r.ok:
            raise Exception(f"{r.status_code}: {r.text[:200]}")

        ai_text = r.json()["output"]["messages"][-1]["content"]

        import json as json_mod
        # Strip markdown fences if model added them anyway
        clean = ai_text.strip()
        if clean.startswith("```"):
            clean = re.sub(r"```[a-z]*\n?", "", clean).strip().rstrip("`").strip()

        ai_doc = json_mod.loads(clean)

    except Exception as e:
        # Fallback doc if AI call fails
        ai_doc = {
            "short_name":       "sql_query",
            "purpose":          "Could not generate AI documentation.",
            "tables_used":      tables,
            "key_columns":      [],
            "interpretation":   "",
            "potential_issues": str(e),
        }

    short_name = ai_doc.get("short_name", "sql_query")
    ai_doc["dialect"] = request.dialect

    # Save markdown
    doc_filename = save_markdown_doc(
        request.filename, short_name, ai_doc, request.query, ddl_map
    )

    # Save to DB
    save_knowledge_record(
        query_hash, request.filename, short_name, doc_filename, tables
    )

    return {
        "status":          "processed",
        "short_name":      short_name,
        "doc_filename":    doc_filename,
        "tables_involved": tables,
        "ddl_map":         {k: v for k, v in ddl_map.items()},
        "ai_doc":          ai_doc,
    }


# ── GET /sql/knowledge — list all processed queries ───────────────────────────
@router.get("/knowledge")
def list_knowledge():
    conn = get_local_conn()
    cur = conn.cursor()
    cur.execute("""
        SELECT original_file, short_name, doc_filename, tables_involved, processed_at
        FROM public.sql_knowledge
        ORDER BY processed_at DESC
    """)
    rows = cur.fetchall()
    conn.close()
    return {"items": [
        {
            "original_file":   r[0],
            "short_name":      r[1],
            "doc_filename":    r[2],
            "tables_involved": r[3],
            "processed_at":    r[4].isoformat() if r[4] else None,
        }
        for r in rows
    ]}


# ── GET /sql/knowledge/doc — read a doc file ──────────────────────────────────
@router.get("/knowledge/doc")
def read_doc(filename: str):
    if ".." in filename or "/" in filename or "\\" in filename:
        raise HTTPException(status_code=400, detail="Invalid filename")
    path = os.path.join(DOCS_FOLDER, filename)
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="Doc not found")
    with open(path, 'r', encoding='utf-8') as f:
        return {"content": f.read()}