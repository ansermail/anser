// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, expect, it, vi } from "vitest";
import { MailTranslationSettings } from "./mail-translation-settings";
import { toast } from "sonner";
const api = vi.hoisted(() => vi.fn());
vi.mock("../lib/api", () => ({ call: (...args: unknown[]) => api(...args) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
});
it("keeps API keys out of public config, clears the input after saving, and tests only fixed synthetic text", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const saved = {
    baseUrl: "https://model.example/v1",
    model: "test",
    targetLanguage: "zh-CN",
    revision: "r1",
    hasApiKey: true,
  };
  api.mockImplementation((command: string, args: Record<string, unknown>) => {
    if (command === "get_translation_settings") return Promise.resolve(saved);
    if (command === "save_translation_settings")
      return Promise.resolve({
        ...(args.config as object),
        revision: "r2",
        hasApiKey: true,
      });
    if (command === "test_translation_settings")
      return Promise.resolve([{ id: "p0_t0", text: "你好，世界。" }]);
    return Promise.resolve();
  });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<MailTranslationSettings />));
    const input = host.querySelector<HTMLInputElement>("#translation-key")!;
    expect(input.type).toBe("password");
    expect(input.value).toBe("");
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(input, "synthetic-unit-test-key");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () =>
      host
        .querySelector("form")!
        .dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        ),
    );
    const savedArgs = api.mock.calls.find(
      (c) => c[0] === "save_translation_settings",
    )![1];
    expect(savedArgs.apiKey).toBe("synthetic-unit-test-key");
    expect(savedArgs.config).not.toHaveProperty("apiKey");
    expect(input.value).toBe("");
    await act(async () =>
      [...host.querySelectorAll("button")]
        .find((b) => b.textContent === "测试已保存配置")!
        .click(),
    );
    const args = api.mock.calls.find(
      (c) => c[0] === "test_translation_settings",
    )![1];
    expect(args).toEqual({ requestId: expect.any(String), revision: "r2" });
    expect(api.mock.calls.some((c) => c[0] === "translate_mail_parts")).toBe(
      false,
    );
    expect(toast.success).toHaveBeenCalledWith("连接成功：你好，世界。");
    vi.mocked(toast.success).mockClear();
    api.mockImplementation((command: string) =>
      command === "test_translation_settings"
        ? Promise.reject(new Error("模型服务返回 HTTP 401"))
        : Promise.resolve(),
    );
    await act(async () =>
      [...host.querySelectorAll("button")]
        .find((b) => b.textContent === "测试已保存配置")!
        .click(),
    );
    const tests = api.mock.calls.filter(
      (c) => c[0] === "test_translation_settings",
    );
    expect(tests).toHaveLength(2);
    expect(tests[1][1].requestId).not.toBe(args.requestId);
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("401"));
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("401");
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

const savedConfig = {
  baseUrl: "https://api.deepseek.com",
  model: "deepseek-flash",
  targetLanguage: "zh-CN",
  revision: "r1",
  hasApiKey: true,
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function button(host: HTMLElement, text: string) {
  return [...host.querySelectorAll("button")].find(
    (b) => b.textContent === text,
  )!;
}

it.each(["success", "failure"])(
  "cancels a pending test and ignores its late %s during a new test",
  async (outcome) => {
    const first = deferred<{ id: string; text: string }[]>();
    const second = deferred<{ id: string; text: string }[]>();
    const cancellation = deferred<void>();
    let attempts = 0;
    api.mockImplementation((command: string) => {
      if (command === "get_translation_settings")
        return Promise.resolve(savedConfig);
      if (command === "test_translation_settings")
        return ++attempts === 1 ? first.promise : second.promise;
      if (command === "cancel_translation") return cancellation.promise;
      return Promise.resolve();
    });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    try {
      await act(async () => root.render(<MailTranslationSettings />));
      await act(async () => button(host, "测试已保存配置").click());
      const requestId = api.mock.calls.find(
        (c) => c[0] === "test_translation_settings",
      )![1].requestId;
      expect(button(host, "测试中…").disabled).toBe(true);
      expect(button(host, "保存翻译配置").disabled).toBe(true);
      expect(host.querySelector('[role="status"]')?.textContent).toContain(
        "固定测试文本",
      );
      await act(async () => button(host, "取消测试").click());
      expect(api).toHaveBeenCalledWith("cancel_translation", { requestId });
      expect(button(host, "正在取消…").disabled).toBe(true);
      await act(async () => cancellation.resolve());
      expect(host.textContent).toContain("测试已取消");
      await act(async () => button(host, "测试已保存配置").click());
      await act(async () => {
        if (outcome === "success")
          first.resolve([{ id: "p0_t0", text: "过期结果" }]);
        else first.reject("过期失败");
      });
      expect(button(host, "测试中…").disabled).toBe(true);
      expect(host.textContent).not.toContain("过期");
      expect(toast.success).not.toHaveBeenCalled();
      expect(toast.error).not.toHaveBeenCalled();
      await act(async () => second.resolve([{ id: "p0_t0", text: "新结果" }]));
      expect(host.querySelector('[role="status"]')?.textContent).toBe(
        "连接成功：新结果",
      );
      expect(button(host, "测试已保存配置").disabled).toBe(false);
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  },
);

it("cancels on unmount without displaying a late result", async () => {
  const response = deferred<{ id: string; text: string }[]>();
  api.mockImplementation((command: string) => {
    if (command === "get_translation_settings")
      return Promise.resolve(savedConfig);
    if (command === "test_translation_settings") return response.promise;
    return Promise.resolve();
  });
  const host = document.createElement("div");
  const root = createRoot(host);
  await act(async () => root.render(<MailTranslationSettings />));
  await act(async () => button(host, "测试已保存配置").click());
  const requestId = api.mock.calls.find(
    (c) => c[0] === "test_translation_settings",
  )![1].requestId;
  await act(async () => root.unmount());
  expect(api).toHaveBeenCalledWith("cancel_translation", { requestId });
  await act(async () => response.resolve([{ id: "p0_t0", text: "过期结果" }]));
  expect(toast.success).not.toHaveBeenCalled();
  expect(toast.error).not.toHaveBeenCalled();
});

it("discovers the current service models, allows switching IDs, and requires saving before testing the new model", async () => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Element.prototype.scrollIntoView = vi.fn();
  const cfg = { ...savedConfig };
  api.mockImplementation((command: string, args: Record<string, unknown>) => {
    if (command === "get_translation_settings") return Promise.resolve(cfg);
    if (command === "get_translation_models")
      return Promise.resolve([
        { id: "deepseek-flash", name: "DeepSeek Flash" },
        { id: "other-model", name: "Other model" },
      ]);
    if (command === "save_translation_settings")
      return Promise.resolve({
        ...(args.config as object),
        revision: "r2",
        hasApiKey: true,
      });
    return Promise.resolve();
  });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<MailTranslationSettings />));
    await act(async () => button(host, "获取模型列表").click());
    const request = api.mock.calls.find(
      (c) => c[0] === "get_translation_models",
    )![1];
    expect(request.config.baseUrl).toBe("https://api.deepseek.com");
    expect(request.apiKey).toBe("");
    expect(
      api.mock.calls.some((c) => c[0] === "save_translation_settings"),
    ).toBe(false);
    const choice = [
      ...document.querySelectorAll<HTMLElement>("[cmdk-item]"),
    ].find((e) => e.textContent?.includes("Other model"))!;
    expect(choice).toBeTruthy();
    await act(async () => choice.click());
    expect(
      host.querySelector<HTMLInputElement>("#translation-model")!.value,
    ).toBe("other-model");
    expect(button(host, "测试已保存配置").disabled).toBe(true);
    expect(host.textContent).toContain("尚未保存");
    await act(async () =>
      host
        .querySelector("form")!
        .dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        ),
    );
    expect(
      api.mock.calls.find((c) => c[0] === "save_translation_settings")![1]
        .config.model,
    ).toBe("other-model");
    expect(button(host, "测试已保存配置").disabled).toBe(false);
  } finally {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  }
});

it("does not forward a typed key when the service address changes and ignores late cancelled model discovery", async () => {
  const response = deferred<{ id: string; name: string }[]>();
  api.mockImplementation((command: string) => {
    if (command === "get_translation_settings")
      return Promise.resolve(savedConfig);
    if (command === "get_translation_models") return response.promise;
    return Promise.resolve();
  });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<MailTranslationSettings />));
    const edit = async (id: string, value: string) => {
      await act(async () => {
        const input = host.querySelector<HTMLInputElement>(id)!;
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )!.set!.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    };
    await edit("#translation-key", "fake-draft-key");
    await edit("#translation-url", "https://another.example/v1");
    expect(
      host.querySelector<HTMLInputElement>("#translation-key")!.value,
    ).toBe("");
    await act(async () => button(host, "获取模型列表").click());
    const request = api.mock.calls.find(
      (c) => c[0] === "get_translation_models",
    )![1];
    expect(request.apiKey).toBe("");
    expect(request.config.baseUrl).toBe("https://another.example/v1");
    await act(async () => button(host, "取消获取").click());
    expect(api).toHaveBeenCalledWith("cancel_translation", {
      requestId: request.requestId,
    });
    await act(async () =>
      response.resolve([{ id: "stale-model", name: "Stale model" }]),
    );
    expect(host.textContent).not.toContain("已获取 1 个模型");
    expect(
      host.querySelector<HTMLInputElement>("#translation-model")!.value,
    ).toBe("deepseek-flash");
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
