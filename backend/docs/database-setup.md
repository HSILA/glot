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

Created automatically on app startup via SQLModel.

| Table | Purpose |
|-------|---------|
| `cards` | Flashcards with FSRS scheduling |
| `review_logs` | Review history for optimizer |
| `decks` | Card organization |
| `app_settings` | Global FSRS config |

## Migrations

- Currently: Auto-creation (dev only) 
- Future: Alembic (not yet configured)
