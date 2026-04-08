# Apple Passwords

Search Apple Passwords from Raycast with live discovery through the installed `applepw` CLI, cached account metadata in SQLite, and no stored secrets.

## What It Does

- Search by domain or email fragment.
- Copy a password with the primary action.
- Copy a 2FA code with the secondary OTP action.
- Handle inline activation-code prompts automatically when the daemon needs re-authentication.

## Local Storage

The extension stores only non-secret metadata in SQLite:

- domain
- username
- OTP availability
- first-seen and last-seen timestamps

Passwords and OTP codes are never written to disk.
