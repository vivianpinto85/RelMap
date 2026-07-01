from fastapi import APIRouter

router = APIRouter()

@router.post("/check")
def validate_relation(table: str, column: str, value: str):
    # Placeholder for validation logic
    return {"status": "ok", "validated": True, "table": table, "column": column, "value": value}
