// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { EmlImports, type ImportJob } from "./eml-imports";
import { setInterfaceLanguage } from "@/lib/i18n";
import type { Account } from "@/lib/types";
const mocks = vi.hoisted(() => ({
  call: vi.fn(),
  select: vi.fn(),
  demo: false,
}));
vi.mock("@/lib/api", () => ({
  call: mocks.call,
  native: true,
  isDemo: () => mocks.demo,
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: mocks.select }));
let root: Root, host: HTMLDivElement, server: ImportJob;
const view = vi.fn(),
  changed = vi.fn(async () => {});
const accounts = [
  { id: "sample", name: "示例", email: "sample@example.com" },
] as Account[];
function button(text: string) {
  return [...document.querySelectorAll("button")].find(
    (b) => b.textContent === text,
  )!;
}
async function click(text: string) {
  await act(async () => {
    expect(button(text)).toBeTruthy();
    button(text).click();
  });
}
async function render(taskPanel = false) {
  await act(async () =>
    root.render(
      <EmlImports
        accounts={accounts}
        folders={["Saved"]}
        taskPanel={taskPanel}
        onView={view}
        onChanged={changed}
      />,
    ),
  );
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  setInterfaceLanguage("zh-CN");
  mocks.demo = false;
  mocks.call.mockReset();
  mocks.select.mockReset();
  view.mockReset();
  changed.mockClear();
  mocks.select.mockResolvedValue(["/virtual/sample.eml"]);
  server = {
    id: "job",
    accountId: "sample",
    folder: "导入邮件",
    status: "prepared",
    total: 1,
    bytes: 500,
    processed: 0,
    added: 0,
    upgraded: 0,
    duplicate: 0,
    failed: 0,
    warnings: 0,
    error: "",
    items: [
      {
        ordinal: 0,
        filename: "sample.eml",
        status: "pending",
        error: "",
        warnings: 0,
        mailId: "",
      },
    ],
  };
  mocks.call.mockImplementation(async (command, args) => {
    if (command === "prepare_eml_import") return structuredClone(server);
    if (command === "eml_import_job") return structuredClone(server);
    if (command === "eml_import_jobs")
      return server.status === "prepared" ? [] : [structuredClone(server)];
    if (command === "eml_import_action") {
      if (args.action === "start") server.status = "running";
      if (args.action === "cancel") server.status = "cancelled";
    }
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("selects files natively, shows local-only scope and keeps a started task running after closing", async () => {
  await render();
  await click("导入邮件");
  expect(document.body.textContent).toContain(
    "仅保存在本机，不会上传到邮箱服务器。",
  );
  await click("选择邮件文件");
  expect(
    document
      .querySelector('[role="progressbar"]')
      ?.getAttribute("aria-valuenow"),
  ).toBe("0");
  expect(mocks.select).toHaveBeenCalledWith(
    expect.objectContaining({ multiple: true, directory: false }),
  );
  expect(mocks.call).toHaveBeenCalledWith("prepare_eml_import", {
    paths: ["/virtual/sample.eml"],
    accountId: "sample",
    folder: "导入邮件",
  });
  await click("开始导入");
  await click("在后台继续");
  expect(
    mocks.call.mock.calls.filter(
      ([c, a]) => c === "eml_import_action" && a.action === "cancel",
    ),
  ).toHaveLength(0);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});
it("discards a late precheck result when its dialog was closed", async () => {
  let resolve!: (value: ImportJob) => void;
  const pending = new Promise<ImportJob>((r) => {
    resolve = r;
  });
  mocks.call.mockImplementation(async (command) =>
    command === "prepare_eml_import" ? pending : undefined,
  );
  await render();
  await click("导入邮件");
  await act(async () => {
    button("选择邮件文件").click();
  });
  await click("关闭");
  await act(async () => {
    resolve(server);
    await pending;
  });
  expect(mocks.call).toHaveBeenCalledWith("eml_import_action", {
    id: "job",
    action: "cancel",
  });
  expect(mocks.call).toHaveBeenCalledWith("eml_import_action", {
    id: "job",
    action: "clear",
  });
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});
it("canceling retains completed counts and allows navigating to the fixed target", async () => {
  await render();
  await click("导入邮件");
  await click("选择邮件文件");
  await click("开始导入");
  server.added = 1;
  server.processed = 1;
  await click("取消导入");
  expect(document.body.textContent).toContain("新增 1");
  expect(document.body.textContent).toContain("导入已取消");
  await click("查看导入邮件");
  expect(view).toHaveBeenCalledWith("sample", "导入邮件");
});
it("shows fixed error categories without exposing native path or raw error details", async () => {
  mocks.call.mockRejectedValue(
    new Error("/Users/private/secret.eml: database native detail"),
  );
  await render();
  await click("导入邮件");
  await click("选择邮件文件");
  expect(document.body.textContent).toContain("无法继续导入");
  expect(document.body.textContent).not.toContain("/Users/private");
});
it("sample mode never opens the native file picker", async () => {
  mocks.demo = true;
  await render();
  await click("导入邮件");
  expect(button("选择邮件文件").disabled).toBe(true);
  expect(document.body.textContent).toContain("示例模式不读取或导入本地文件。");
  expect(mocks.select).not.toHaveBeenCalled();
});
it("shows task results with file warnings and supports clearing only the task record", async () => {
  server.status = "completed";
  server.processed = 1;
  server.added = 1;
  server.warnings = 1;
  server.items[0] = {
    ...server.items[0],
    status: "added",
    warnings: 1,
    mailId: "mail",
  };
  await render(true);
  await act(async () => {
    host
      .querySelector('[aria-label="展开或收起邮件导入任务"]')
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await click("导入详情");
  expect(document.body.textContent).toContain(
    "已保留原件，部分内容存在解码警告。",
  );
  await click("关闭");
  await click("清除任务记录");
  expect(mocks.call).toHaveBeenCalledWith("eml_import_action", {
    id: "job",
    action: "clear",
  });
});

it("a delayed task refresh cannot restore a cleared task record", async () => {
  vi.useFakeTimers();
  server.status = "completed";
  let resolve!: (jobs: ImportJob[]) => void;
  const delayed = new Promise<ImportJob[]>((r) => {
    resolve = r;
  });
  let reads = 0;
  mocks.call.mockImplementation(async (command) => {
    if (command === "eml_import_jobs") {
      reads++;
      return reads === 1
        ? [structuredClone(server)]
        : reads === 2
          ? delayed
          : [];
    }
  });
  await render(true);
  await act(async () => {
    host
      .querySelector<HTMLButtonElement>(
        '[aria-label="展开或收起邮件导入任务"]',
      )!
      .click();
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3000);
  });
  await click("清除任务记录");
  await act(async () => {
    resolve([structuredClone(server)]);
    await delayed;
  });
  expect(button("清除任务记录")).toBeUndefined();
  expect(host.textContent).toContain("暂无邮件导入任务。");
});

it("a delayed detail poll cannot put a canceled import back into the running state", async () => {
  vi.useFakeTimers();
  await render();
  await click("导入邮件");
  await click("选择邮件文件");
  await click("开始导入");
  const old = structuredClone(server);
  let resolve!: (job: ImportJob) => void;
  const delayed = new Promise<ImportJob>((r) => {
    resolve = r;
  });
  const previous = mocks.call.getMockImplementation()!;
  mocks.call.mockImplementation((command, args) =>
    command === "eml_import_job" && server.status === "running"
      ? delayed
      : previous(command, args),
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
  await click("取消导入");
  await act(async () => {
    resolve(old);
    await delayed;
  });
  expect(document.body.textContent).toContain("导入已取消");
  expect(button("取消导入")).toBeUndefined();
});
