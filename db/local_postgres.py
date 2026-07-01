import psycopg2

def get_postgres_connection():
    return psycopg2.connect(
        dbname="heads01",       # same name as Redshift DB
        user="1",        # your local postgres user
        password="1",
        host="localhost",       # or container hostname
        port="5432"
    )
def table_exists(schema: str, table: str):
    conn = get_postgres_connection()
    cur = conn.cursor()
    cur.execute("""
        SELECT EXISTS (
            SELECT 1
            FROM information_schema.tables
            WHERE table_schema = %s AND table_name = %s
        )
    """, (schema, table))
    exists = cur.fetchone()[0]
    conn.close()
    return exists
def create_local_table(schema: str, table_name: str, columns):
    if table_exists(schema, table_name):
        return f"-- Table {schema}.{table_name} already exists, skipped."

    if not columns:
        return f"-- No columns found for {schema}.{table_name}"

    conn = get_postgres_connection()
    cur = conn.cursor()
    ddl = f'CREATE SCHEMA IF NOT EXISTS "{schema}";\n'
    ddl += f'CREATE TABLE "{schema}"."{table_name}" ('
    ddl += ", ".join([f'"{c[0]}" {c[1]}' for c in columns])
    ddl += ");"
    cur.execute(ddl)
    conn.commit()
    conn.close()
    return ddl