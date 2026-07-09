# backend/main.py
from fastapi import FastAPI, HTTPException
from routes import schema, relation, sql_agent
import os

app = FastAPI()

app.include_router(schema.router)
app.include_router(relation.router, prefix="/relation")
app.include_router(sql_agent.router, prefix="/agent")

from fastapi.staticfiles import StaticFiles
app.mount("/frontend", StaticFiles(directory="frontend"), name="frontend")

# --- SQL FILE BROWSING ROUTES ---
@app.get("/sql/list")
async def list_sql_files():
    sql_folder = "sql"
    try:
        if not os.path.exists(sql_folder):
            return {"files": []}
        files = [f for f in os.listdir(sql_folder) if f.endswith('.sql')]
        return {"files": sorted(files)}
    except Exception:
        return {"files": []}

@app.get("/sql/read")
async def read_sql_file(filename: str):
    sql_folder = "sql"
    if ".." in filename or "/" in filename or "\\" in filename:
        raise HTTPException(status_code=400, detail="Invalid filename")
    file_path = os.path.join(sql_folder, filename)
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
        return {"content": content}
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"File '{filename}' not found")




@app.post("/sql/ask-ai")
async def ask_ai(request: dict):
    filename = request.get("filename", "")
    url = request.get("url", "")
    token = request.get("token", "")
    dialect = request.get("dialect", "redshift")

    if not url or not filename:
        raise HTTPException(status_code=400, detail="url and filename required")
    if ".." in filename or "/" in filename or "\\" in filename:
        raise HTTPException(status_code=400, detail="Invalid filename")

    try:
        with open(os.path.join("sql", filename), 'r', encoding='utf-8') as f:
            query = f.read()
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"File '{filename}' not found")

    try:
        headers = {"Authorization": f"token {token}"} if token else {}

        r = requests.get(
            f"{url}/analyze",
            params={"query": query, "dialect": dialect},
            headers=headers,
            timeout=60,
            verify=False
        )

        print(f"Agent status: {r.status_code}", flush=True)
        print(f"Agent body: {r.text[:300]}", flush=True)

        if not r.ok:
            raise HTTPException(status_code=502, detail=f"Agent error {r.status_code}: {r.text[:200]}")

        result = r.json()
        saved_as = f"fixed_{filename}"
        with open(os.path.join("sql", saved_as), 'w', encoding='utf-8') as f:
            f.write(result["fixed_query"])

        return {
            "has_issues": result["has_issues"],
            "issues": result["issues"],
            "fixed_query": result["fixed_query"],
            "saved_as": saved_as,
            "explanation": result["explanation"],
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
# @app.post("/sql/ask-ai")
# async def ask_ai(request: dict):
#     filename = request.get("filename", "")
#     url = request.get("url", "")
#     token = request.get("token", "")
#     dialect = request.get("dialect", "redshift")

#     # Placeholder — real agent call to be solved separately
#     return {
#         "fixed_query": "-- AI suggestion will go here\nSELECT * FROM table;",
#         "saved_as": f"fixed_{filename}",
#         "has_issues": False,
#         "issues": [],
#         "explanation": "AI analysis complete."
#     }