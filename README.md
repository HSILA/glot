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

### Backend

```bash
# Start database
docker compose up -d

# Install dependencies
cd backend
uv sync

# Run server
uv run uvicorn app.main:app --reload
```

**Access:**
- API: http://localhost:8000
- Docs: http://localhost:8000/docs
- Database UI (Adminer): http://localhost:8080

### Frontend

```bash
cd frontend
bun install
bun run dev
```

**Access:**
- App: http://localhost:3000

## Project Structure

```
glot/
├── docker-compose.yml      # PostgreSQL + Adminer
├── backend/                # FastAPI backend
│   ├── app/
│   │   ├── api/           # API endpoints
│   │   ├── models/        # Database models
│   │   ├── services/      # FSRS scheduling
│   │   └── ...
│   ├── docs/              # Backend documentation
│   └── README.md
└── frontend/              # Next.js PWA frontend
    ├── src/
    │   ├── app/           # App Router pages
    │   ├── components/    # UI components
    │   └── lib/           # Utilities
    └── public/            # Static assets
```

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

## Features

- ✅ FSRS scheduling algorithm
- ✅ Polymorphic card types (vocab, phrase, generic)
- ✅ Review logging for optimizer training
- ✅ Deck organization
- ✅ Configurable FSRS parameters
- ✅ Frontend (Next.js PWA)
- 🚧 FSRS optimizer
- 🚧 Anki export