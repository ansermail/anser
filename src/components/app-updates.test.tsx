// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
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
