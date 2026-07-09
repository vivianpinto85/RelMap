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

    saved_as = f"fixed_{filename}"

    # Placeholder fixed query
    fixed_query = "-- AI suggestion will go here\nSELECT * FROM table;"

    # Save fixed file to disk
    try:
        with open(os.path.join("sql", saved_as), 'w', encoding='utf-8') as f:
            f.write(fixed_query)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Could not save file: {e}")

    return {
        "fixed_query": fixed_query,
        "saved_as": saved_as,
        "has_issues": False,
        "issues": [],
        "explanation": "AI analysis complete."
    }

@app.post("/sql/save")
async def save_sql_file(request: dict):
    filename = request.get("filename", "")
    content = request.get("content", "")
    if ".." in filename or "/" in filename or "\\" in filename:
        raise HTTPException(status_code=400, detail="Invalid filename")
    try:
        with open(os.path.join("sql", filename), 'w', encoding='utf-8') as f:
            f.write(content)
        return {"saved_as": filename}
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