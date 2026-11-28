// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenPgpBanner } from "./openpgp-banner";
import { ComposePgpControl } from "./compose-pgp-control";
import { TranslatableMailBody } from "./translatable-mail-body";
import * as api from "@/lib/api";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function mount(element: React.ReactElement) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => {
    root!.render(element);
  });
  return host;
}

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = null;
  host?.remove();
  host = null;
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("OpenPGP UI components", () => {
  it("renders passphrase unlock form and reloads mail after unlocking", async () => {
    const callSpy = vi.spyOn(api, "call").mockResolvedValueOnce(undefined);
    const onReload = vi.fn();
    const container = mount(
      <OpenPgpBanner
        mailId="mail-1"
        attachments={[]}
        onReload={onReload}
        pgp={{
          encrypted: true,
          encryptionState: "passphraseRequired",
          format: "pgpMime",
          decryptionKeyFingerprint: "AABBCCDDEEFF00112233445566778899AABBCCDD",
          signed: false,
          signatureState: "none",
          senderMatchesSigner: false,
          hasAttachedPublicKey: false,
        }}
      />,
    );
    const input = container.querySelector<HTMLInputElement>(
      'input[aria-label="输入 OpenPGP 私钥密码短语"]',
    )!;
    expect(input).not.toBeNull();
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!;
    await act(async () => {
      setter.call(input, "my-secret-pass");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const form = container.querySelector("form")!;
    await act(async () => {
      form.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
      await Promise.resolve();
    });
    expect(callSpy).toHaveBeenCalledWith("unlock_pgp_key", {
      fingerprint: "AABBCCDDEEFF00112233445566778899AABBCCDD",
      passphrase: "my-secret-pass",
      remember: false,
    });
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it("disables AI translation and hides AI summary for encrypted mail", () => {
    const actionsHost = document.createElement("div");
    document.body.append(actionsHost);
    mount(
      <TranslatableMailBody
        mailId="mail-enc"
        html=""
        body="Decrypted confidential body"
        encrypted
        actionsContainer={actionsHost}
        onOpenLink={() => {}}
      />,
    );
    const btn = actionsHost.querySelector(
      "button[disabled]",
    ) as HTMLButtonElement;
    expect(btn).not.toBeNull();
    expect(btn.getAttribute("aria-label")).toBe("加密邮件不会发送给 AI 服务");
    expect(actionsHost.querySelectorAll("button")).toHaveLength(1);
  });

  it("shows recipient key readiness in ComposePgpControl", async () => {
    vi.spyOn(api, "call").mockResolvedValue({
      senderHasSecretKey: true,
      senderFingerprint: "1111222233334444555566667777888899990000",
      senderPassphraseNeeded: false,
      recipients: [
        {
          email: "bob@example.com",
          hasKey: true,
          fingerprint: "AAAABBBBCCCCDDDDEEEEFFFF0000111122223333",
          userId: "Bob <bob@example.com>",
          expired: false,
          revoked: false,
          algorithm: "Ed25519 / Curve25519",
        },
        {
          email: "carol@example.com",
          hasKey: false,
          fingerprint: "",
          userId: "",
          expired: false,
          revoked: false,
          algorithm: "",
        },
      ],
      allRecipientsReady: false,
      missingEmails: ["carol@example.com"],
    });
    const container = mount(
      <ComposePgpControl
        accountId="acc-1"
        recipients={["bob@example.com", "carol@example.com"]}
        sign={false}
        encrypt
        attachPublicKey={false}
        onChange={() => {}}
      />,
    );
    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label="OpenPGP 安全选项"]',
    )!;
    await act(async () => {
      trigger.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    const bodyText = document.body.textContent || "";
    expect(bodyText).toContain("bob@example.com");
    expect(bodyText).toContain("carol@example.com");
    expect(bodyText).toContain("缺少公钥");
    expect(bodyText).toContain("就绪");
  });
});
