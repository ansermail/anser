// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { MailAttachmentNotice, MailAttachments } from "./mail-attachments";
import { call } from "../lib/api";
import { toast } from "sonner";
vi.mock("../lib/api", () => ({ native: true, call: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), info: vi.fn() } }));
let root: Root, host: HTMLDivElement;
const attachments = [
  { index: 4, name: "合同.pdf", size: 1200, mime: "application/pdf" },
];
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  vi.clearAllMocks();
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});
const button = (label: string) =>
  host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;

it("opens the indexed attachment directly and keeps Save As a separate action", async () => {
  const download = vi.fn(async () => {});
  vi.mocked(call).mockResolvedValue(undefined);
  await act(async () =>
    root.render(
      <MailAttachments
        mailId="selected-message"
        attachments={attachments}
        onDownload={download}
      />,
    ),
  );
  await act(async () => button("预览附件 合同.pdf").click());
  expect(call).toHaveBeenCalledExactlyOnceWith("preview_attachment", {
    id: "selected-message",
    index: 4,
  });
  expect(download).not.toHaveBeenCalled();
  await act(async () => button("下载附件 合同.pdf").click());
  expect(download).toHaveBeenCalledExactlyOnceWith(4, "合同.pdf");
  expect(call).toHaveBeenCalledTimes(1);
});

it("uses a bounded real thumbnail for supported image attachments", async () => {
  vi.mocked(call).mockResolvedValue("data:image/png;base64,AA==");
  await act(async () =>
    root.render(
      <MailAttachments
        mailId="image-message"
        attachments={[
          {
            index: 7,
            name: "logo-188.png",
            size: 32 * 1024,
            mime: "image/png",
          },
        ]}
        onDownload={async () => {}}
      />,
    ),
  );
  expect(call).toHaveBeenCalledExactlyOnceWith("attachment_thumbnail", {
    id: "image-message",
    index: 7,
  });
  expect(host.querySelector(".attachment-thumb img")?.getAttribute("src")).toBe(
    "data:image/png;base64,AA==",
  );
  expect(host.querySelector(".attachment-thumb .attachment-type")).toBeNull();
});

it("prevents duplicate opens while loading and lets the user retry after an error", async () => {
  let reject!: (error: Error) => void;
  vi.mocked(call).mockImplementation(
    () =>
      new Promise((_, r) => {
        reject = r;
      }),
  );
  await act(async () =>
    root.render(
      <MailAttachments
        mailId="thread-message"
        attachments={attachments}
        onDownload={async () => {}}
      />,
    ),
  );
  await act(async () => button("预览附件 合同.pdf").click());
  expect(host.querySelector('[role="status"]')?.textContent).toContain(
    "正在打开",
  );
  expect(button("下载附件 合同.pdf").disabled).toBe(true);
  await act(async () => button("预览附件 合同.pdf").click());
  expect(call).toHaveBeenCalledTimes(1);
  await act(async () => reject(new Error("没有对应应用")));
  expect(toast.error).toHaveBeenCalledWith("Error: 没有对应应用");
  expect(button("预览附件 合同.pdf").disabled).toBe(false);
  vi.mocked(call).mockResolvedValue(undefined);
  await act(async () => button("预览附件 合同.pdf").click());
  expect(call).toHaveBeenCalledTimes(2);
});

it("does not open a damaged attachment or invoke native commands from demo data", async () => {
  await act(async () =>
    root.render(
      <MailAttachments
        mailId="demo-mail"
        demo
        attachments={[
          ...attachments,
          {
            ...attachments[0],
            index: 5,
            name: "损坏.pdf",
            error: "Base64 编码异常",
          },
        ]}
        onDownload={async () => {}}
      />,
    ),
  );
  expect(button("预览附件 损坏.pdf").disabled).toBe(true);
  expect(button("下载附件 损坏.pdf").disabled).toBe(true);
  await act(async () => button("预览附件 合同.pdf").click());
  expect(call).not.toHaveBeenCalled();
  expect(toast.info).toHaveBeenCalled();
});

it("shows a reported-only attachment notice without pretending a file exists", async () => {
  await act(async () => root.render(<MailAttachmentNotice reported />));
  expect(host.textContent).toContain("邮件标记了附件");
  expect(host.querySelector("button")).toBeNull();
});
