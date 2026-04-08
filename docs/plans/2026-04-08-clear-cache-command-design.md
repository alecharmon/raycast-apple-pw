# Clear Cache Command Design

## Goal

Add a dedicated Raycast command that deletes the local Apple Passwords cache database file after explicit user confirmation.

## Chosen Approach

Add a separate destructive command instead of embedding cache clearing inside the search UI. The command will:

1. resolve the active cache DB path using the same logic as `src/db.ts`
2. prompt for confirmation
3. delete the entire SQLite file if it exists
4. show a success or benign empty-cache message

## Why This Approach

- Keeps destructive behavior out of the main search command
- Makes the action explicit and discoverable
- Reuses the existing DB path resolution logic so it operates on the same cache file the extension uses

## Behavior

- If the cache file exists:
  - ask for confirmation
  - delete the file
  - show a success HUD or toast
- If the cache file does not exist:
  - do not fail
  - show a message that the cache is already empty
- If deletion fails:
  - show a failure toast with the filesystem error

## Implementation Notes

- Export a small helper from `src/db.ts` to resolve the cache file path without opening the database.
- Add a new Raycast command source file that uses `confirmAlert`, `showHUD`, and `showToast`.
- Keep the command minimal: no custom UI, just immediate confirmation and action.

## Testing

- verify the DB path helper returns the expected support-path location
- verify the clear-cache command is declared in `package.json`
- verify the DB path helper can still resolve the default path without requiring Raycast runtime imports
