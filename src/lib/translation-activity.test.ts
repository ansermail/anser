// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
const platform = vi.hoisted(() => ({ native: false }));
vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => platform.native,
  invoke: vi.fn(),
}));
afterEach(() => {
  platform.native = false;
  localStorage.clear();
  vi.resetModules();
  vi.clearAllMocks();
});
it("demo translation records contain no source text and notify after persistence", async () => {
  const api = await import("./api");
  api.enterDemo();
  const notify = vi.fn(() => {
    expect(localStorage.getItem("mail-desktop-demo-v1")).toContain(
      "大模型正文翻译批次完成",
    );
  });
  window.addEventListener("anser-activity-changed", notify);
  try {
    await api.call("translate_mail_parts", {
      parts: [{ id: "p0_t0", text: "private-source-body" }],
    });
    expect(notify).toHaveBeenCalledTimes(1);
    const data = await api.snapshot({
      view: "all",
      accountId: "",
      folder: "",
      search: "",
      limit: 200,
      unreadOnly: false,
    });
    expect(data.logs[0]).toContain("【演示记录】");
    expect(data.logs.join("\n")).not.toContain("private-source-body");
    const { invoke } = await import("@tauri-apps/api/core");
    expect(invoke).not.toHaveBeenCalled();
  } finally {
    window.removeEventListener("anser-activity-changed", notify);
  }
});
it("native success and failure both request an activity refresh, unrelated commands do not", async () => {
  platform.native = true;
  const api = await import("./api");
  const { invoke } = await import("@tauri-apps/api/core");
  vi.mocked(invoke)
    .mockResolvedValueOnce([])
    .mockRejectedValueOnce(new Error("synthetic failure"))
    .mockResolvedValueOnce(null);
  const notify = vi.fn();
  window.addEventListener("anser-activity-changed", notify);
  try {
    await api.call("translate_mail_parts", {});
    expect(notify).toHaveBeenCalledTimes(1);
    await expect(api.call("test_translation_settings", {})).rejects.toThrow(
      "synthetic failure",
    );
    expect(notify).toHaveBeenCalledTimes(2);
    await api.call("get_translation_settings", {});
    expect(notify).toHaveBeenCalledTimes(2);
  } finally {
    window.removeEventListener("anser-activity-changed", notify);
  }
});
