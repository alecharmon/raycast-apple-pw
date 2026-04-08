import { createRequire } from "node:module";
import { join } from "node:path";
import React, { useEffect, useRef, useState } from "react";
import {
  createApplePwClient,
  type ApplePwClient,
  type ApplePwCommandOutcome,
  type ApplePwOtpEntry,
  type ApplePwPasswordEntry,
} from "./applepw";
import { createAccountRepository, type AccountRecord, type AccountRepository } from "./db";

type PendingAction =
  | { kind: "search"; query: string }
  | { kind: "password"; account: AccountRecord }
  | { kind: "otp"; account: AccountRecord };

export interface SearchResultsOutcome {
  kind: "results";
  query: string;
  rows: AccountRecord[];
}

export interface AuthRequiredOutcome {
  kind: "auth-required";
  prompt: string;
  pendingAction: PendingAction;
}

export interface SecretOutcome {
  kind: "secret";
  action: "password" | "otp";
  account: AccountRecord;
  value: string;
}

export type PasswordSearchOutcome = SearchResultsOutcome | AuthRequiredOutcome | SecretOutcome;

export interface PasswordSearchWorkflow {
  search(query: string): Promise<PasswordSearchOutcome>;
  fetchPassword(account: AccountRecord): Promise<PasswordSearchOutcome>;
  fetchOtp(account: AccountRecord): Promise<PasswordSearchOutcome>;
  submitPin(pin: string): Promise<PasswordSearchOutcome>;
}

export interface PasswordSearchWorkflowOptions {
  applePw: ApplePwClient;
  repository: Pick<AccountRepository, "upsertDiscoveredAccounts" | "searchAccounts">;
}

type UiRuntime = {
  Action: typeof import("@raycast/api").Action;
  ActionPanel: typeof import("@raycast/api").ActionPanel;
  Clipboard: typeof import("@raycast/api").Clipboard;
  Form: typeof import("@raycast/api").Form;
  Icon: typeof import("@raycast/api").Icon;
  List: typeof import("@raycast/api").List;
  Toast: typeof import("@raycast/api").Toast;
  showHUD: typeof import("@raycast/api").showHUD;
  showToast: typeof import("@raycast/api").showToast;
};

const require = createRequire(join(process.cwd(), "package.json"));
const defaultApplePwClient = createApplePwClient();
let uiRuntime: UiRuntime | null = null;

function getUiRuntime(): UiRuntime {
  if (uiRuntime) {
    return uiRuntime;
  }

  const api = require("@raycast/api") as typeof import("@raycast/api");
  uiRuntime = {
    Action: api.Action,
    ActionPanel: api.ActionPanel,
    Clipboard: api.Clipboard,
    Form: api.Form,
    Icon: api.Icon,
    List: api.List,
    Toast: api.Toast,
    showHUD: api.showHUD,
    showToast: api.showToast,
  };
  return uiRuntime;
}

function mapPasswordEntries(entries: ApplePwPasswordEntry[]) {
  return entries.map((entry) => ({
    domain: entry.domain,
    username: entry.username,
    hasOtp: Boolean(entry.has_otp),
  }));
}

function selectPasswordValue(result: ApplePwCommandOutcome<ApplePwPasswordEntry[]>): string {
  const entry = result.kind === "success" ? result.payload[0] : undefined;
  const password = entry?.password?.trim();
  if (!password) {
    throw new Error("applepw did not return a password");
  }
  return password;
}

function selectOtpValue(result: ApplePwCommandOutcome<ApplePwOtpEntry[]>, account: AccountRecord): string {
  const entries = result.kind === "success" ? result.payload : [];
  const entry = entries.find((candidate) => candidate.username === account.username) ?? entries[0];
  const code = entry?.code?.trim();
  if (!code) {
    throw new Error("applepw did not return a 2FA code");
  }
  return code;
}

function outcomeFromAuthRequired(prompt: string, pendingAction: PendingAction): AuthRequiredOutcome {
  return {
    kind: "auth-required",
    prompt,
    pendingAction,
  };
}

export function createPasswordSearchWorkflow(options: PasswordSearchWorkflowOptions): PasswordSearchWorkflow {
  const { applePw, repository } = options;
  let pendingAction: PendingAction | null = null;
  let activeRequestId = 0;

  function setPendingAction(requestId: number, action: PendingAction) {
    if (requestId === activeRequestId) {
      pendingAction = action;
    }
  }

  function clearPendingAction(requestId: number) {
    if (requestId === activeRequestId) {
      pendingAction = null;
    }
  }

  async function runSearch(query: string): Promise<PasswordSearchOutcome> {
    const trimmedQuery = query.trim();
    const requestId = ++activeRequestId;

    if (!trimmedQuery) {
      clearPendingAction(requestId);
      return {
        kind: "results",
        query,
        rows: [],
      };
    }

    const liveResult = await applePw.listPasswords(trimmedQuery);
    if (liveResult.kind === "auth-required") {
      const action = { kind: "search", query: trimmedQuery } as PendingAction;
      setPendingAction(requestId, action);
      return outcomeFromAuthRequired(liveResult.prompt, action);
    }

    await repository.upsertDiscoveredAccounts(mapPasswordEntries(liveResult.payload));
    const rows = await repository.searchAccounts(trimmedQuery);
    clearPendingAction(requestId);

    return {
      kind: "results",
      query: trimmedQuery,
      rows,
    };
  }

  async function runPassword(account: AccountRecord): Promise<PasswordSearchOutcome> {
    const requestId = ++activeRequestId;
    const result = await applePw.getPassword(account.domain, account.username);
    if (result.kind === "auth-required") {
      const action = { kind: "password", account } as PendingAction;
      setPendingAction(requestId, action);
      return outcomeFromAuthRequired(result.prompt, action);
    }

    clearPendingAction(requestId);
    return {
      kind: "secret",
      action: "password",
      account,
      value: selectPasswordValue(result),
    };
  }

  async function runOtp(account: AccountRecord): Promise<PasswordSearchOutcome> {
    const requestId = ++activeRequestId;
    const result = await applePw.getOtp(account.domain);
    if (result.kind === "auth-required") {
      const action = { kind: "otp", account } as PendingAction;
      setPendingAction(requestId, action);
      return outcomeFromAuthRequired(result.prompt, action);
    }

    clearPendingAction(requestId);
    return {
      kind: "secret",
      action: "otp",
      account,
      value: selectOtpValue(result, account),
    };
  }

  async function submitPin(pin: string): Promise<PasswordSearchOutcome> {
    if (!pendingAction) {
      throw new Error("No pending authentication action");
    }

    await applePw.authenticate(pin);
    const action = pendingAction;
    pendingAction = null;

    switch (action.kind) {
      case "search":
        return await runSearch(action.query);
      case "password":
        return await runPassword(action.account);
      case "otp":
        return await runOtp(action.account);
    }
  }

  return {
    search: runSearch,
    fetchPassword: runPassword,
    fetchOtp: runOtp,
    submitPin,
  };
}

async function copySecretAndNotify(outcome: SecretOutcome): Promise<void> {
  const ui = getUiRuntime();
  await ui.Clipboard.copy(outcome.value, { concealed: true });
  await ui.showHUD(outcome.action === "password" ? "Password copied" : "2FA code copied");
}

async function presentError(error: unknown): Promise<void> {
  const ui = getUiRuntime();
  const message = error instanceof Error ? error.message : "Unknown error";
  await ui.showToast({
    style: ui.Toast.Style.Failure,
    title: "Apple Passwords",
    message,
  });
}

function SecretActionListItem({
  account,
  onPassword,
  onOtp,
}: {
  account: AccountRecord;
  onPassword: (account: AccountRecord) => Promise<void>;
  onOtp: (account: AccountRecord) => Promise<void>;
}) {
  const ui = getUiRuntime();
  const h = React.createElement;

  return h(ui.List.Item, {
    title: account.domain,
    subtitle: account.username,
    accessories: account.hasOtp ? [{ icon: ui.Icon.Key, text: "OTP" }] : undefined,
    actions: h(
      ui.ActionPanel,
      null,
      h(ui.Action, {
        title: "Copy Password",
        icon: ui.Icon.Key,
        onAction: () => void onPassword(account),
      }),
      h(ui.Action, {
        title: "Copy 2FA Code",
        icon: ui.Icon.Wand,
        onAction: () => void onOtp(account),
        isDisabled: !account.hasOtp,
      }),
    ),
  });
}

export function AuthPromptForm({ prompt, onSubmit }: { prompt: string; onSubmit: (pin: string) => Promise<void> }) {
  const ui = getUiRuntime();
  const h = React.createElement;

  return h(
    ui.Form,
    {
      actions: h(
        ui.ActionPanel,
        null,
        h(ui.Action.SubmitForm, createAuthPromptSubmitActionProps(onSubmit)),
      ),
    },
    h(ui.Form.Description, {
      title: "Authentication Required",
      text: prompt,
    }),
    h(ui.Form.PasswordField, {
      id: "pin",
      title: "Activation Code",
      placeholder: "Enter the code from Apple Passwords",
    }),
  );
}

export function createAuthPromptSubmitActionProps(onSubmit: (pin: string) => Promise<void>) {
  return {
    title: "Submit Activation Code",
    onSubmit: async (values: { pin?: string }) => {
      await onSubmit(values.pin?.trim() ?? "");
    },
  };
}

export default function Command() {
  const [workflow, setWorkflow] = useState<PasswordSearchWorkflow | null>(null);
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<AccountRecord[]>([]);
  const [authPrompt, setAuthPrompt] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const requestIdRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    let activeRepository: AccountRepository | null = null;

    void createAccountRepository()
      .then((created) => {
        if (cancelled) {
          void created.close();
          return;
        }

        activeRepository = created;
        setWorkflow(
          createPasswordSearchWorkflow({
            applePw: defaultApplePwClient,
            repository: created,
          }),
        );
        setIsLoading(false);
      })
      .catch(async (error) => {
        setIsLoading(false);
        await presentError(error);
      });

    return () => {
      cancelled = true;
      if (activeRepository) {
        void activeRepository.close();
      }
    };
  }, []);

  useEffect(() => {
    if (!workflow) {
      return;
    }

    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      requestIdRef.current += 1;
      setRows([]);
      setAuthPrompt(null);
      setIsLoading(false);
      return;
    }

    const requestId = ++requestIdRef.current;
    setRows([]);
    setAuthPrompt(null);
    setIsLoading(true);

    void workflow
      .search(trimmedQuery)
      .then((outcome) => {
        if (requestId !== requestIdRef.current) {
          return;
        }

        if (outcome.kind === "results") {
          setRows(outcome.rows);
          setAuthPrompt(null);
        } else {
          setAuthPrompt(outcome.prompt);
        }
      })
      .catch(async (error) => {
        if (requestId !== requestIdRef.current) {
          return;
        }

        await presentError(error);
      })
      .finally(() => {
        if (requestId === requestIdRef.current) {
          setIsLoading(false);
        }
      });
  }, [query, workflow]);

  const handlePassword = async (account: AccountRecord) => {
    if (!workflow) {
      return;
    }

    setIsLoading(true);
    try {
      const outcome = await workflow.fetchPassword(account);
      if (outcome.kind === "auth-required") {
        setAuthPrompt(outcome.prompt);
        return;
      }

      setAuthPrompt(null);
      await copySecretAndNotify(outcome);
    } catch (error) {
      await presentError(error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleOtp = async (account: AccountRecord) => {
    if (!workflow) {
      return;
    }

    setIsLoading(true);
    try {
      const outcome = await workflow.fetchOtp(account);
      if (outcome.kind === "auth-required") {
        setAuthPrompt(outcome.prompt);
        return;
      }

      setAuthPrompt(null);
      await copySecretAndNotify(outcome);
    } catch (error) {
      await presentError(error);
    } finally {
      setIsLoading(false);
    }
  };

  const handlePinSubmit = async (pin: string) => {
    if (!workflow) {
      return;
    }

    setIsLoading(true);
    try {
      const outcome = await workflow.submitPin(pin);
      if (outcome.kind === "results") {
        setRows(outcome.rows);
        setAuthPrompt(null);
      } else if (outcome.kind === "secret") {
        setAuthPrompt(null);
        await copySecretAndNotify(outcome);
      } else {
        setAuthPrompt(outcome.prompt);
      }
    } catch (error) {
      await presentError(error);
    } finally {
      setIsLoading(false);
    }
  };

  if (authPrompt) {
    return React.createElement(AuthPromptForm, { prompt: authPrompt, onSubmit: handlePinSubmit });
  }

  const ui = getUiRuntime();
  const h = React.createElement;
  const trimmedQuery = query.trim();
  const emptyState = isLoading
    ? {
        icon: ui.Icon.Key,
        title: "Searching Apple Passwords",
        description: `Looking up ${trimmedQuery}...`,
      }
    : trimmedQuery
      ? {
          icon: ui.Icon.Key,
          title: "No matches found",
          description: `No passwords were found for ${trimmedQuery}.`,
        }
      : {
          icon: ui.Icon.Key,
          title: "Search your passwords",
          description: "Type a domain or email fragment to sync from Apple Passwords.",
        };

  return h(
    ui.List,
    {
      isLoading,
      searchBarPlaceholder: "Search by domain or email",
      onSearchTextChange: setQuery,
    },
    rows.length === 0
      ? h(ui.List.EmptyView, emptyState)
      : rows.map((account) =>
          h(SecretActionListItem, {
            key: `${account.domain}:${account.username}`,
            account,
            onPassword: handlePassword,
            onOtp: handleOtp,
          }),
        ),
  );
}
