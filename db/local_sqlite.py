import sqlite3

def get_sqlite_connection():
    return sqlite3.connect("heads01.db")

def normalize_name(name: str) -> str:
    return name.replace(".", "_")

def create_local_table(table_name: str, columns):
    conn = get_sqlite_connection()
    cur = conn.cursor()

    safe_name = normalize_name(table_name)

    if not columns:
        # Avoid empty CREATE TABLE
        return f"-- No columns found for {table_name}"

    ddl = f"CREATE TABLE IF NOT EXISTS {safe_name} ("
    ddl += ", ".join([f"{c[0]} {c[1]}" for c in columns])
    ddl += ");"

    cur.execute(ddl)
    conn.commit()
    conn.close()
    return ddl
