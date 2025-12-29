# Glot Backend

FastAPI backend with spaced repetition scheduling.

## Quick Start

```bash
cd backend
uv sync
docker compose up -d  # from project root
uv run uvicorn app.main:app --reload
```

**API:** http://localhost:8000/docs

## Structure

```
app/
├── api/v1/        # Endpoints (cards, decks, settings)
├── models/        # SQLModel tables (User, UserSettings, Deck, Card, ReviewLog)
├── schemas/       # Request/response validation
├── services/      # Scheduling logic (FSRS algorithm)
├── core/          # Global configuration
└── db/            # Database connection
```

## Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/v1/cards/due` | Cards ready for review |
| `POST /api/v1/cards/{id}/review` | Submit rating (1-4) |
| `GET /api/v1/cards/{id}/preview` | Preview intervals |
| Full CRUD | `/cards`, `/decks`, `/settings` |

## Rating Scale

| 1 | 2 | 3 | 4 |
|---|---|---|---|
| Again | Hard | Good | Easy |

## Configuration

### Global Settings (Environment Variables)

Set in `.env` or environment. Apply to all users.

| Setting | Default | Env Variable |
|---------|---------|--------------|
| `maximum_interval_days` | 365 | `MAXIMUM_INTERVAL_DAYS` |
| `enable_fuzz` | true | `ENABLE_FUZZ` |

### Per-User Settings (Database)

Stored in `user_settings` table. Each user can customize.

| Setting | Default | Description |
|---------|---------|-------------|
| `desired_retention` | 0.9 | Target recall probability (0.7-0.97) |
| `weights` | library defaults | 19 algorithm parameters |

**Note:** `weights` are initialized with library defaults on user registration. They can be optimized later based on user's review history.

## Docs

- `docs/database-setup.md` - PostgreSQL + cloud providers
- `docs/fsrs-service.md` - Scheduling algorithm
- `docs/api-testing.md` - cURL examples
