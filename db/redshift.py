import os
import psycopg2
from dotenv import load_dotenv

load_dotenv()

def get_redshift_connection():
    return psycopg2.connect(
        dbname=os.environ["REDSHIFT_HEADS_DB"],
        user=os.environ["REDSHIFT_HEADS_USER"],
        password=os.environ["scout-ro-password"],
        host=os.environ["REDSHIFT_HEADS_HOST"],
        port=os.environ["REDSHIFT_HEADS_PORT"],
        connect_timeout=int(os.environ["REDSHIFT_HEADS_TIMEOUT_SECONDS"]),
    )

def fetch_table_columns(full_name: str):
    if "." in full_name:
        schema, table = full_name.split(".", 1)
    else:
        schema, table = "public", full_name

    # Normalize to lowercase for Redshift
    schema = schema.lower()
    table = table.lower()

    conn = get_redshift_connection()
    cur = conn.cursor()
    cur.execute("""
        SELECT column_name, data_type
        FROM SVV_COLUMNS
        WHERE table_schema = %s AND table_name = %s
    """, (schema, table))
    cols = cur.fetchall()
    conn.close()
    return cols

def fetch_schema_tree():
    conn = get_redshift_connection()
    cur = conn.cursor()
    cur.execute("""
        SELECT table_schema, table_name
        FROM SVV_TABLES
        WHERE table_type = 'TABLE'
          AND table_schema NOT IN ('pg_catalog', 'pg_internal', 'information_schema')
        ORDER BY table_schema, table_name
    """)
    rows = cur.fetchall()
    conn.close()

    tree = {}
    for schema, table in rows:
        tree.setdefault(schema, []).append(table)
    return tree