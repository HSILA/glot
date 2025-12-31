# Resources Feature Specification

## Overview

A resource management system allowing users to upload, store, and process PDF documents. Features include:
- PDF upload to Cloudflare R2 (S3-compatible)
- Text extraction via Vision LLM (smolagents + OpenRouter)
- Public/private resource sharing
- Content-based deduplication

---

## Constraints

| Constraint | Value |
|------------|-------|
| File type | PDF only (validated by extension and MIME type) |
| Max file size | 75 MB |
| Max files per user | 10 |

> **Note:** These constraints should be added to the backend settings/config as hardcoded variables (similar to `ACCESS_TOKEN_EXPIRE_MINUTES`, `REFRESH_TOKEN_EXPIRE_DAYS`).

---

## R2 Storage Structure

Content-addressed storage using SHA-256 hash as identifier:

```
{bucket}/
├── raw/
│   └── {content_hash}.pdf
├── processed/
│   └── {content_hash}/
│       ├── page_001.md
│       ├── page_002.md
│       └── ...
└── thumbnails/
    └── {content_hash}.webp
```

**Key points:**
- No per-user folders; all files stored by content hash
- Deduplication at storage level
- Thumbnails: first page extracted as WebP

---

## Database Schema

### `resources` table (global, deduplicated)

```sql
CREATE TABLE resources (
    id                  SERIAL PRIMARY KEY,
    content_hash        VARCHAR(64) UNIQUE NOT NULL,
    size_bytes          BIGINT NOT NULL,
    page_count          INT,
    is_public           BOOLEAN DEFAULT FALSE,
    extraction_status   VARCHAR(20) DEFAULT 'none', -- none|pending|processing|completed|failed
    uploaded_at         TIMESTAMPTZ DEFAULT now(),
    processed_at        TIMESTAMPTZ,
    uploaded_by         INT REFERENCES users(id)    -- Original uploader
);

CREATE INDEX idx_resources_public ON resources(is_public) WHERE is_public = TRUE;
CREATE INDEX idx_resources_hash ON resources(content_hash);
```

### `user_resources` table (junction table)

```sql
CREATE TABLE user_resources (
    user_id     INT REFERENCES users(id) ON DELETE CASCADE,
    resource_id INT REFERENCES resources(id) ON DELETE CASCADE,
    name        VARCHAR(255) NOT NULL,  -- User's name for this resource
    added_at    TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY (user_id, resource_id)
);

CREATE INDEX idx_user_resources_user ON user_resources(user_id);
```

**Naming behavior:**
- On upload, the `name` field pre-fills with original filename (without extension)
- User can edit before confirming upload
- Extension is always `.pdf` (fixed, not editable)

### Extraction Status Values

| Status | Meaning |
|--------|---------|
| `none` | No extraction requested |
| `pending` | Queued, waiting to start |
| `processing` | Currently being processed |
| `completed` | All pages extracted successfully |
| `failed` | Extraction failed |

---

## Backend Architecture

### Directory Structure

```
backend/app/
├── agents/
│   ├── __init__.py
│   ├── base.py                 # Shared agent utilities
│   └── extraction_agent.py     # PDF → Markdown extraction
├── services/
│   ├── storage_service.py      # R2 operations (upload, download, presigned URLs)
│   └── queue_service.py        # ARQ job management
├── workers/
│   └── extraction_worker.py    # ARQ worker process
└── api/
    └── resources.py            # Resource API endpoints
```

### Extraction Agent (smolagents)

Uses Vision LLM via OpenRouter for accurate text extraction:

```python
from smolagents import CodeAgent, OpenAIServerModel
import os

model = OpenAIServerModel(
    model_id=os.getenv("EXTRACTION_AGENT_MODEL", "qwen/qwen-3-vl-235b-a22b-instruct"),
    api_base="https://openrouter.ai/api/v1",
    api_key=os.getenv("OPENROUTER_API_KEY")
)

agent = CodeAgent(tools=[], model=model)
```

**Dependencies:** `uv add smolagents`

> **Note:** No need for `smolagents[vision]` — we're calling an external API (OpenRouter), not running local vision models.

### Background Processing (Redis + ARQ)

**Package distinction:**
- `redis` (redis-py): Low-level Redis client for get/set/pub-sub
- `arq`: Job queue built on top of redis-py — handles job scheduling, retries, workers, results

Both are needed: `uv add redis arq`

**Queue configuration:**
- **Granularity**: Document-level jobs (1 job = 1 PDF, all pages)
- **Concurrency**: Configurable via `max_jobs` (default: 2 for 2-vCPU server)

**Flow:**
1. User clicks "Extract" (only in My Library)
2. API enqueues job → returns `202 Accepted`
3. ARQ worker picks up job
4. Worker downloads PDF from R2
5. Extracts each page → uploads `.md` files to R2
6. Updates DB: `extraction_status = 'completed'`

### Extraction Progress Tracking

Real-time progress stored in Redis (only visible in My Library):

```python
redis.hset(f"extraction:{resource_id}", mapping={
    "status": "processing",
    "progress": 45,
    "current_page": 12,
    "total_pages": 27
})
```

Frontend polls: `GET /api/resources/{id}/extraction-progress`

---

## Frontend Architecture

### Directory Structure

```
frontend/src/
├── app/
│   └── (dashboard)/
│       └── library/
│           ├── page.tsx              # Main library page
│           ├── my-library/
│           │   └── page.tsx          # User's resources
│           └── public-library/
│               └── page.tsx          # Public resources (with search)
├── components/
│   └── resources/
│       ├── resource-card.tsx         # Resource display card
│       ├── upload-modal.tsx          # Add book modal
│       ├── extraction-button.tsx     # Extract trigger with status
│       └── pdf-viewer.tsx            # PDF viewer modal
└── lib/
    └── api/
        └── resources.ts              # API client functions
```

### Navigation Structure

Sidebar (left panel):
```
Library
├── My Library        ← User's uploaded/added resources
└── Public Library    ← Browse public resources (with search)
```

### Upload Modal (rename it to "Add a Resource")

Modal appearance:
- Opens over dashboard with **blurred background** (glassmorphism)
- Does not fill the entire page — centered, contained width, responsiveness should be taken into account

Modal contents:
1. **Drag-and-drop zone** (or click to browse)
2. **Name field** — pre-filled with filename (without `.pdf`), editable
3. **Extension indicator** — fixed `.pdf` (not editable)
4. **File size display** — show size, error if > 75 MB
5. **Visibility toggle** — Public / Private (default: Private)
6. **Upload button** — disabled until valid PDF selected
7. **Upload progress bar** — shows during upload
8. **Finished** — shows after upload is complete, then the modal closes

### Resource Card

Displays in grid/list view:
- Thumbnail (first page)
- Name
- Page count
- Extraction status indicator:
  - **Not extracted**: Show extraction button (only in My Library)
  - **Processing**: Show progress bar with percentage
  - **Completed**: Show checkmark/success/extracted icon
  - **Failed**: Show error icon with retry option
  - All the icons should have hover tooltip, so when the user hovers over them, they should see a tooltip with the status description

**My Library only:**
- Extraction trigger button
- Delete button, removes the resource from the user's library and the R2 bucket if the user is the owner of the resource
- Visibility toggle, with a small box asking for confirmation, not a big windows or modal, a small box should be enough (use a industry standard design for this)

**Public Library:**
- "Add to My Library" button
- No extraction trigger (must add first)
- The delete button deletes the resource from the user's library,

### PDF Viewer

- Opens in modal/drawer
- Navigate between pages
- Zoom controls

---

## Upload Flow

Uses presigned URLs for direct-to-R2 upload (no credential exposure):

```
┌──────────┐   1. Request upload    ┌─────────┐
│ Frontend │ ─────────────────────► │ Backend │
│          │   (name, size)         │         │
│          │                        │         │
│          │   2. Presigned URL     │         │
│          │ ◄───────────────────── │         │
│          │                        │         │
│          │   3. Direct upload     │         │    ┌────┐
│          │ ───────────────────────┼────────────► │ R2 │
│          │                        │         │    └────┘
│          │   4. Confirm upload    │         │
│          │ ─────────────────────► │         │
└──────────┘   (content_hash)       └─────────┘
```

**Backend responsibilities:**
1. Validate user limits (file count < 10, size < 75MB)
2. Validate file type (PDF only)
3. Generate presigned URL
4. On confirmation: compute hash, check for duplicates, create resource row, extract page count, generate thumbnail

---

## Environment Variables

Add to `.env.example`:

```bash
# Cloudflare R2
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET_NAME=

# Redis (local Docker or external like Upstash)
REDIS_URL=redis://localhost:6379

# Extraction Agent
OPENROUTER_API_KEY=
EXTRACTION_AGENT_MODEL=qwen/qwen-3-vl-235b-a22b-instruct
```

---

## Implementation Phases

### Phase 1: Foundation ✅
- [x] Add resource constraints to backend settings (max size, max files, allowed types)
- [x] Add R2 and Redis environment variables to `.env.example`
- [x] Create `resources` and `user_resources` database tables (migration)
- [x] Implement `storage_service.py` (R2 operations: presigned URLs, upload, download)

### Phase 2: Upload Flow ✅
- [x] Backend: Presigned URL generation endpoint
- [x] Backend: Upload confirmation endpoint (hash, page count, thumbnail)
- [x] Frontend: Upload modal component with blur background
- [x] Frontend: Drag-and-drop with name editing
- [x] Frontend: Upload progress indicator

### Phase 3: Library UI ✅
- [x] Frontend: Restructure sidebar — add My Library / Public Library sub-items
- [x] Frontend: My Library page (user's resources)
- [x] Frontend: Public Library page (browse + search)
- [x] Frontend: Resource card component
- [x] Backend: CRUD endpoints for resources
- [x] Backend: Public resources listing with search

### Phase 4: Extraction Pipeline ✅
- [x] Setup Redis in docker-compose
- [x] Implement extraction agent with smolagents (Vision LLM via OpenRouter)
- [x] Backend: ARQ worker for extraction jobs
- [x] Backend: Extraction trigger endpoint (My Library only)
- [x] Backend: Extraction progress polling endpoint
- [x] Frontend: Extraction button (My Library only)
- [x] Frontend: Progress indicator during extraction
- [x] Frontend: Completed/failed status icons

### Phase 5: Polish ✅
- [x] PDF viewer integration (react-pdf with zoom, navigation)
- [x] Backend: "Add to My Library" from public resources
- [x] Frontend: "Add to My Library" button on public resources
- [x] Error handling & retry logic for failed extractions
- [x] Thumbnail display in resource cards (generated during extraction)

