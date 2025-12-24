# Glot Backend

FastAPI backend with FSRS spaced repetition scheduling.

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
├── models/        # SQLModel tables
├── schemas/       # Request/response validation
├── services/      # FSRS scheduling logic
├── core/          # Configuration
└── db/            # Database connection
```

## Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/v1/cards/due` | Cards ready for review |
| `POST /api/v1/cards/{id}/review` | Submit rating (1-4) |
| `GET /api/v1/cards/{id}/preview` | Preview intervals |
| Full CRUD | `/cards`, `/decks`, `/settings` |

## FSRS Rating

| 1 | 2 | 3 | 4 |
|---|---|---|---|
| Again | Hard | Good | Easy |

## Settings

| Setting | Default |
|---------|---------|
| `desired_retention` | 0.9 |
| `maximum_interval_days` | 365 |
| `enable_fuzz` | true |

## Docs

- `docs/database-setup.md` - PostgreSQL + cloud providers
- `docs/fsrs-service.md` - FSRS algorithm
- `docs/api-testing.md` - cURL examples
