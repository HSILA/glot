---
trigger: always_on
---

# Git Commit Message Generation Rules

When asked to write a commit message, analyze the current staged changes by comparing each file with its previous, unchanged version. If the changes are already provided in the conversation history, use them immediately to generate the message.

### Formatting Requirements:

1. **Title:** Must follow the Conventional Commits specification: `<type>(<optional-scope>): <description>`.

2. **Body:** Follow the title with exactly one empty line, then use markdown bullet points (`-`) for short phrases explaining independent changes.

3. **No Styling:** Do not use headings or bold text for the title inside the code block.

4. **Output Only:** Provide only the commit message inside a markdown code block. Do not perform the git operation or provide extra commentary.

### Allowed Keywords (Types):
- `feat`: A new feature.
- `fix`: A bug fix.
- `docs`: Documentation only changes.
- `style`: Changes that do not affect the meaning of the code (white-space, formatting, etc).
- `refactor`: A code change that neither fixes a bug nor adds a feature.
- `perf`: A code change that improves performance.
- `test`: Adding missing tests or correcting existing tests.
- `build`: Changes that affect the build system or external dependencies.
- `ci`: Changes to CI configuration files and scripts.
- `chore`: Other changes that don't modify src or test files.

### Breaking Changes:
If a change breaks backward compatibility:

1. Add an exclamation mark (!) after the type/scope: feat(api)!: change user object structure.

2. Add a footer at the very bottom of the message starting with "BREAKING CHANGE: " followed by a description of the break.

### Examples:

Example 1: Feature
feat(api): add user registration endpoint

- implemented POST /register route in auth controller
- added password hashing logic using bcrypt
- created validation schema for incoming user data

Example 2: Bug Fix
fix(ui): correct button misalignment on mobile

- updated flexbox properties in the header component
- adjusted padding for screens smaller than 768px
- fixed z-index for the navigation overlay

Example 3: Breaking Change
refactor(auth)!: migrate to JWT-based sessions

- removed legacy cookie-based session storage
- implemented JWT generation and verification middleware
- updated client-side headers to include Bearer tokens

BREAKING CHANGE: The /session endpoint no longer returns a cookie; clients must now store and send a JWT in the Authorization header.