from fastapi import APIRouter
from pydantic import BaseModel
from typing import List
from db.redshift import fetch_table_columns
from db.local_sqlite import create_local_table

router = APIRouter()

class TableList(BaseModel):
    tables: List[str]

@router.get("/scan")
def scan_schema():
    return {"status": "ok", "message": "Schema scan placeholder"}

@router.post("/fetch-ddl")
def fetch_ddl(request: TableList):
    ddl_map = {}
    for t in request.tables:
        cols = fetch_table_columns(t)
        ddl = create_local_table(t, cols)
        ddl_map[t] = ddl
    return {"status": "ok", "ddls": ddl_map}
