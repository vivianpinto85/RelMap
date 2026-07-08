import os
import requests
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional

router = APIRouter()

SQL_DIR = "SQL"  # relative to wherever uvicorn is launched from (D:\sources\RelMapBe\SQL)


def safe_join(filename: str) -> str:
    """Prevent path traversal — only allow a bare filename, no directory components."""
    if "/" in filename or "\\" in filename or ".." in filename:
        raise HTTPException(status_code=400, detail="Invalid filename")
    return os.path.join(SQL_DIR, filename)


@router.get("/list")
def list_sql_files():
    if not os.path.isdir(SQL_DIR):
        return {"files": []}
    files = sorted(f for f in os.listdir(SQL_DIR) if f.lower().endswith(".sql"))
    return {"files": files}


@router.get("/read")
def read_sql_file(filename: str):
    path = safe_join(filename)
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="File not found")
    with open(path, "r", encoding="utf-8") as f:
        return {"filename": filename, "content": f.read()}


class AskAIPayload(BaseModel):
    filename: str
    url: str          # full URL to the sql-agent's /sql-agent/invoke endpoint
    token: str
    schema_text: Optional[str] = None
    error_text: Optional[str] = None
    sample_result: Optional[str] = None
    dialect: Optional[str] = "redshift"


def call_sql_agent(url: str, token: str, query: str, schema=None, error=None,
                    sample_result=None, dialect=None) -> dict:
    """Calls the dedicated structured-output sql-agent and returns the SQLFix fields."""
    body = {
        "input": {
            "query": query,
            "schema": schema,
            "error": error,
            "sample_result": sample_result,
            "dialect": dialect,
        }
    }
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"token {token}",
    }
    try:
        resp = requests.post(url, headers=headers, json=body, timeout=120)
    except requests.exceptions.SSLError:
        import urllib3
        urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
        try:
            resp = requests.post(url, headers=headers, json=body, timeout=120, verify=False)
        except requests.exceptions.RequestException as e:
            raise HTTPException(status_code=502, detail=f"Could not reach sql-agent (even without SSL verify): {e}")
    except requests.exceptions.RequestException as e:
        raise HTTPException(status_code=502, detail=f"Could not reach sql-agent: {e}")

    if not resp.ok:
        raise HTTPException(status_code=resp.status_code, detail=resp.text[:500])

    data = resp.json()
    # LangGraph state is returned under "output"; the SQLFix fields live under output["result"]
    result = (data.get("output") or {}).get("result")
    if not result:
        raise HTTPException(status_code=502, detail=f"Unexpected response shape: {resp.text[:500]}")
    return result


def next_available_name(base: str, ext: str) -> str:
    """a.sql -> a1.sql; if a1.sql already exists, tries a2.sql, a3.sql, ..."""
    n = 1
    while True:
        candidate = f"{base}{n}{ext}"
        if not os.path.isfile(os.path.join(SQL_DIR, candidate)):
            return candidate
        n += 1


@router.post("/ask-ai")
def ask_ai_for_sql(payload: AskAIPayload):
    path = safe_join(payload.filename)
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="File not found")

    with open(path, "r", encoding="utf-8") as f:
        original_sql = f.read()

    result = call_sql_agent(
        payload.url,
        payload.token,
        query=original_sql,
        schema=payload.schema_text,
        error=payload.error_text,
        sample_result=payload.sample_result,
        dialect=payload.dialect,
    )

    fixed_query = result.get("fixed_query", "")

    base, ext = os.path.splitext(payload.filename)
    new_filename = next_available_name(base, ext or ".sql")
    new_path = os.path.join(SQL_DIR, new_filename)

    with open(new_path, "w", encoding="utf-8") as f:
        f.write(fixed_query)

    return {
        "original_filename": payload.filename,
        "saved_as": new_filename,
        "original_sql": original_sql,
        "has_issues": result.get("has_issues"),
        "issues": result.get("issues", []),
        "fixed_query": fixed_query,
        "explanation": result.get("explanation", ""),
    }