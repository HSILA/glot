# API Testing

## Server

```bash
docker compose up -d
uv run uvicorn app.main:app --reload
```

- API: http://localhost:8000
- Swagger: http://localhost:8000/docs

## Bruno Collection

Import `bruno-collections/glot-api` folder in Bruno.

## cURL Examples

### Cards

```bash
# Create
curl -X POST http://localhost:8000/api/v1/cards \
  -H "Content-Type: application/json" \
  -d '{"front_content": "Bonjour", "back_content": "Hello"}'

# List
curl http://localhost:8000/api/v1/cards

# Due cards
curl http://localhost:8000/api/v1/cards/due

# Preview intervals
curl http://localhost:8000/api/v1/cards/1/preview

# Review (rating 1-4: Again/Hard/Good/Easy)
curl -X POST http://localhost:8000/api/v1/cards/1/review \
  -H "Content-Type: application/json" \
  -d '{"rating": 3}'
```

### Decks

```bash
# Create
curl -X POST http://localhost:8000/api/v1/decks \
  -H "Content-Type: application/json" \
  -d '{"name": "French"}'

# List
curl http://localhost:8000/api/v1/decks
```

### Settings

```bash
# Get
curl http://localhost:8000/api/v1/settings

# Update
curl -X PUT http://localhost:8000/api/v1/settings \
  -H "Content-Type: application/json" \
  -d '{"desired_retention": 0.85}'
```
