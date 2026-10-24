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
    "set_file_association",
    "prepare_eml_import",
    "eml_import_action",
  ]) {
    await expect(api.call(command, {})).rejects.toThrow("页面预览不连接邮箱");
  }
  expect(await api.call("get_file_associations")).toEqual({
    supported: false,
    busy: false,
    items: [],
  });
  api.leaveDemo();
  expect(await api.call("eml_import_jobs")).toEqual([]);
  await expect(api.call("eml_import_job", { id: "fake" })).rejects.toThrow(
    "示例模式不读取或导入本地文件",
  );
  expect(api.isDemo()).toBe(true);
  expect(localStorage.getItem("mail-desktop-demo-v1")).toContain(
    "private@example.com",
  );
  const saved = await api.call<{ revision: string; hasApiKey: boolean }>(
    "save_translation_settings",
    {
      config: {
        baseUrl: "https://model.invalid/v1",
        model: "demo",
        targetLanguage: "zh-CN",
      },
      apiKey: "synthetic-preview-key",
      clearKey: false,
    },
  );
  expect(saved.hasApiKey).toBe(false);
  const resultTest = await api.call("test_translation_settings", {
    requestId: crypto.randomUUID(),
    revision: saved.revision,
  });
  expect(resultTest).toEqual([
    { id: "p0_t0", text: "【演示结果】未连接真实模型。" },
  ]);
  expect(await api.call("get_translation_settings")).not.toHaveProperty(
    "apiKey",
  );
  expect(Object.values(localStorage).join("")).not.toContain(
    "synthetic-preview-key",
  );
  const { invoke } = await import("@tauri-apps/api/core");
  expect(invoke).not.toHaveBeenCalled();
});
