from fastapi import APIRouter
from pydantic import BaseModel
from typing import List
from db.redshift import fetch_table_columns
# from db.local_sqlite import create_local_table
from db.local_postgres import create_local_table  # switch here

router = APIRouter()

class TableList(BaseModel):
    tables: List[str]

@router.post("/fetch-ddl")
def fetch_ddl(request: TableList):
    ddl_map = {}
    for full_name in request.tables:
        if "." in full_name:
            schema, table = full_name.split(".", 1)
        else:
            schema, table = "public", full_name
        cols = fetch_table_columns(full_name)
        ddl = create_local_table(schema, table, cols)
        ddl_map[full_name] = ddl
    return {"status": "ok", "ddls": ddl_map}
