# backend/main.py
from fastapi import FastAPI
from routes import schema, relation, agent

app = FastAPI()

app.include_router(schema.router)                          # /scan, /fetch-ddl, /redshift/tables
app.include_router(relation.router, prefix="/relation")     # /relation/save, /relation/delete, /relation/list
app.include_router(agent.router, prefix="/agent")           # /agent/invoke

from fastapi.staticfiles import StaticFiles
app.mount("/frontend", StaticFiles(directory="frontend"), name="frontend")