# backend/main.py
from fastapi import FastAPI, HTTPException
from routes import schema, relation, sql_agent,sql_knowledge  ,sql_debug,sql1
import os,requests  

app = FastAPI()

app.include_router(schema.router)
print(f"[DEBUG] After schema: total routes = {len(app.routes)}", flush=True)

app.include_router(relation.router, prefix="/relation")
print(f"[DEBUG] After relation: total routes = {len(app.routes)}", flush=True)

app.include_router(sql_agent.router, prefix="/agent")
print(f"[DEBUG] After sql_agent: total routes = {len(app.routes)}", flush=True)

app.include_router(sql_knowledge.router, prefix="/sql")
print(f"[DEBUG] After sql_knowledge: total routes = {len(app.routes)}", flush=True)

app.include_router(sql_debug.router, prefix="/debug")
print(f"[DEBUG] After sql_debug: total routes = {len(app.routes)}", flush=True)

app.include_router(sql1.router, prefix="/debug")
print(f"[DEBUG] After sql1: total routes = {len(app.routes)}", flush=True)

@app.on_event("startup")
async def list_routes():
    print("\n[DEBUG] === Registered routes ===", flush=True)
    for route in app.routes:
        methods = list(route.methods) if hasattr(route, "methods") else "N/A"
        path = getattr(route, "path", str(route))
        print(f"  {methods} {path}  ({type(route).__name__})", flush=True)
    print("[DEBUG] === End routes ===\n", flush=True)
    
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
