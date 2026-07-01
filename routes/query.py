from fastapi import APIRouter
from typing import List

router = APIRouter()

@router.post("/generate")
def generate_query(columns: List[str]):
    # Placeholder for SQL generation
    return {"status": "ok", "sql": f"SELECT {', '.join(columns)} FROM ..."}
