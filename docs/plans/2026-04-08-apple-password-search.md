# Apple Password Search Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a Raycast command that searches Apple Passwords by domain, caches discovered accounts in SQLite without storing secrets, and retrieves passwords or OTP codes live through the installed `applepw` CLI with inline PIN authentication.

**Architecture:** Replace the empty no-view command with a Raycast `List` command. Add a small CLI adapter for `applepw` process execution and auth retry, a SQLite repository for non-secret account indexing, and a thin UI layer that always performs live discovery before rendering SQLite-backed results.

**Tech Stack:** Raycast API, React/TypeScript, Node child process APIs, SQLite library, local extension support storage

---

### Task 1: Set up unit test harness

**Files:**
- Modify: `package.json`
- Create: `src/test/applepw.test.ts`
- Create: `src/test/db.test.ts`
- Create: `src/test/search-state.test.ts`

**Step 1: Write the failing test**

- Add a minimal smoke test file and a `test` script before any production code changes.
- The first test should intentionally reference a missing helper so the suite fails for the right reason.

**Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL because the referenced helper or module does not exist yet.

**Step 3: Write minimal implementation**

- Add a lightweight TypeScript test runner setup that works in this Raycast repo.
- Add placeholder test files for CLI parsing, DB behavior, and search-state behavior.

**Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS for the smoke test harness with placeholder coverage in place.

### Task 2: Update command manifest and dependencies

**Files:**
- Modify: `package.json`

**Step 1: Write the failing test**

- Add or extend a unit test that asserts the command metadata and required runtime dependencies are present.

**Step 2: Run test to verify it fails**

Run: `npm test -- manifest`
Expected: FAIL because command `apw` is still configured as `no-view` and the SQLite dependency is missing.

**Step 3: Write minimal implementation**

- Change the `apw` command mode from `no-view` to `view`.
- Keep the existing command name.
- Add a SQLite dependency suitable for Raycast Node runtime.

**Step 4: Run test to verify it passes**

Run: `npm test -- manifest`
Expected: PASS.

### Task 3: Add typed applepw process wrapper

**Files:**
- Create: `src/applepw.ts`
- Modify: `src/test/applepw.test.ts`

**Step 1: Write the failing test**

- Add unit tests for:
  - detecting `Enter PIN:`
  - parsing successful JSON output
  - surfacing CLI errors
  - building `auth response` arguments correctly

**Step 2: Run test to verify it fails**

Run: `npm test -- applepw`
Expected: FAIL because the wrapper does not exist yet.

**Step 3: Write minimal implementation**

- Export typed helpers for:
  - `listPasswords(query)`
  - `getPassword(domain, username)`
  - `getOtp(domain)`
  - `authenticate(pin)`
- Implement a shared executor that:
  - calls the installed `../../applepw` binary
  - captures stdout/stderr
  - detects `Enter PIN:`
  - parses JSON output from successful commands
  - returns a typed auth-required result when the PIN prompt appears
- Implement `auth request` and `auth response` handling for non-interactive retry support.

**Step 4: Run test to verify it passes**

Run: `npm test -- applepw`
Expected: PASS.

### Task 4: Add SQLite repository for discovered accounts

**Files:**
- Create: `src/db.ts`
- Modify: `src/test/db.test.ts`

**Step 1: Write the failing test**

- Add unit tests for:
  - creating the DB when missing
  - upserting `domain` + `username`
  - preserving `first_seen_at`
  - updating `last_seen_at`
  - searching by exact domain, suffix, and username fragment

**Step 2: Run test to verify it fails**

Run: `npm test -- db`
Expected: FAIL because the repository does not exist yet.

**Step 3: Write minimal implementation**

- Create the SQLite DB in the Raycast support path if it does not exist.
- Create an `accounts` table with:
  - `domain`
  - `username`
  - `has_otp`
  - `first_seen_at`
  - `last_seen_at`
- Add helpers to:
  - initialize schema
  - upsert discovered accounts
  - search accounts by domain suffix or username fragment

**Step 4: Run test to verify it passes**

Run: `npm test -- db`
Expected: PASS.

### Task 5: Build the Raycast list UI and auth prompt flow

**Files:**
- Modify: `src/apw.ts`
- Modify: `src/test/search-state.test.ts`

**Step 1: Write the failing test**

- Add tests for the command state logic, covering:
  - live discovery followed by SQLite render
  - fallback to cached SQLite rows when live discovery returns empty
  - auth-required state triggering PIN collection
  - retrying the original action after successful auth

**Step 2: Run test to verify it fails**

Run: `npm test -- search-state`
Expected: FAIL because the command logic does not exist yet.

**Step 3: Write minimal implementation**

- Render a `List` command.
- On search text change:
  - call live discovery through `listPasswords(query)`
  - if accounts are found, upsert them into SQLite
  - query SQLite and render matching rows
- If the CLI wrapper returns auth-required:
  - show a Raycast form for PIN entry
  - authenticate
  - retry the original action
- Add actions for:
  - password fetch on `Enter`
  - OTP fetch through a secondary action
  - optional copy metadata helpers if useful

**Step 4: Run test to verify it passes**

Run: `npm test -- search-state`
Expected: PASS.

### Task 6: Verify end-to-end behavior and document it

**Files:**
- Modify: `README.md`

**Step 1: Write the failing test**

- Add one integration-style test around the top-level command helpers if practical, or extend unit coverage to assert the documented behavior.

**Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL until the final behavior and docs alignment are complete.

**Step 3: Write minimal implementation**

- Update README with the new search, password, OTP, and inline auth behavior.
- Note that only domain and username are stored locally.

**Step 4: Run validation to verify it passes**

Run: `npm test`
Expected: PASS.

Run: `npm run lint`
Expected: PASS.

Run: `npm run build`
Expected: PASS if the local Raycast toolchain is available.
