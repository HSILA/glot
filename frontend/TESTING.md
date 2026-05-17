# Frontend test strategy

The frontend test suite is run with Bun's built-in test runner
(`bun test`). It is intentionally focused on **logic and contracts** —
not on rendered output — so it stays fast, stable, and meaningful as the
UI keeps changing.

## How to run

```bash
bun test                  # from frontend/
bun test src/lib          # narrow to a directory
bun test src/proxy.test   # narrow to a single file
```

The `test` script in `package.json` (`bun test`) is provided so editor /
CI integrations can run it the same way as the rest of the npm scripts.

## What is covered, and why

The product surface is small enough that a few well-chosen tests can lock
down the load-bearing behavior. The current suite is organised by what
would actually break a user if it regressed:

| Area | File | Why it matters |
| --- | --- | --- |
| Middleware redirect / open-redirect safety | `src/proxy.test.ts` | `next=` is user-controlled; a regression would be an auth-page open redirect. |
| Authenticated fetch + 401 refresh + login redirect | `src/lib/api/fetch-with-auth.test.ts` | Every API call goes through this. Bugs cause silent logouts, double refreshes, or losing the post-login destination. |
| FastAPI error parsing | `src/lib/api-error.test.ts` | Every toast/alert flows through `parseApiError`. A regression silently degrades every error UI. |
| Decks / Cards / Resources API clients | `src/lib/api/{decks,cards,resources}.test.ts` | Request shape + runtime validators + error pass-through. A backend response-shape change should fail loudly here, not in the UI. |
| Active-nav highlighting | `src/lib/nav.test.ts` | The `isActiveNavLink` helper is shared by the sidebar and bottom nav, and a naive `startsWith` would highlight `/decks` for `/decks-archive`. |

## What is deliberately not tested

- **Rendered React components.** No jsdom / Testing Library is set up.
  Rendering modals and pages here would mean mocking Next router, theme,
  auth, `sonner`, Radix portals, and intersection observers — a lot of
  brittle machinery for tests that mostly re-assert layout. Where a
  component has interesting logic (filters, sort modes, validators), we
  prefer to extract the pure part and test it directly.
- **Visual / snapshot tests.** They lock in style decisions and rot
  quickly under the active UI redesign work, so we skip them entirely.
- **Backend integration.** Tests stub `globalThis.fetch`; we are not
  verifying the FastAPI server.

If a future change makes rendered component tests genuinely worth their
weight (e.g. an interaction that can't be expressed as a pure helper),
the right move is to add `happy-dom` + `@testing-library/react` and pin
that scope tightly — not to retrofit the whole UI.

## Patterns used by the suite

- **Stub `globalThis.fetch` via `installFetchMock`** in
  `src/lib/test-utils.ts`. Each test enqueues handlers FIFO; an
  unexpected extra `fetch` call throws, so missed requests are loud.
- **Stub `window.location` via `installWindowMock`** when the code under
  test reads `window.location.pathname/search/hash` or calls
  `window.location.replace`. The mock records every `replace()` call so
  redirect behavior is assertable.
- **Reset shared module state** between tests where needed —
  `fetch-with-auth` exports `__resetForTests()` so the in-flight refresh
  promise can't leak across tests.

## Adding new tests

Co-locate `*.test.ts` next to the module it tests. Prefer:

1. Pure helpers (extract one if you have to) — fastest, hardest to break.
2. API client request / response contracts using `installFetchMock`.
3. Middleware / routing behavior using `mock.module()` for `next/server`.

Avoid wide integration tests in this layer; the value-to-maintenance
ratio is poor relative to a handful of well-aimed Playwright tests
(future work).
