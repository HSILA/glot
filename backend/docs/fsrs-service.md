# FSRS Service

## Overview

Location: `app/services/fsrs_service.py`

The FSRS (Free Spaced Repetition Scheduler) calculates optimal review intervals using ML. ~20-30% more efficient than SM-2.

## Memory Model (DSR)

| Component | Meaning |
|-----------|---------|
| **Difficulty** (D) | How hard this card is (1-10) |
| **Stability** (S) | Days until recall probability drops to 90% |
| **Retrievability** (R) | Current recall probability (0-100%) |

## Rating Scale (Fixed)

| Rating | Button | Effect |
|--------|--------|--------|
| 1 | Again | Failed recall → stability resets |
| 2 | Hard | Difficult recall → small increase |
| 3 | Good | Normal recall → standard increase |
| 4 | Easy | Effortless recall → large increase |

## Configuration

Settings stored in `app_settings` table:

| Setting | Default | Description |
|---------|---------|-------------|
| `desired_retention` | 0.9 | Target recall probability (0.7-0.97) |
| `maximum_interval_days` | 365 | Max days between reviews |
| `enable_fuzz` | True | Add randomness to intervals |
| `weights` | None | 21 FSRS parameters (null = defaults) |

Update via API:
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

**Why?** Future optimizer training to personalize FSRS weights.

## Workflow Example

1. `GET /cards/due` → Get cards ready for review
2. `GET /cards/{id}/preview` → See predicted intervals
3. `POST /cards/{id}/review` → Submit rating
4. Card automatically rescheduled based on FSRS

## Future: Optimizer

Not yet implemented. Will analyze `review_logs` to compute optimal weights for your memory patterns (needs ~400-1000 reviews).
