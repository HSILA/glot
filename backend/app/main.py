"""
Glot API - Spaced Repetition Learning Backend

A FastAPI application for managing flashcards with FSRS scheduling.

Usage:
    uvicorn app.main:app --reload
"""
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from loguru import logger

from app.api import v1_router
from app.core import get_settings
from app.core.logging import configure_logging
from app.db import close_db, init_db

settings = get_settings()

# Configure logging
configure_logging()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan: startup and shutdown."""
    # Startup
    logger.info("Starting Glot API...")
    logger.info(f"Debug mode: {settings.debug}")
    logger.info("Initializing database...")
    await init_db()
    logger.success("Database initialized successfully")
    logger.info(f"API ready at http://localhost:8000")
    yield
    # Shutdown
    logger.info("Shutting down Glot API...")
    await close_db()
    logger.success("Database connections closed")


app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    description="""
# Glot API

A personal language learning API.

## Features

- **Users**: Multi-user support with per-user settings
- **Cards**: CRUD operations for flashcards
- **Scheduling**: ML-based spaced repetition (FSRS algorithm)
- **Review Logging**: Historical data for future algorithm optimization
- **Decks**: Organize cards into decks (supports nested hierarchies)
- **Settings**: Per-user preferences (desired retention, algorithm weights)

## Configuration

### Global Settings (Environment Variables)
- `maximum_interval_days`: Max days between reviews (default: 365)
- `enable_fuzz`: Add randomness to intervals (default: true)

### Per-User Settings (Database)
- `desired_retention`: Target recall probability (default: 0.9)
- `weights`: Algorithm parameters (default: library defaults)

## Rating Scale

| Rating | Button | Effect |
|--------|--------|--------|
| 1 | Again | Failed recall, stability resets |
| 2 | Hard | Difficult recall, small stability increase |
| 3 | Good | Normal recall, standard stability increase |
| 4 | Easy | Effortless recall, large stability increase |
    """,
    lifespan=lifespan,
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include API routes
app.include_router(v1_router, prefix="/api")


@app.get("/health", tags=["Health"])
async def health_check():
    """Health check endpoint."""
    return {"status": "healthy", "version": settings.app_version}
