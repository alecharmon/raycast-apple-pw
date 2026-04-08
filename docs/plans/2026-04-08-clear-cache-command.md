# Clear Cache Command Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a dedicated Raycast command that deletes the cached SQLite file after confirmation.

**Architecture:** Reuse DB path resolution from `src/db.ts` and add a small destructive command entry point that confirms, deletes the file, and reports the outcome. Keep this separate from the search command so destructive behavior is isolated.

**Tech Stack:** Raycast, TypeScript, Node fs, sql.js-backed repository

---

### Task 1: Expose Cache Path Resolution

**Files:**
- Modify: `src/db.ts`
- Test: `src/test/db.test.ts`

**Step 1: Write the failing test**

Add a test that resolves the DB path from `supportPath` through a public helper.

**Step 2: Run test to verify it fails**

Run: `npm test -- src/test/db.test.ts`
Expected: FAIL because the helper is not exported yet.

**Step 3: Write minimal implementation**

Export a helper from `src/db.ts` that returns the same DB path used by `createAccountRepository()`.

**Step 4: Run test to verify it passes**

Run: `npm test -- src/test/db.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/db.ts src/test/db.test.ts
git commit -m "refactor: expose cache db path helper"
```

### Task 2: Add the Clear Cache Command

**Files:**
- Create: `src/clear-cache.ts`
- Modify: `package.json`
- Test: `src/test/manifest.test.ts`

**Step 1: Write the failing test**

Add a manifest test that expects a `clear-cache` command to exist.

**Step 2: Run test to verify it fails**

Run: `npm test -- src/test/manifest.test.ts`
Expected: FAIL because the command is not declared.

**Step 3: Write minimal implementation**

- Add the `clear-cache` command entry to `package.json`
- Implement `src/clear-cache.ts`
- Confirm before deleting
- Delete the whole DB file if it exists
- Show success, empty-cache, or failure messaging

**Step 4: Run test to verify it passes**

Run: `npm test -- src/test/manifest.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add package.json src/clear-cache.ts src/test/manifest.test.ts
git commit -m "feat: add clear cache command"
```

### Task 3: Verify End-to-End

**Files:**
- Verify: `src/db.ts`
- Verify: `src/clear-cache.ts`
- Verify: `package.json`

**Step 1: Run full tests**

Run: `npm test`
Expected: PASS.

**Step 2: Run Raycast build**

Run: `npx ray build`
Expected: PASS.

**Step 3: Inspect final diff**

Run: `git diff -- src/db.ts src/clear-cache.ts package.json src/test/db.test.ts src/test/manifest.test.ts`
Expected: only the clear-cache command changes.

**Step 4: Commit**

```bash
git add src/db.ts src/clear-cache.ts package.json src/test/db.test.ts src/test/manifest.test.ts
git commit -m "feat: add cache clear command"
```
