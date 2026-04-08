# Apple Password Search Design

## Summary

Build a Raycast password search utility in this extension that uses the installed `../../applepw` CLI as the live source of truth for discovery and secret retrieval. The command will let users search by domain or email domain, choose an account, fetch the password on `Enter`, and fetch a 2FA code through a separate action when available.

## Goals

- Search Apple Passwords accounts by domain or email-domain fragment.
- Always query `applepw` first for discovery, then render from local SQLite.
- Persist only non-secret metadata: domain, username, OTP availability, and timestamps.
- Detect inline auth prompts from `applepw` and replace them with a clean Raycast PIN input flow.

## Non-Goals

- Persisting passwords, OTP codes, or Apple session secrets.
- Replacing `applepw` as the source of truth.
- Building a separate standalone auth command.

## Existing Context

- The current extension has a single empty command at `src/apw.ts`.
- The parent CLI exposes:
  - `applepw pw list <domain>` for discovery
  - `applepw pw get <domain> [username]` for password retrieval
  - `applepw otp get <domain>` for OTP retrieval
  - `applepw auth request` and `applepw auth response ...` for non-interactive authentication
- The CLI prints `Enter PIN:` during interactive auth when the daemon restarted or the session is missing.

## Proposed UX

- Convert the current Raycast command to a `view` command with a `List`.
- As the user types a search query, the extension will:
  - call `applepw pw list <query>`
  - detect and resolve auth if needed
  - upsert any discovered `domain` and `username` rows into SQLite
  - query SQLite and render matching rows
- Selecting a row with `Enter` will:
  - run `applepw pw get <domain> <username>`
  - detect and resolve auth if needed
  - copy or show the password in Raycast
- A secondary action will:
  - run `applepw otp get <domain>`
  - detect and resolve auth if needed
  - match the returned code to the selected username when possible
  - copy or show the OTP

## Data Model

Use a local SQLite database in the Raycast support directory with a single table:

- `accounts`
  - `domain TEXT NOT NULL`
  - `username TEXT NOT NULL`
  - `has_otp INTEGER NOT NULL DEFAULT 0`
  - `first_seen_at TEXT NOT NULL`
  - `last_seen_at TEXT NOT NULL`
  - unique key on `(domain, username)`

Only domain, username, OTP availability, and timestamps are stored.

## Search Behavior

The search flow is intentionally live-first:

1. User enters a query.
2. Extension runs `applepw pw list <query>`.
3. If results exist, normalize and upsert them into SQLite.
4. Extension queries SQLite for rows matching:
   - exact domain
   - domain suffix
   - username fragment
5. The rendered list comes from SQLite, so previously discovered rows remain searchable even if the latest live query returns nothing.

This satisfies the requirement to always query `applepw` first while still making future searches easier through local indexing.

## Auth Handling

All CLI calls will go through a shared executor wrapper. If the wrapper detects `Enter PIN:` instead of structured JSON, it will:

1. run `applepw auth request`
2. show a Raycast PIN form
3. run `applepw auth response` with the values from `auth request` and the entered PIN
4. retry the original command once

If the PIN is wrong, the form remains available with the returned error. This auth handling is shared across discovery, password retrieval, and OTP retrieval.

## Error Handling

- Missing binary: show an explicit error with the expected path.
- Auth failure: keep the PIN form open and show the CLI error.
- Discovery returns no results: still search SQLite and show cached rows.
- OTP not present for a selected row: keep password retrieval working and disable or fail OTP cleanly.
- JSON parse failure: treat it as command failure unless it matches the auth prompt.

## Testing Scope

- DB creation on first run
- upserting live discovery results
- rendering cached results when live discovery is empty
- detecting auth prompt and retrying after successful PIN entry
- fetching a password for a selected account
- fetching an OTP for a selected account

## Implementation Notes

- Keep secrets in memory only.
- Prefer a small CLI adapter module for process execution, auth detection, JSON parsing, and typed results.
- Keep SQLite access in a dedicated helper so UI code stays thin.
