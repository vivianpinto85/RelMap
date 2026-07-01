import psycopg2

def get_redshift_connection():
    return psycopg2.connect(
        dbname="heads01",
        user="svc-scoutapp-ro",
        password="sd38Gh4TeW",  # replace with your password
        host="abo-edmprod01.cq3dszk4zmku.us-west-2.redshift.amazonaws.com",
        port="5439"
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
