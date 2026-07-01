# backend/main.py
from fastapi import FastAPI
from routes import schema   # import your schema router

app = FastAPI()

# Mount the schema router
app.include_router(schema.router)

# Optional: serve frontend files
from fastapi.staticfiles import StaticFiles
app.mount("/frontend", StaticFiles(directory="frontend"), name="frontend")
