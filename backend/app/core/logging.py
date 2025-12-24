"""
Logging configuration using loguru.
"""
import sys
import os

from loguru import logger

from app.core import get_settings

settings = get_settings()


def configure_logging():
    """Configure loguru logger for the application."""
    # Remove default handler
    logger.remove()

    # Console handler with file path, line number, and colors
    logger.add(
        sys.stdout,
        colorize=True,
        format="<green>{time:HH:mm:ss}</green> | <level>{level}</level> | <cyan>{file}:{line}</cyan> - <level>{message}</level>",
        level="DEBUG" if settings.debug else "INFO",
    )

    # File handler for errors
    logger.add(
        "logs/error.log",
        rotation="10 MB",
        retention="1 week",
        level="ERROR",
        format="{time:YYYY-MM-DD HH:mm:ss} | {level} | {file}:{line} - {message}",
        backtrace=True,
        diagnose=True,
    )

    # File handler for all logs (debug mode only)
    if settings.debug:
        logger.add(
            "logs/debug.log",
            rotation="50 MB",
            retention="3 days",
            level="DEBUG",
            format="{time:YYYY-MM-DD HH:mm:ss} | {level} | {file}:{line} - {message}",
        )

    logger.info("Logging configured")
    return logger


# Create logs directory
os.makedirs("logs", exist_ok=True)
