// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "@/lib/api";
import { DiagnosticLogsCard } from "./diagnostic-logs";

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

describe("DiagnosticLogsCard", () => {
  it("loads log status and exposes export and open-folder actions", async () => {
    vi.spyOn(api, "call").mockImplementation(async (command) => {
      if (command === "diagnostic_log_status") {
        return {
          path: "/tmp/anser/logs",
          fileCount: 2,
          totalBytes: 18432,
        } as never;
      }
      return null as never;
    });

    await act(async () => root.render(<DiagnosticLogsCard />));
    expect(host.textContent).toContain("本地诊断日志");
    expect(host.textContent).toContain("2 个文件 · 18 KB");
    expect(host.textContent).toContain("导出脱敏诊断日志");
    expect(host.textContent).toContain("打开日志目录");
  });
});
