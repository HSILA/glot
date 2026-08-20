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

If you use Neon pooled endpoints (`...-pooler...`), the backend auto-detects this and switches to `NullPool`.

### Pool tuning knobs (non-pooler/direct DB mode)

For direct database connections, SQLAlchemy pool policy is version-controlled in `config/app.yaml`:

```yaml
database_pool:
  pre_ping: true
  recycle_seconds: 1800
  size: 10
  max_overflow: 20
  timeout_seconds: 30
```

For external poolers (e.g., Supabase pooler URLs, Neon pooler URLs, port `6543`), backend auto-switches to `NullPool`.
You can also force this behavior with:

```env
DATABASE_USE_NULL_POOL=true
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
# Validate policy before applying schema changes
uv run python -m app.core.app_config

# Apply pending migrations
uv run alembic upgrade head

# Create a new migration from model changes
uv run alembic revision --autogenerate -m "describe change"

# Roll back one revision
uv run alembic downgrade -1
```

### Startup behavior

- Docker and `just dev-backend` validate `config/app.yaml` before migrations
- Docker backend startup then runs `alembic upgrade head` before `uvicorn`
- Local `just dev-backend` also runs migrations before API start
- If migration fails, backend startup fails (expected/safe behavior)
