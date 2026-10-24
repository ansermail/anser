// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MailRecipients } from "./mail-recipients";

let root: Root, host: HTMLDivElement;
beforeEach(async () => {
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

it("renders each recipient header on its own aligned row", async () => {
  await act(async () =>
    root.render(
      <MailRecipients
        to="a@example.com, b@example.com"
        cc="c@example.com"
        bcc="d@example.com"
      />,
    ),
  );
  expect(host.querySelectorAll("dt")).toHaveLength(3);
  expect([...host.querySelectorAll("dt")].map((n) => n.textContent)).toEqual([
    "收件人：",
    "抄送：",
    "密送：",
  ]);
  expect([...host.querySelectorAll("dd")].map((n) => n.textContent)).toEqual([
    "a@example.com, b@example.com",
    "c@example.com",
    "d@example.com",
  ]);
  expect(host.querySelectorAll(".contact-address")).toHaveLength(4);
});

it("hides headers the original message did not contain", async () => {
  await act(async () =>
    root.render(<MailRecipients to="a@example.com" cc="" bcc="" />),
  );
  expect(host.querySelectorAll("dt")).toHaveLength(1);
  expect(host.textContent).not.toContain("密送");
});

it("opens supported address actions from an individual recipient", async () => {
  const onComposeAddress = vi.fn();
  const onAddContact = vi.fn();
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  await act(async () =>
    root.render(
      <MailRecipients
        to="Peer <peer@example.com>, other@example.com"
        onComposeAddress={onComposeAddress}
        onAddContact={onAddContact}
      />,
    ),
  );
  const peer = host.querySelector<HTMLElement>(".contact-address")!;
  const openMenu = async () =>
    act(async () => {
      peer.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          button: 2,
        }),
      );
    });
  const item = (index: number) =>
    document.querySelectorAll<HTMLElement>('[data-slot="context-menu-item"]')[
      index
    ];
  await openMenu();
  expect(
    [...document.querySelectorAll('[data-slot="context-menu-item"]')].map(
      (item) => item.textContent,
    ),
  ).toEqual(["写邮件", "复制邮件地址", "复制名字和邮件地址", "添加联系人"]);
  await act(async () => item(0).click());
  expect(onComposeAddress).toHaveBeenCalledWith({
    name: "Peer",
    email: "peer@example.com",
  });
  await openMenu();
  await act(async () => item(1).click());
  expect(writeText).toHaveBeenCalledWith("peer@example.com");
  await openMenu();
  await act(async () => item(2).click());
  expect(writeText).toHaveBeenCalledWith("Peer <peer@example.com>");
  await openMenu();
  await act(async () => item(3).click());
  expect(onAddContact).toHaveBeenCalledWith({
    name: "Peer",
    email: "peer@example.com",
  });
});

it("opens the address menu from the keyboard", async () => {
  const onComposeAddress = vi.fn();
  await act(async () =>
    root.render(
      <MailRecipients
        to="other@example.com"
        onComposeAddress={onComposeAddress}
      />,
    ),
  );
  const address = host.querySelector<HTMLElement>(".contact-address")!;
  await act(async () => {
    address.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "F10",
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  const compose = document.querySelector<HTMLElement>(
    '[data-slot="context-menu-item"]',
  );
  expect(compose?.textContent).toBe("写邮件");
  await act(async () => compose!.click());
  expect(onComposeAddress).toHaveBeenCalledWith({
    name: "",
    email: "other@example.com",
  });
});
