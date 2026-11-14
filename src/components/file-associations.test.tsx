// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FileAssociations } from "./file-associations";
import { setInterfaceLanguage } from "@/lib/i18n";
const mocks = vi.hoisted(() => ({
  call: vi.fn(),
  demo: false,
  windows: false,
}));
vi.mock("@/lib/api", () => ({
  call: mocks.call,
  native: true,
  isDemo: () => mocks.demo,
}));
vi.mock("@/lib/platform", () => ({
  isWindows: () => mocks.windows,
}));
let root: Root, host: HTMLDivElement;
let server: {
  supported: boolean;
  busy: boolean;
  mailClient: {
    supported: boolean;
    busy: boolean;
    currentName: string;
    currentId: string;
    isDefault: boolean;
  };
  items: {
    extension: string;
    currentName: string;
    currentId: string;
    isDefault: boolean;
    applications: { id: string; name: string }[];
  }[];
};
function control() {
  return document.querySelector<HTMLButtonElement>('[role="switch"]')!;
}
async function render() {
  await act(async () => root.render(<FileAssociations />));
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  setInterfaceLanguage("zh-CN");
  mocks.demo = false;
  mocks.windows = false;
  mocks.call.mockReset();
  server = {
    supported: true,
    busy: false,
    mailClient: {
      supported: true,
      busy: false,
      currentName: "Thunderbird",
      currentId: "org.mozilla.thunderbird",
      isDefault: false,
    },
    items: [
      {
        extension: "eml",
        currentName: "Mail",
        currentId: "com.apple.mail",
        isDefault: false,
        applications: [
          { id: "self", name: "Anser" },
          { id: "com.apple.mail", name: "Mail" },
        ],
      },
    ],
  };
  mocks.call.mockImplementation(async (command, args) => {
    if (command === "get_file_associations") return structuredClone(server);
    if (command === "get_default_mail_client")
      return structuredClone(server.mailClient);
    if (command === "set_file_association") {
      server.items[0].isDefault = args.application === "self";
      server.items[0].currentId =
        args.application === "previous" ? "com.apple.mail" : args.application;
      return;
    }
    if (command === "set_default_mail_client") {
      server.mailClient.isDefault = true;
      server.mailClient.currentName = "Anser";
      server.mailClient.currentId = "self";
      return;
    }
    if (command === "open_file_association_settings") return;
    throw new Error(command);
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
it("reads actual associations without changing defaults and verifies an explicit enable", async () => {
  await render();
  expect(control().getAttribute("aria-checked")).toBe("false");
  expect(mocks.call.mock.calls.map((x) => x[0])).toEqual([
    "get_file_associations",
    "get_default_mail_client",
  ]);
  await act(async () => control().click());
  expect(mocks.call).toHaveBeenCalledWith("set_file_association", {
    extension: "eml",
    application: "self",
  });
  expect(control().getAttribute("aria-checked")).toBe("true");
  expect(
    mocks.call.mock.calls.filter(
      ([command]) => command === "get_file_associations",
    ),
  ).toHaveLength(2);
});
it("sets Anser as the default mail client and rereads the actual system state", async () => {
  await render();
  expect(document.body.textContent).toContain("当前默认：Thunderbird");
  const button = [...document.querySelectorAll("button")].find(
    (item) => item.textContent === "设为默认邮件应用",
  )!;
  await act(async () => button.click());
  expect(mocks.call).toHaveBeenCalledWith("set_default_mail_client");
  expect(document.body.textContent).toContain("雁信已是默认邮件应用");
  expect(document.body.textContent).toContain("已是默认");
});
it("does not report success when macOS keeps another default mail client", async () => {
  await render();
  mocks.call.mockImplementation(async (command) => {
    if (command === "get_file_associations") return structuredClone(server);
    if (command === "get_default_mail_client")
      return structuredClone(server.mailClient);
    if (command === "set_default_mail_client") return;
    throw new Error(command);
  });
  const button = [...document.querySelectorAll("button")].find(
    (item) => item.textContent === "设为默认邮件应用",
  )!;
  await act(async () => button.click());
  expect(document.body.textContent).toContain("macOS 未完成更改");
  expect(document.body.textContent).not.toContain("雁信已是默认邮件应用");
});
it("disables directly by restoring the recorded app without a menu or dialog", async () => {
  server.items[0].isDefault = true;
  server.items[0].currentId = "self";
  await render();
  await act(async () => control().click());
  expect(mocks.call).toHaveBeenCalledWith("set_file_association", {
    extension: "eml",
    application: "previous",
  });
  expect(control().getAttribute("aria-checked")).toBe("false");
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(document.querySelector('[role="combobox"]')).toBeNull();
});
it("failed or delayed OS change never displays an optimistic association", async () => {
  await render();
  mocks.call.mockImplementation(async (command) => {
    if (command === "set_file_association")
      throw new Error("associationPending");
    return structuredClone(server);
  });
  await act(async () => control().click());
  expect(control().getAttribute("aria-checked")).toBe("false");
  expect(document.body.textContent).toContain("macOS 仍在处理更改");
});
it("keeps manual refresh available while the OS is processing and disables another mutation", async () => {
  server.busy = true;
  await render();
  expect(control().disabled).toBe(true);
  const refresh = [...document.querySelectorAll("button")].find(
    (b) => b.textContent === "刷新",
  )!;
  expect(refresh.disabled).toBe(false);
});
it("ignores old reads after a newer focus refresh", async () => {
  let release!: (value: typeof server) => void;
  mocks.call.mockImplementationOnce(
    () =>
      new Promise((r) => {
        release = r;
      }),
  );
  await render();
  server.items[0].isDefault = true;
  server.items[0].currentId = "self";
  await act(async () => window.dispatchEvent(new Event("focus")));
  await act(async () =>
    release({
      ...server,
      items: [
        { ...server.items[0], isDefault: false, currentId: "com.apple.mail" },
      ],
    }),
  );
  expect(control().getAttribute("aria-checked")).toBe("true");
});
it("sample mode never reads or changes system associations", async () => {
  mocks.demo = true;
  await render();
  expect(mocks.call).not.toHaveBeenCalled();
  for (const button of document.querySelectorAll<HTMLButtonElement>(
    '[role="switch"]',
  ))
    expect(button.disabled).toBe(true);
});
it("opens Windows default app settings without writing the default directly", async () => {
  mocks.windows = true;
  server.supported = false;
  server.items = [];
  server.mailClient.supported = false;
  await render();
  const button = [...document.querySelectorAll("button")].find(
    (item) => item.textContent === "打开 Windows 默认应用",
  )!;
  await act(async () => button.click());
  expect(mocks.call).toHaveBeenCalledWith("open_file_association_settings");
  expect(
    mocks.call.mock.calls.some(
      ([command]) => command === "set_default_mail_client",
    ),
  ).toBe(false);
});
