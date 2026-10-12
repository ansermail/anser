// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { toast } from "sonner";
import {
  useAppUpdate,
  UpdateDialog,
  UpdateIndicator,
  UpdateSettings,
} from "./app-updates";
const mocks = vi.hoisted(() => ({
  check: vi.fn(),
  invoke: vi.fn(),
  native: vi.fn(() => true),
}));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: mocks.check }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: async () => "0.1.0" }));
vi.mock("@tauri-apps/api/core", () => ({
  isTauri: mocks.native,
  invoke: mocks.invoke,
}));
let host: HTMLDivElement, root: Root;
let blocked = false;
const update = () => ({
  version: "0.2.0",
  currentVersion: "0.1.0",
  body: "修复邮件收取",
  close: vi.fn(async () => {}),
  download: vi.fn(async (cb) => {
    cb({ event: "Started", data: { contentLength: 100 } });
    cb({ event: "Progress", data: { chunkLength: 100 } });
    cb({ event: "Finished" });
  }),
  install: vi.fn(async () => {}),
});
function Harness() {
  const u = useAppUpdate();
  return (
    <>
      <UpdateIndicator updates={u} />
      <UpdateSettings updates={u} />
      <UpdateDialog updates={u} blocked={blocked} />
    </>
  );
}
function button(text: string) {
  return [...document.querySelectorAll("button")].find(
    (b) => b.textContent === text,
  )!;
}
async function click(text: string) {
  await act(async () => button(text).click());
}
beforeEach(async () => {
  vi.stubEnv("DEV", false);
  blocked = false;
  mocks.check.mockReset();
  mocks.invoke.mockReset();
  mocks.native.mockReturnValue(true);
  mocks.check.mockResolvedValue(null);
  mocks.invoke.mockResolvedValue(undefined);
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<Harness />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllEnvs();
});
it("uses the running application's version rather than the frontend package version", () => {
  expect(host.textContent).toContain("雁信 0.1.0");
});
it("hides the top entry without an available update and displays release notes when one exists", async () => {
  expect(
    document.querySelector('[aria-label="有新版本，打开更新中心"]'),
  ).toBeNull();
  await click("检查更新");
  expect(document.body.textContent).toContain("当前没有可用更新");
  await act(async () => button("Close")?.click());
  const next = update();
  mocks.check.mockResolvedValue(next);
  await click("检查更新");
  expect(
    document.querySelector('[aria-label="有新版本，打开更新中心"]'),
  ).not.toBeNull();
  expect(document.body.textContent).toContain("修复邮件收取");
});
it("renders Markdown release notes and sanitizes unsafe content", async () => {
  const next = update();
  next.body =
    '## 更新内容\n\n- **修复**邮件收取\n- `收件箱`\n\n[发布说明](https://github.com/ansermail/anser/releases/tag/v0.2.0)\n\n![安全图片](https://github.com/ansermail/anser/image.png) ![危险图片](javascript:alert(1))\n\n<script>alert(1)</script><a href="javascript:alert(1)">危险链接</a>';
  mocks.check.mockResolvedValue(next);
  await click("检查更新");
  const notes = document.querySelector(".release-notes")!;
  expect(notes.querySelector("h2")?.textContent).toBe("更新内容");
  expect(notes.querySelectorAll("li")).toHaveLength(2);
  expect(notes.querySelector("strong")?.textContent).toBe("修复");
  expect(notes.querySelector("code")?.textContent).toBe("收件箱");
  expect(notes.querySelector("script")).toBeNull();
  expect(notes.querySelectorAll("img")).toHaveLength(1);
  expect(notes.querySelector("img")?.getAttribute("alt")).toBe("安全图片");
  expect(notes.querySelector("a:not([href])")?.textContent).toBe("危险链接");
  const link = notes.querySelector<HTMLAnchorElement>("a[href]")!;
  const event = new MouseEvent("click", { bubbles: true, cancelable: true });
  await act(async () => link.dispatchEvent(event));
  expect(event.defaultPrevented).toBe(true);
  expect(mocks.invoke).toHaveBeenCalledWith("open_mail_link", {
    url: "https://github.com/ansermail/anser/releases/tag/v0.2.0",
  });
});
it("reports a release note link opening failure", async () => {
  const error = vi.spyOn(toast, "error").mockReturnValue(0);
  const next = update();
  next.body = "[详情](https://github.com/ansermail/anser)";
  mocks.check.mockResolvedValue(next);
  mocks.invoke.mockRejectedValueOnce(new Error("browser unavailable"));
  await click("检查更新");
  await act(async () =>
    document.querySelector<HTMLAnchorElement>(".release-notes a")!.click(),
  );
  expect(error).toHaveBeenCalledWith(
    "无法打开更新说明链接：Error: browser unavailable",
  );
  error.mockRestore();
});
it("downloads first and installs only on explicit confirmation, then restarts", async () => {
  const next = update();
  mocks.check.mockResolvedValue(next);
  await click("检查更新");
  await click("下载更新");
  expect(next.install).not.toHaveBeenCalled();
  expect(document.body.textContent).toContain("下载及签名校验完成");
  await click("安装并重启");
  expect(next.install).toHaveBeenCalledOnce();
  expect(mocks.invoke).toHaveBeenCalledWith("restart_for_update");
});
it("never installs after download or signature failure and supports a download retry", async () => {
  const next = update();
  next.download.mockRejectedValueOnce(new Error("signature mismatch"));
  mocks.check.mockResolvedValue(next);
  await click("检查更新");
  await click("下载更新");
  expect(document.body.textContent).toContain("签名校验失败");
  expect(next.install).not.toHaveBeenCalled();
  await click("下载更新");
  expect(document.body.textContent).toContain("下载及签名校验完成");
});
it("preserves the downloaded update while manual checks and the timer would run", async () => {
  const next = update();
  mocks.check.mockResolvedValue(next);
  await click("检查更新");
  await click("下载更新");
  expect(button("检查更新").disabled).toBe(true);
  expect(next.close).not.toHaveBeenCalled();
});
it("retrying a restart does not install the package twice", async () => {
  const next = update();
  mocks.check.mockResolvedValue(next);
  mocks.invoke.mockRejectedValueOnce("restart failed");
  await click("检查更新");
  await click("下载更新");
  await click("安装并重启");
  expect(document.body.textContent).toContain("安装已完成，但重启失败");
  await click("重新启动");
  expect(next.install).toHaveBeenCalledOnce();
  expect(mocks.invoke).toHaveBeenCalledTimes(2);
});
it("blocks installation while a compose window is open", async () => {
  blocked = true;
  await act(async () => root.render(<Harness />));
  const next = update();
  mocks.check.mockResolvedValue(next);
  await click("检查更新");
  await click("下载更新");
  expect(button("安装并重启").disabled).toBe(true);
  expect(next.install).not.toHaveBeenCalled();
});
it("does not install into the development app", async () => {
  vi.stubEnv("DEV", true);
  await act(async () => root.render(<Harness />));
  const next = update();
  mocks.check.mockResolvedValue(next);
  await click("检查更新");
  expect(button("下载更新").disabled).toBe(true);
  expect(next.download).not.toHaveBeenCalled();
});
it("opens the project repository through the desktop's default browser command", async () => {
  const link = host.querySelector<HTMLAnchorElement>(
    'a[href="https://github.com/ansermail/anser"]',
  )!;
  const event = new MouseEvent("click", { bubbles: true, cancelable: true });
  await act(async () => link.dispatchEvent(event));
  expect(event.defaultPrevented).toBe(true);
  expect(mocks.invoke).toHaveBeenCalledWith("open_mail_link", {
    url: "https://github.com/ansermail/anser",
  });
});
it("reports a browser opening failure instead of silently ignoring the repository click", async () => {
  const error = vi.spyOn(toast, "error").mockReturnValue(0);
  mocks.invoke.mockRejectedValueOnce(new Error("browser unavailable"));
  await act(async () =>
    host
      .querySelector<HTMLAnchorElement>(
        'a[href="https://github.com/ansermail/anser"]',
      )!
      .click(),
  );
  expect(error).toHaveBeenCalledWith(
    "无法打开项目仓库：Error: browser unavailable",
  );
  error.mockRestore();
});
