"""
API v1 routes.
"""
from fastapi import APIRouter

from .cards import router as cards_router
from .decks import router as decks_router
from .settings import router as settings_router

router = APIRouter(prefix="/v1")

router.include_router(cards_router, prefix="/cards", tags=["Cards"])
router.include_router(decks_router, prefix="/decks", tags=["Decks"])
router.include_router(settings_router, prefix="/settings", tags=["Settings"])
