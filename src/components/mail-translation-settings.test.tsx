// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, expect, it, vi } from "vitest";
import { MailTranslationSettings } from "./mail-translation-settings";
import { toast } from "sonner";
import { setInterfaceLanguage } from "../lib/i18n";
const api = vi.hoisted(() => vi.fn());
vi.mock("../lib/api", () => ({ call: (...args: unknown[]) => api(...args) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
});
it("keeps API keys out of public config and saves the model with backend validation", async () => {
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
    expect(
      api.mock.calls.some((c) => c[0] === "test_translation_settings"),
    ).toBe(false);
    expect(api.mock.calls.some((c) => c[0] === "translate_mail_parts")).toBe(
      false,
    );
    expect(toast.success).toHaveBeenCalledWith("模型配置已保存");
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

it("keeps a failed model validation unsaved in English", async () => {
  setInterfaceLanguage("en");
  api.mockImplementation(async (command: string) => {
    if (command === "get_translation_settings") return savedConfig;
    if (command === "save_translation_settings")
      return Promise.reject(
        new Error("Model connection failed. Configuration was not saved."),
      );
  });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<MailTranslationSettings />));
    expect(
      host.querySelector('[data-slot="badge"]:last-child')?.textContent,
    ).toBe("Saved");
    const model = host.querySelector<HTMLInputElement>("#translation-model")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(model, "different-model");
      model.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(host.textContent).toContain("Unsaved");
    await act(async () =>
      host
        .querySelector("form")!
        .dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        ),
    );
    expect(toast.error).toHaveBeenCalledWith(
      "Error: Model connection failed. Configuration was not saved.",
    );
    expect(toast.success).not.toHaveBeenCalled();
    expect(model.value).toBe("different-model");
    expect(host.textContent).toContain("Unsaved");
  } finally {
    await act(async () => root.unmount());
    host.remove();
    setInterfaceLanguage("zh-CN");
  }
});

it("requires a saved model before translation preferences are enabled", async () => {
  api.mockImplementation((command: string) => {
    if (command === "get_translation_settings") return Promise.resolve(null);
    return Promise.resolve();
  });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<MailTranslationSettings />));
    expect(
      host.querySelector<HTMLButtonElement>("#translation-language")!.disabled,
    ).toBe(true);
    expect(host.textContent).toContain("请先保存模型配置，再启用邮件翻译。");
    expect(button(host, "清除翻译缓存").disabled).toBe(true);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
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
    expect(button(host, "保存模型配置").disabled).toBe(false);
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
    expect(host.textContent).toContain("已保存");
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
