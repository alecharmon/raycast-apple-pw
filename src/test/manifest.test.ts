import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { assert, test } from "./test-harness";

const testDir = dirname(fileURLToPath(import.meta.url));
const packageJsonPath = resolve(testDir, "../../package.json");
const manifest = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
  commands?: Array<{ name: string; mode?: string }>;
  dependencies?: Record<string, string>;
};

test("apw command uses view mode", () => {
  const command = manifest.commands?.find((item) => item.name === "apw");

  assert.ok(command, "apw command should exist");
  assert.equal(command?.mode, "view");
});

test("sql.js dependency is declared", () => {
  assert.ok(manifest.dependencies?.["sql.js"], "expected sql.js to be declared");
});

test("sqlite3 native dependency is not declared", () => {
  assert.equal(Boolean(manifest.dependencies?.sqlite3), false, "sqlite3 should not be declared");
});
