from fastapi import APIRouter
from pydantic import BaseModel
from typing import List
import psycopg2

router = APIRouter()

# ── Local Postgres connection ────────────────────────────────────────────────
def get_local_conn():
    return psycopg2.connect(
        dbname="heads01", user="1", password="1", host="localhost", port="5432"
    )

# ── /scan — returns table nodes + edges for the graph UI ────────────────────
@router.get("/scan")
def scan_schema():
    conn = get_local_conn()
    cur = conn.cursor()

    cur.execute("""
        SELECT table_schema, table_name
        FROM information_schema.tables
        WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
        ORDER BY table_schema, table_name
    """)
    tables = cur.fetchall()

    nodes = []

    for schema, table in tables:
        table_id = f"{schema.lower()}.{table.lower()}"  # always lowercase to match relation.py

        cur.execute("""
            SELECT column_name, data_type
            FROM information_schema.columns
            WHERE table_schema = %s AND table_name = %s
            ORDER BY ordinal_position
        """, (schema, table))
        cols = cur.fetchall()

        nodes.append({
            "id":      table_id,
            "label":   f"{schema}.{table}",
            "schema":  schema,
            "table":   table,
            "columns": [{"name": c[0], "type": c[1]} for c in cols],
            "isTable": True
        })

    # Load saved relations as edges
    edges = []
    try:
        cur.execute(
            "SELECT source_table, source_column, target_table, target_column FROM relmap_relations"
        )
        for r in cur.fetchall():
            edges.append({
                "id":            f"{r[0]}__{r[1]}__{r[2]}__{r[3]}",
                "source":        r[0],
                "target":        r[2],
                "source_column": r[1],
                "target_column": r[3],
                "label":         f"{r[1]} -> {r[3]}"
            })
    except Exception:
        pass

    conn.close()
    return {"nodes": nodes, "edges": edges}


# ── /fetch-ddl — reads from Redshift, creates local Postgres tables ──────────
class TableList(BaseModel):
    tables: List[str]

@router.post("/fetch-ddl")
def fetch_ddl(request: TableList):
    from db.redshift import fetch_table_columns
    from db.local_postgres import create_local_table

    ddl_map = {}
    for full_name in request.tables:
        schema, table = full_name.split(".", 1) if "." in full_name else ("public", full_name)
        cols = fetch_table_columns(full_name)
        ddl = create_local_table(schema, table, cols)
        ddl_map[full_name] = ddl

    return {"status": "ok", "ddls": ddl_map}