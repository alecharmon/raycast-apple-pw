import { strict as assert } from "node:assert";
import { createAuthPromptSubmitActionProps, createPasswordSearchWorkflow } from "../apw";
import { test } from "./test-harness";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test("ignores empty search queries without calling applepw", async () => {
  let listCalls = 0;
  const workflow = createPasswordSearchWorkflow({
    applePw: {
      listPasswords: async () => {
        listCalls += 1;
        return {
          kind: "success",
          payload: [],
          stdout: "",
          stderr: "",
        };
      },
      getPassword: async () => {
        throw new Error("not used");
      },
      getOtp: async () => {
        throw new Error("not used");
      },
      authenticate: async () => ({ status: 0 }),
      execute: async () => {
        throw new Error("not used");
      },
    },
    repository: {
      upsertDiscoveredAccounts: async () => undefined,
      markAccountUsed: async () => undefined,
      searchAccounts: async () => [],
      close: async () => undefined,
    },
  });

  const result = await workflow.search("   ");

  assert.equal(result.kind, "results");
  assert.equal(result.rows.length, 0);
  assert.equal(listCalls, 0);
});

test("keeps the latest auth-required search for pin retry", async () => {
  const calls: string[] = [];
  const first = deferred<
    | {
        kind: "auth-required";
        prompt: string;
        stdout: string;
        stderr: string;
      }
    | {
        kind: "success";
        payload: Array<{
          id: string;
          username: string;
          domain: string;
          password: string;
        }>;
        stdout: string;
        stderr: string;
      }
  >();
  const second = deferred<
    | {
        kind: "auth-required";
        prompt: string;
        stdout: string;
        stderr: string;
      }
    | {
        kind: "success";
        payload: Array<{
          id: string;
          username: string;
          domain: string;
          password: string;
        }>;
        stdout: string;
        stderr: string;
      }
  >();
  let authenticated = false;

  const workflow = createPasswordSearchWorkflow({
    applePw: {
      listPasswords: async (query: string) => {
        calls.push(`list:${query}`);
        if (!authenticated) {
          if (query === "first") {
            return await first.promise;
          }

          return await second.promise;
        }

        return {
          kind: "success",
          payload: [
            {
              id: "retry",
              username: "retry@example.com",
              domain: query,
              password: `${query}-secret`,
            },
          ],
          stdout: "",
          stderr: "",
        };
      },
      getPassword: async () => {
        throw new Error("not used");
      },
      getOtp: async () => {
        throw new Error("not used");
      },
      authenticate: async (pin: string) => {
        calls.push(`auth:${pin}`);
        authenticated = true;
        return { status: 0 };
      },
      execute: async () => {
        throw new Error("not used");
      },
    },
    repository: {
      upsertDiscoveredAccounts: async () => undefined,
      markAccountUsed: async () => undefined,
      searchAccounts: async () => [],
      close: async () => undefined,
    },
  });

  const firstSearch = workflow.search("first");
  const secondSearch = workflow.search("second");

  second.resolve({
    kind: "auth-required",
    prompt: "Enter PIN:",
    stdout: "Enter PIN:",
    stderr: "",
  });
  const secondOutcome = await secondSearch;

  first.resolve({
    kind: "auth-required",
    prompt: "Enter PIN:",
    stdout: "Enter PIN:",
    stderr: "",
  });
  const firstOutcome = await firstSearch;

  assert.equal(firstOutcome.kind, "auth-required");
  assert.equal(secondOutcome.kind, "auth-required");

  const result = await workflow.submitPin("123456");

  assert.equal(result.kind, "results");
  assert.equal(result.query, "second");
  assert.deepEqual(calls, ["list:first", "list:second", "auth:123456", "list:second"]);
});

test("renders cached rows after live discovery upserts accounts", async () => {
  const upserts: unknown[] = [];
  const repository = {
    upsertDiscoveredAccounts: async (accounts: unknown[]) => {
      upserts.push(accounts);
    },
    searchAccounts: async () => [
      {
        domain: "example.com",
        username: "alice@example.com",
        hasOtp: true,
        firstSeenAt: "2026-04-08T00:00:00.000Z",
        lastSeenAt: "2026-04-08T00:00:00.000Z",
        lastUsedAt: undefined,
      },
    ],
    close: async () => undefined,
  };

  const workflow = createPasswordSearchWorkflow({
    applePw: {
      listPasswords: async () => ({
        kind: "success",
        payload: [
          {
            id: "1",
            username: "alice@example.com",
            domain: "example.com",
            password: "secret",
            has_otp: true,
          },
        ],
        stdout: "",
        stderr: "",
      }),
      getPassword: async () => {
        throw new Error("not used");
      },
      getOtp: async () => {
        throw new Error("not used");
      },
      authenticate: async () => ({ status: 0 }),
      execute: async () => {
        throw new Error("not used");
      },
    },
    repository,
  });

  const result = await workflow.search("example.com");

  assert.equal(result.kind, "results");
  assert.deepEqual(upserts, [[{ domain: "example.com", username: "alice@example.com", hasOtp: true }]]);
  assert.deepEqual(result.rows, await repository.searchAccounts("example.com"));
});

test("falls back to cached rows when live discovery returns nothing", async () => {
  const repository = {
    upsertDiscoveredAccounts: async () => undefined,
    searchAccounts: async () => [
      {
        domain: "example.com",
        username: "bob@example.com",
        hasOtp: false,
        firstSeenAt: "2026-04-08T00:00:00.000Z",
        lastSeenAt: "2026-04-08T01:00:00.000Z",
      },
    ],
    close: async () => undefined,
  };

  const workflow = createPasswordSearchWorkflow({
    applePw: {
      listPasswords: async () => ({
        kind: "success",
        payload: [],
        stdout: "",
        stderr: "",
      }),
      getPassword: async () => {
        throw new Error("not used");
      },
      getOtp: async () => {
        throw new Error("not used");
      },
      authenticate: async () => ({ status: 0 }),
      execute: async () => {
        throw new Error("not used");
      },
    },
    repository,
  });

  const result = await workflow.search("example.com");

  assert.equal(result.kind, "results");
  assert.deepEqual(result.rows, await repository.searchAccounts("example.com"));
});

test("prompts for pin when discovery requires auth", async () => {
  const workflow = createPasswordSearchWorkflow({
    applePw: {
      listPasswords: async () => ({
        kind: "auth-required",
        prompt: "Enter PIN:",
        stdout: "Enter PIN:",
        stderr: "",
      }),
      getPassword: async () => {
        throw new Error("not used");
      },
      getOtp: async () => {
        throw new Error("not used");
      },
      authenticate: async () => ({ status: 0 }),
      execute: async () => {
        throw new Error("not used");
      },
    },
    repository: {
      upsertDiscoveredAccounts: async () => undefined,
      markAccountUsed: async () => undefined,
      searchAccounts: async () => [],
      close: async () => undefined,
    },
  });

  const result = await workflow.search("example.com");

  assert.equal(result.kind, "auth-required");
  assert.equal(result.prompt, "Enter PIN:");
  assert.deepEqual(result.pendingAction, { kind: "search", query: "example.com" });
});

test("retries the original search after pin auth succeeds", async () => {
  const calls: string[] = [];
  const workflow = createPasswordSearchWorkflow({
    applePw: {
      listPasswords: async () => {
        calls.push("list");
        if (calls.length === 1) {
          return {
            kind: "auth-required",
            prompt: "Enter PIN:",
            stdout: "Enter PIN:",
            stderr: "",
          };
        }

        return {
          kind: "success",
          payload: [
            {
              id: "1",
              username: "alice@example.com",
              domain: "example.com",
              password: "secret",
              has_otp: true,
            },
          ],
          stdout: "",
          stderr: "",
        };
      },
      getPassword: async () => {
        throw new Error("not used");
      },
      getOtp: async () => {
        throw new Error("not used");
      },
      authenticate: async (pin: string) => {
        calls.push(`auth:${pin}`);
        return { status: 0 };
      },
      execute: async () => {
        throw new Error("not used");
      },
    },
    repository: {
      upsertDiscoveredAccounts: async () => undefined,
      searchAccounts: async () => [
        {
          domain: "example.com",
          username: "alice@example.com",
          hasOtp: true,
          firstSeenAt: "2026-04-08T00:00:00.000Z",
          lastSeenAt: "2026-04-08T00:00:00.000Z",
          lastUsedAt: undefined,
        },
      ],
      close: async () => undefined,
    },
  });

  const pending = await workflow.search("example.com");
  assert.equal(pending.kind, "auth-required");

  const result = await workflow.submitPin("123456");

  assert.equal(result.kind, "results");
  assert.deepEqual(calls, ["list", "auth:123456", "list"]);
});

test("fetches password and otp secrets for the selected account", async () => {
  const used: string[] = [];
  const account = {
    domain: "example.com",
    username: "alice@example.com",
    hasOtp: true,
    firstSeenAt: "2026-04-08T00:00:00.000Z",
    lastSeenAt: "2026-04-08T00:00:00.000Z",
    lastUsedAt: undefined,
  };

  const workflow = createPasswordSearchWorkflow({
    applePw: {
      listPasswords: async () => ({
        kind: "success",
        payload: [],
        stdout: "",
        stderr: "",
      }),
      getPassword: async () => ({
        kind: "success",
        payload: [
          {
            id: "pw-1",
            username: account.username,
            domain: account.domain,
            password: "super-secret",
          },
        ],
        stdout: "",
        stderr: "",
      }),
      getOtp: async () => ({
        kind: "success",
        payload: [
          {
            id: "otp-1",
            username: account.username,
            domain: account.domain,
            code: "123456",
          },
        ],
        stdout: "",
        stderr: "",
      }),
      authenticate: async () => ({ status: 0 }),
      execute: async () => {
        throw new Error("not used");
      },
    },
    repository: {
      upsertDiscoveredAccounts: async () => undefined,
      markAccountUsed: async (domain: string, username: string) => {
        used.push(`${domain}:${username}`);
      },
      searchAccounts: async () => [],
      close: async () => undefined,
    },
  });

  const passwordOutcome = await workflow.fetchPassword(account);
  const otpOutcome = await workflow.fetchOtp(account);

  assert.equal(passwordOutcome.kind, "secret");
  assert.equal(passwordOutcome.action, "password");
  assert.equal(passwordOutcome.value, "super-secret");
  assert.equal(otpOutcome.kind, "secret");
  assert.equal(otpOutcome.action, "otp");
  assert.equal(otpOutcome.value, "123456");
  assert.deepEqual(used, ["example.com:alice@example.com", "example.com:alice@example.com"]);
});

test("trims and forwards auth prompt submissions", async () => {
  const submissions: string[] = [];
  const props = createAuthPromptSubmitActionProps(async (pin: string) => {
    submissions.push(pin);
  });

  assert.equal(typeof props.onSubmit, "function");

  await props.onSubmit({ pin: " 123456 " });

  assert.deepEqual(submissions, ["123456"]);
});
