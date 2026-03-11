# Database Setup

## Local Development (Docker)

```bash
docker compose up -d
```

**Connection:** `postgresql+asyncpg://postgres:postgres@localhost:5432/glot`

## Cloud Providers

### Supabase
```env
DATABASE_URL="postgresql+asyncpg://postgres.[ref]:[password]@db.[ref].supabase.co:5432/postgres"
```
Use port **5432** (direct connection), not 6543.

### Neon
```env
DATABASE_URL="postgresql+asyncpg://user:password@ep-xxx.neon.tech:5432/neondb?sslmode=require"
```

Requires this config in `app/db/__init__.py`:
```python
from sqlalchemy.pool import NullPool

async_engine = create_async_engine(
    settings.database_url,
    poolclass=NullPool,
    connect_args={"server_settings": {"statement_cache_size": "0"}},
)
```

### Railway / Render
Standard connection string, no special config needed.

## Tables

Managed via Alembic migrations.

| Table | Purpose |
|-------|---------|
| `cards` | Flashcards with FSRS scheduling |
| `review_logs` | Review history for optimizer |
| `decks` | Card organization |
| `user_settings` | Per-user FSRS config |

## Migrations

Alembic is the canonical schema management tool.

### Common commands

```bash
# Apply pending migrations
uv run alembic upgrade head

# Create a new migration from model changes
uv run alembic revision --autogenerate -m "describe change"

# Roll back one revision
uv run alembic downgrade -1
```

### Startup behavior

- Docker backend startup command runs `alembic upgrade head` before `uvicorn`
- Local `just dev-backend` also runs migrations before API start
- If migration fails, backend startup fails (expected/safe behavior)
