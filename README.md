# Glot

A personal spaced-repetition PWA using the FSRS algorithm.

## Tech Stack

**Backend:**
- FastAPI + SQLModel
- PostgreSQL with JSONB
- FSRS (fsrs-rs-python) for scheduling
- Loguru for logging

**Frontend:**
- Next.js + TypeScript
- Tailwind CSS
- Progressive Web App (PWA)

## Quick Start

### Option 1: Docker (Recommended)

The easiest way to run everything:

```bash
# Build and start all services
just build
just up

# Check status
just status
```

**Access:**
- App: http://localhost:3000
- API: http://localhost:8000
- API Docs: http://localhost:8000/docs
- Database UI (Adminer): http://localhost:8080

### Option 2: Hybrid (Docker DB + Local Code)

Run the database in Docker, but backend/frontend locally:

```bash
# Start database services only
just db-up

# Initialize database (first time only)
just db-init

# Run backend (terminal 1)
just dev-backend

# Run frontend (terminal 2)
just dev-frontend
```

### Option 3: Cloud Services

You can replace local services with cloud providers:

| Service | Cloud Alternative | Setup |
|---------|-------------------|-------|
| PostgreSQL | [Supabase](https://supabase.com), [Neon](https://neon.tech) | Set `DATABASE_URL` in `.env` |
| Redis | [Upstash](https://upstash.com) | Set `REDIS_URL` in `.env` |

To use cloud services, comment out the corresponding service in `docker-compose.yml`:

```yaml
# Comment out if using cloud provider:
# postgres:
#   ...
# redis:
#   ...
```

## Common Commands (justfile)

| Command | Description |
|---------|-------------|
| `just` | List all commands |
| `just build` | Build all Docker images |
| `just up` | Start all services |
| `just down` | Stop all services |
| `just status` | Show container status |
| `just logs` | View all logs |
| `just logs-svc backend` | View logs for specific service |
| `just db-up` | Start database services only |
| `just db-init` | Create the database |
| `just db-shell` | Open PostgreSQL shell |
| `just clean` | Remove volumes and images |

## Environment Setup

1. Copy the example environment file:
   ```bash
   cp backend/.env.example backend/.env
   ```

2. Fill in the required environment variables in `backend/.env` (database, Redis, R2, JWT secret, etc.)

## Project Structure

```
glot/
├── docker-compose.yml      # All services configuration
├── justfile                # Common commands
├── backend/
│   ├── Dockerfile          # Backend container
│   ├── app/
│   │   ├── api/           # API endpoints
│   │   ├── models/        # Database models
│   │   ├── services/      # FSRS scheduling
│   │   └── ...
│   └── README.md
└── frontend/
    ├── Dockerfile          # Frontend container
    ├── src/
    │   ├── app/           # App Router pages
    │   ├── components/    # UI components
    │   └── lib/           # Utilities
    └── public/            # Static assets
```

## Optional Services

The following services can be disabled if not needed:

- **adminer** — Database UI. Comment out if you don't need it.
- **redis** — Required for PDF extraction worker. Use Upstash or comment out.
- **worker** — Background PDF extraction. Comment out if not using this feature.

## Development

### Backend Testing

Use Bruno API client or curl:
```bash
# See backend/docs/api-testing.md
```

### Database Access

Adminer UI: http://localhost:8080
- Server: postgres
- Username: postgres
- Password: postgres
- Database: glot

Or use `just db-shell` for PostgreSQL CLI.

## Features

- ✅ FSRS scheduling algorithm
- ✅ Polymorphic card types (vocab, phrase, generic)
- ✅ Review logging for optimizer training
- ✅ Deck organization
- ✅ Configurable FSRS parameters
- ✅ Frontend (Next.js PWA)
- ✅ Docker containerization
- 🚧 FSRS optimizer
- 🚧 Anki export

## Git Hooks (Commit Message Policy)

This repo enforces a commit message format:

- First line: `<type>: <title>` where type is one of `fix|feature|chore|style|refactor|docs|test|perf|build|ci|revert`
- Second line: empty
- Then one bullet per change, each starting with `- `

To enable local enforcement, run:

```bash
./scripts/setup-githooks.sh
```
