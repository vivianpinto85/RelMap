from fastapi import APIRouter
from pydantic import BaseModel
import psycopg2

router = APIRouter()

def get_conn():
    return psycopg2.connect(
        dbname="heads01", user="1", password="1", host="localhost", port="5432"
    )

def ensure_relations_table():
    conn = get_conn()
    cur  = conn.cursor()
    cur.execute("""
        CREATE TABLE IF NOT EXISTS relmap_relations (
            id            SERIAL PRIMARY KEY,
            source_table  TEXT NOT NULL,
            source_column TEXT NOT NULL,
            target_table  TEXT NOT NULL,
            target_column TEXT NOT NULL,
            created_at    TIMESTAMP DEFAULT NOW(),
            UNIQUE (source_table, source_column, target_table, target_column)
        )
    """)
    conn.commit()
    conn.close()

def migrate_lowercase():
    conn = get_conn()
    cur  = conn.cursor()
    try:
        cur.execute("""
            UPDATE relmap_relations
            SET source_table  = LOWER(source_table),
                source_column = LOWER(source_column),
                target_table  = LOWER(target_table),
                target_column = LOWER(target_column)
            WHERE source_table  != LOWER(source_table)
               OR target_table  != LOWER(target_table)
               OR source_column != LOWER(source_column)
               OR target_column != LOWER(target_column)
        """)
        conn.commit()
    except Exception:
        conn.rollback()
    finally:
        conn.close()

def normalize(table: str) -> str:
    if "." in table:
        schema, tbl = table.split(".", 1)
        return f"{schema.lower()}.{tbl.lower()}"
    return table.lower()

ensure_relations_table()
migrate_lowercase()


class RelationPayload(BaseModel):
    source_table:  str
    source_column: str
    target_table:  str
    target_column: str

class DeletePayload(BaseModel):
    source_table:  str
    source_column: str
    target_table:  str
    target_column: str


@router.post("/save")
def save_relation(payload: RelationPayload):
    conn = get_conn()
    cur  = conn.cursor()
    # Ensure table exists (in case startup creation failed)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS relmap_relations (
            id            SERIAL PRIMARY KEY,
            source_table  TEXT NOT NULL,
            source_column TEXT NOT NULL,
            target_table  TEXT NOT NULL,
            target_column TEXT NOT NULL,
            created_at    TIMESTAMP DEFAULT NOW(),
            UNIQUE (source_table, source_column, target_table, target_column)
        )
    """)
    cur.execute("""
        INSERT INTO relmap_relations (source_table, source_column, target_table, target_column)
        VALUES (%s, %s, %s, %s)
        ON CONFLICT (source_table, source_column, target_table, target_column) DO NOTHING
    """, (normalize(payload.source_table), payload.source_column.lower(),
          normalize(payload.target_table), payload.target_column.lower()))
    conn.commit()
    conn.close()
    return {"status": "ok"}


@router.post("/delete")
def delete_relation(payload: DeletePayload):
    conn = get_conn()
    cur  = conn.cursor()
    cur.execute("""
        DELETE FROM relmap_relations
        WHERE source_table  = %s AND source_column = %s
          AND target_table  = %s AND target_column = %s
    """, (normalize(payload.source_table), payload.source_column.lower(),
          normalize(payload.target_table), payload.target_column.lower()))
    conn.commit()
    conn.close()
    return {"status": "ok"}


@router.get("/list")
def list_relations():
    conn = get_conn()
    cur  = conn.cursor()
    cur.execute("""
        SELECT source_table, source_column, target_table, target_column
        FROM relmap_relations ORDER BY created_at
    """)
    rows = cur.fetchall()
    conn.close()
    return {"relations": [
        {"source_table": r[0], "source_column": r[1],
         "target_table": r[2], "target_column": r[3]}
        for r in rows
    ]}