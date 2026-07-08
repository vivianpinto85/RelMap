# backend/main.py
from fastapi import FastAPI, HTTPException
from routes import schema, relation, sql_agent  # Changed from 'agent' to 'sql_agent'
import os

app = FastAPI()

app.include_router(schema.router)
app.include_router(relation.router, prefix="/relation")
app.include_router(sql_agent.router, prefix="/agent")  # Changed from 'agent' to 'sql_agent'

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
    """Handle AI suggestions for SQL files"""
    filename = request.get("filename", "")
    url = request.get("url", "")
    token = request.get("token", "")
    dialect = request.get("dialect", "redshift")
    
    # You can call your sql_agent here if needed
    # For now, return a placeholder
    return {
        "fixed_query": "-- AI suggestion will go here\nSELECT * FROM table;",
        "saved_as": f"fixed_{filename}",
        "has_issues": False,
        "issues": [],
        "explanation": "AI analysis complete."
    }