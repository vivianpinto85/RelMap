from fastapi import FastAPI
from routes import schema, validate, relation, query, snapshot
from fastapi.staticfiles import StaticFiles

app = FastAPI(title="RelMap")
app.mount("/frontend", StaticFiles(directory="frontend", html=True), name="frontend")
# Include routers
app.include_router(schema.router, prefix="/schema", tags=["Schema"])
app.include_router(validate.router, prefix="/validate", tags=["Validation"])
app.include_router(relation.router, prefix="/relation", tags=["Relations"])
app.include_router(query.router, prefix="/query", tags=["Query"])
app.include_router(snapshot.router, prefix="/snapshot", tags=["Snapshots"])

@app.get("/")
def root():
    return {"message": "Welcome to RelMap API"}