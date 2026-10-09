// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import {
  emptySignature,
  signatureContent,
  importSignature,
} from "./signatures";
describe("signature imports", () => {
  it("does not activate an empty signature and keeps account identity", () => {
    const value = signatureContent("a", { ...emptySignature(), enabled: true });
    expect(value.included).toBe(false);
    expect(value.accountId).toBe("a");
  });
  it("renders HTML with a plain alternative and removes active content", () => {
    const value = signatureContent("a", {
      ...emptySignature(),
      enabled: true,
      useHtml: true,
      text: '<b>Alex</b><script>alert(1)</script><img src="x" onerror="bad()">',
    });
    expect(value.included).toBe(true);
    expect(value.body).toContain("Alex");
    expect(value.html).not.toMatch(/<script|onerror/);
  });
  it("rejects unsupported and oversized signature files", async () => {
    await expect(
      importSignature(new File(["x"], "unsafe.svg", { type: "image/svg+xml" })),
    ).rejects.toThrow("请选择");
    await expect(
      importSignature(new File(["x".repeat(2 * 1024 * 1024 + 1)], "big.txt")),
    ).rejects.toThrow("2 MB");
  });
  it("snapshots imported image bytes rather than persisting a local path", async () => {
    const result = await importSignature(
      new File([new Uint8Array([1, 2, 3])], "logo.png", { type: "image/png" }),
    );
    expect(result.fileHtml).toContain("data:image/png;base64,AQID");
    expect(result.fileName).toBe("logo.png");
    expect(
      signatureContent("a", { ...emptySignature(), enabled: true, ...result })
        .included,
    ).toBe(true);
  });
});
