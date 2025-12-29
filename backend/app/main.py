"""
Glot API - Spaced Repetition Learning Backend

A FastAPI application for managing flashcards with FSRS scheduling.

Usage:
    uvicorn app.main:app --reload
"""

from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from loguru import logger
from slowapi import Limiter
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

from app.api import v1_router
from app.core import get_settings
from app.core.logging import configure_logging
from app.db import close_db, init_db

settings = get_settings()

# Configure logging
configure_logging()

# Rate limiter
limiter = Limiter(key_func=get_remote_address)


def rate_limit_exceeded_handler(request: Request, exc: RateLimitExceeded):
    """Custom handler for rate limit exceeded."""
    return JSONResponse(
        status_code=429,
        content={"detail": f"Rate limit exceeded: {exc.detail}"},
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan: startup and shutdown."""
    # Startup
    logger.info("Starting Glot API...")
    logger.info(f"Debug mode: {settings.debug}")
    logger.info("Initializing database...")
    await init_db()
    logger.success("Database initialized successfully")
    logger.info("API ready at http://localhost:8000")
    yield
    # Shutdown
    logger.info("Shutting down Glot API...")
    await close_db()
    logger.success("Database connections closed")


app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    lifespan=lifespan,
)

# Rate limiting
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, rate_limit_exceeded_handler)

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
