// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  isTauri: () => false,
}));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  localStorage.clear();
});
it("public preview ignores persisted mailbox data and blocks real operations", async () => {
  vi.stubEnv("MODE", "preview");
  localStorage.setItem(
    "mail-desktop-demo-v1",
    JSON.stringify({ accounts: [{ email: "private@example.com" }] }),
  );
  const api = await import("./api");
  api.restoreDemo();
  expect(api.isDemo()).toBe(true);
  const result = await api.snapshot({
    view: "all",
    accountId: "",
    folder: "",
    search: "",
    limit: 100,
    unreadOnly: false,
  });
  expect(result.accounts.some((x) => x.email === "private@example.com")).toBe(
    false,
  );
  for (const command of [
    "connect_account",
    "edit_account",
    "send_mail",
    "schedule_mail",
    "save_attachment",
    "preview_attachment",
    "move_archive_location",
    "delete_local_archives",
    "test_notification",
  ]) {
    await expect(api.call(command, {})).rejects.toThrow("页面预览不连接邮箱");
  }
  api.leaveDemo();
  expect(api.isDemo()).toBe(true);
  expect(localStorage.getItem("mail-desktop-demo-v1")).toContain(
    "private@example.com",
  );
  const { invoke } = await import("@tauri-apps/api/core");
  expect(invoke).not.toHaveBeenCalled();
});
