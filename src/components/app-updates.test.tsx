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
let latestForHistory: {
  version: string;
  currentVersion: string;
  body: string;
} | null = null;
async function defaultInvoke(command: string) {
  if (command !== "update_release_history") return;
  const next = latestForHistory!;
  return {
    currentVersion: next.currentVersion,
    targetVersion: next.version,
    releases: [
      {
        version: next.version,
        name: `Anser ${next.version}`,
        body: next.body,
        publishedAt: "2026-10-16T00:00:00Z",
      },
    ],
  };
}
const update = () => {
  const next = {
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
  };
  latestForHistory = next;
  return next;
};
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
  latestForHistory = null;
  mocks.check.mockReset();
  mocks.invoke.mockReset();
  mocks.native.mockReturnValue(true);
  mocks.check.mockResolvedValue(null);
  mocks.invoke.mockImplementation(defaultInvoke);
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
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === "open_mail_link") throw new Error("browser unavailable");
    return defaultInvoke(command);
  });
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
  let restartCount = 0;
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === "restart_for_update" && restartCount++ === 0)
      throw "restart failed";
    return defaultInvoke(command);
  });
  await click("检查更新");
  await click("下载更新");
  await click("安装并重启");
  expect(document.body.textContent).toContain("安装已完成，但重启失败");
  await click("重新启动");
  expect(next.install).toHaveBeenCalledOnce();
  expect(
    mocks.invoke.mock.calls.filter(
      ([command]) => command === "restart_for_update",
    ),
  ).toHaveLength(2);
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
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === "open_mail_link") throw new Error("browser unavailable");
    return defaultInvoke(command);
  });
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

function history(
  current = "0.1.18",
  target = "0.1.23",
  versions = ["0.1.23", "0.1.22", "0.1.21", "0.1.20", "0.1.19"],
) {
  return {
    currentVersion: current,
    targetVersion: target,
    releases: versions.map((version) => ({
      version,
      name: `Anser ${version}`,
      body: `## ${version} 的更新\n\n- 版本 ${version} 的重要内容`,
      publishedAt: "2026-10-16T00:00:00Z",
    })),
  };
}
it("shows the actual version count and every intervening version, rather than only the latest notes", async () => {
  const next = update();
  next.currentVersion = "0.1.18";
  next.version = "0.1.23";
  mocks.check.mockResolvedValue(next);
  mocks.invoke.mockImplementation(async (command) =>
    command === "update_release_history" ? history() : undefined,
  );
  await click("检查更新");
  expect(document.body.textContent).toContain("0.1.18 → 0.1.23 · 共 5 个版本");
  const notes = [...document.querySelectorAll(".release-notes")];
  expect(notes).toHaveLength(5);
  expect(notes.map((n) => n.querySelector("h2")?.textContent)).toEqual([
    "0.1.23 的更新",
    "0.1.22 的更新",
    "0.1.21 的更新",
    "0.1.20 的更新",
    "0.1.19 的更新",
  ]);
  expect(mocks.invoke).toHaveBeenCalledWith("update_release_history", {
    currentVersion: "0.1.18",
    targetVersion: "0.1.23",
  });
});
it("counts real released versions across gaps and explicitly identifies empty release notes", async () => {
  const next = update();
  next.currentVersion = "0.1.18";
  next.version = "0.1.23";
  const result = history(undefined, undefined, ["0.1.23", "0.1.20"]);
  result.releases[1].body = "";
  mocks.check.mockResolvedValue(next);
  mocks.invoke.mockResolvedValue(result);
  await click("检查更新");
  expect(document.body.textContent).toContain("共 2 个版本");
  expect(document.body.textContent).toContain("此版本未提供更新说明。");
  expect(document.body.textContent).not.toContain("v0.1.21");
});
it("history failure is explicit, retains target notes and download, and can retry without checking the update again", async () => {
  const next = update();
  mocks.check.mockResolvedValue(next);
  let requests = 0;
  mocks.invoke.mockImplementation(async (command) => {
    if (command === "update_release_history" && requests++ === 0)
      throw new Error("GitHub 请求受限");
    return defaultInvoke(command);
  });
  await click("检查更新");
  expect(document.body.textContent).toContain(
    "版本历史未能完整加载，当前仅展示目标版本说明",
  );
  expect(document.body.textContent).toContain(next.body);
  expect(button("下载更新").disabled).toBe(false);
  expect(document.body.textContent).not.toContain("共 1 个版本");
  await click("重新加载更新记录");
  expect(document.body.textContent).toContain("共 1 个版本");
  expect(document.body.textContent).not.toContain("版本历史未能完整加载");
  expect(mocks.check).toHaveBeenCalledOnce();
});
it("rejects history for another range and cannot call it a complete version list", async () => {
  const next = update();
  mocks.check.mockResolvedValue(next);
  mocks.invoke.mockResolvedValue(history());
  await click("检查更新");
  expect(document.body.textContent).toContain("版本历史未能完整加载");
  expect(document.body.textContent).toContain(next.body);
  expect(document.body.textContent).not.toContain("共 5 个版本");
});
it("discards a late earlier history after a newer target is selected", async () => {
  const old = update();
  mocks.check.mockResolvedValue(old);
  let resolveOld!: (data: unknown) => void;
  mocks.invoke.mockImplementation((command) =>
    command === "update_release_history"
      ? new Promise((resolve) => {
          resolveOld = resolve;
        })
      : Promise.resolve(),
  );
  await click("检查更新");
  expect(document.body.textContent).toContain("正在获取各版本更新记录");
  const next = update();
  next.currentVersion = "0.1.18";
  next.version = "0.1.23";
  mocks.check.mockResolvedValue(next);
  mocks.invoke.mockResolvedValue(history());
  await click("检查更新");
  expect(document.body.textContent).toContain("共 5 个版本");
  await act(async () => resolveOld(history("0.1.0", "0.2.0", ["0.2.0"])));
  expect(document.body.textContent).toContain("共 5 个版本");
  expect(document.body.textContent).not.toContain("0.2.0 的更新");
});
it("closing an in-flight history ignores its result and reopens with the current list", async () => {
  const next = update();
  mocks.check.mockResolvedValue(next);
  let finish!: (data: unknown) => void;
  mocks.invoke.mockImplementation((command) =>
    command === "update_release_history"
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : Promise.resolve(),
  );
  await click("检查更新");
  await click("Close");
  await act(async () => finish(history()));
  mocks.invoke.mockImplementation(defaultInvoke);
  await click("查看更新");
  expect(document.body.textContent).toContain("共 1 个版本");
  expect(document.body.textContent).toContain(next.body);
  expect(document.body.textContent).not.toContain("共 5 个版本");
});
it("does not query public release history from the web preview", async () => {
  mocks.native.mockReturnValue(false);
  await act(async () => root.render(<Harness />));
  expect(button("检查更新").disabled).toBe(true);
  expect(
    mocks.invoke.mock.calls.filter(
      ([command]) => command === "update_release_history",
    ),
  ).toHaveLength(0);
});
