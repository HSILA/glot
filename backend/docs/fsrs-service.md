# Scheduling Service

## Overview

Location: `app/services/fsrs_service.py`

The scheduling service calculates optimal review intervals using the FSRS (Free Spaced Repetition Scheduler) algorithm. ~20-30% more efficient than SM-2.

## Memory Model (DSR)

| Component | Meaning |
|-----------|---------|
| **Difficulty** (D) | How hard this card is (1-10) |
| **Stability** (S) | Days until recall probability drops to target |
| **Retrievability** (R) | Current recall probability (0-100%) |

## Rating Scale

| Rating | Button | Effect |
|--------|--------|--------|
| 1 | Again | Failed recall → stability resets |
| 2 | Hard | Difficult recall → small increase |
| 3 | Good | Normal recall → standard increase |
| 4 | Easy | Effortless recall → large increase |

## Configuration

### Global Settings (Environment Variables)

Defined in `app/core/__init__.py`, loaded from environment.

| Setting | Default | Description |
|---------|---------|-------------|
| `maximum_interval_days` | 365 | Max days between reviews |
| `enable_fuzz` | True | Add randomness to intervals |

### Per-User Settings (Database)

Stored in `user_settings` table (one row per user).

| Setting | Default | Description |
|---------|---------|-------------|
| `desired_retention` | 0.9 | Target recall probability (0.7-0.97) |
| `weights` | library defaults | 19 algorithm parameters |

When a user is created, `weights` are initialized with the FSRS library's default parameters. These can later be optimized based on the user's review history.

Update user settings via API:
```bash
PUT /api/v1/settings
{"desired_retention": 0.85}
```

## Key Methods

### `get_next_states(card)`
Returns predicted intervals for all ratings (Again/Hard/Good/Easy)

### `apply_review(card, rating)`
Updates card with new difficulty, stability, and next_review_at

### `get_next_states_response(card)`
Returns next states as API response (used by `/preview` endpoint)

## Review Logging

Every review is logged to `review_logs` table with:
- State before review (stability, difficulty)
- Scheduled vs actual elapsed days
- Rating given

**Why?** Future optimizer training to personalize weights per user.

## Workflow Example

1. `GET /cards/due` → Get cards ready for review
2. `GET /cards/{id}/preview` → See predicted intervals
3. `POST /cards/{id}/review` → Submit rating
4. Card automatically rescheduled

## Future: Optimizer

Not yet implemented. Will analyze `review_logs` to compute optimal weights personalized to each user's memory patterns (needs ~400-1000 reviews).
