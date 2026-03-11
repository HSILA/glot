# Database Migrations (Alembic)

## Current strategy

- Alembic is the source of truth for schema changes.
- Runtime schema mutation in application startup is deprecated/removed.
- Backend startup runs migrations first, then starts the API.

## Daily workflow

```bash
cd backend

# 1) change SQLModel models
# 2) generate revision
uv run alembic revision --autogenerate -m "describe change"

# 3) review migration file under alembic/versions/

# 4) apply migration
uv run alembic upgrade head
```

## Existing environments without Alembic history

The startup script detects this case:
- if app tables exist but `alembic_version` does not,
- it runs compatibility checks (required tables/columns and key card sequence uniqueness),
- only if compatible, it stamps baseline revision `0001_baseline`,
- then runs `alembic upgrade head`.

If compatibility checks fail, startup exits and requires manual migration intervention.
This avoids falsely marking partial/legacy schemas as fully migrated.

## Failure behavior

If `alembic upgrade head` fails, backend startup fails intentionally.
Do not run API on a partially migrated schema.
