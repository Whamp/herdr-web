// Mutating commands proxied through the bridge's allow-listed /api/command.

export type CommandResult = { type?: string; [key: string]: unknown };

async function runCommand(
  method: string,
  params: Record<string, unknown>,
): Promise<CommandResult> {
  const response = await fetch("/api/command", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ method, params }),
  });
  if (!response.ok) {
    let message = `command failed (${response.status})`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body?.error) {
        message = body.error;
      }
    } catch {
      // keep the default message
    }
    throw new Error(message);
  }
  return (await response.json()) as CommandResult;
}

/** Pull a pane id out of a {workspace,tab}_created result so the UI can jump to it. */
export function createdPaneId(result: CommandResult): string | null {
  const rootPane = result.root_pane as { pane_id?: string } | undefined;
  return rootPane?.pane_id ?? null;
}

export const commands = {
  createWorkspace: () => runCommand("workspace.create", { focus: true }),
  renameWorkspace: (workspaceId: string, label: string) =>
    runCommand("workspace.rename", { workspace_id: workspaceId, label }),
  closeWorkspace: (workspaceId: string) =>
    runCommand("workspace.close", { workspace_id: workspaceId }),
  focusWorkspace: (workspaceId: string) =>
    runCommand("workspace.focus", { workspace_id: workspaceId }),

  createTab: (workspaceId: string) =>
    runCommand("tab.create", { workspace_id: workspaceId, focus: true }),
  renameTab: (tabId: string, label: string) => runCommand("tab.rename", { tab_id: tabId, label }),
  closeTab: (tabId: string) => runCommand("tab.close", { tab_id: tabId }),
  focusTab: (tabId: string) => runCommand("tab.focus", { tab_id: tabId }),

  renamePane: (paneId: string, label: string) =>
    runCommand("pane.rename", { pane_id: paneId, label }),
  closePane: (paneId: string) => runCommand("pane.close", { pane_id: paneId }),
  // Layout-mutating: requires the bridge allow-list to include `pane.split`.
  splitPane: (targetPaneId: string, direction: "right" | "down") =>
    runCommand("pane.split", { target_pane_id: targetPaneId, direction, focus: true }),
};

/** Best-effort probe: is `pane.split` permitted by the bridge allow-list? */
export async function probeSplitSupported(): Promise<boolean> {
  try {
    const response = await fetch("/api/command", {
      method: "POST",
      headers: { "content-type": "application/json" },
      // A bogus pane id can never split anything; we only read the error shape.
      body: JSON.stringify({
        method: "pane.split",
        params: { target_pane_id: "__probe__", direction: "right" },
      }),
    });
    if (response.ok) {
      return true;
    }
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    // "command not allowed: pane.split" => blocked; anything else => method reached.
    return !/not allowed/i.test(body.error ?? "");
  } catch {
    return false;
  }
}
