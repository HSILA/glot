# Logging in Glot

## Configuration

Location: `app/core/logging.py`

**Log format:**
```
HH:mm:ss | LEVEL | file.py:LINE - message
```

Example:
```
15:30:45 | INFO | main.py:27 - Database initialized successfully
15:30:52 | INFO | cards.py:141 - Created card 1: Bonjour
```

## Usage

```python
from loguru import logger

logger.info(f"Card {card_id} created")
logger.error(f"Database connection failed: {e}")
```

## Log Files

- `logs/error.log` - Errors only (rotates at 10MB, keeps 1 week)
- `logs/debug.log` - All logs in debug mode (rotates at 50MB, keeps 3 days)

## Current Logging

### Application (`app/main.py`)
- Startup/shutdown events
- Database initialization

### Database (`app/db/__init__.py`)
- Connection info
- Table creation
- Session errors

### API (`app/api/v1/cards.py`)
- Card creation
- Review operations
- Errors (404s, etc.)

## Viewing Logs

```bash
# Terminal
uv run uvicorn app.main:app --reload

# Log files
tail -f logs/error.log
tail -f logs/debug.log
```
