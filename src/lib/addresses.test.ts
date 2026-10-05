import { describe, it, expect } from "vitest";
import {
  addressTokens,
  parseAddresses,
  formatAddress,
  replyRecipients,
} from "./addresses";
import { makeDemo } from "./demo";
import type { Detail } from "./types";

describe("reply destinations", () => {
  const detail = (): Detail => ({
    mail: makeDemo().messages[0],
    html: "",
    attachments: [],
    replyTo: [{ name: "Support, China", email: "reply@example.com" }],
    to: [
      { name: "Me", email: "me@example.com" },
      { name: "Peer", email: "peer@example.com" },
    ],
    cc: [
      { name: "Duplicate", email: "PEER@example.com" },
      { name: "Other", email: "other@example.com" },
      { name: "My second account", email: "second@example.com" },
    ],
  });
  it("uses Reply-To and excludes own addresses and duplicates across To/Cc", () => {
    const d = detail();
    const result = replyRecipients(
      d,
      ["me@example.com", "second@example.com"],
      true,
    );
    expect(parseAddresses(result.to).map((a) => a.email)).toEqual([
      "reply@example.com",
      "peer@example.com",
    ]);
    expect(parseAddresses(result.cc).map((a) => a.email)).toEqual([
      "other@example.com",
    ]);
    expect(
      parseAddresses(replyRecipients(d, ["me@example.com"]).to).map(
        (a) => a.email,
      ),
    ).toEqual(["reply@example.com"]);
  });
  it("replies to original recipients for your own sent mail, without revealing Bcc", () => {
    const d = detail();
    d.replyTo = [{ name: "Me", email: "ME@example.com" }];
    expect(
      parseAddresses(replyRecipients(d, ["me@example.com"]).to).map(
        (a) => a.email,
      ),
    ).toEqual(["peer@example.com"]);
    expect(
      replyRecipients(d, ["me@example.com", "peer@example.com"], true).to,
    ).toBe("");
  });
  it("keeps another signed-in account as the direct reply target", () => {
    const d = detail();
    d.replyTo = [{ name: "Other account", email: "SECOND@example.com" }];
    d.to = [{ name: "Receiving account", email: "me@example.com" }];
    const own = ["second@example.com", "me@example.com"];
    expect(
      parseAddresses(replyRecipients(d, own, false, "me@example.com").to).map(
        (a) => a.email,
      ),
    ).toEqual(["SECOND@example.com"]);
    const all = replyRecipients(d, own, true, "me@example.com");
    expect(parseAddresses(all.to).map((a) => a.email)).toEqual([
      "SECOND@example.com",
    ]);
    expect(parseAddresses(all.cc).map((a) => a.email)).toEqual([
      "PEER@example.com",
      "other@example.com",
    ]);
    d.replyTo = [{ name: "Sending account", email: "ME@example.com" }];
    d.to = [{ name: "Other account", email: "second@example.com" }];
    expect(
      parseAddresses(replyRecipients(d, own, false, "me@example.com").to).map(
        (a) => a.email,
      ),
    ).toEqual(["second@example.com"]);
  });
  it("keeps quoted commas and escaped quotes when completing multiple recipients", () => {
    const a = { name: 'Doe, "Alex"', email: "alex@example.com" };
    const value = formatAddress(a) + ", other@example.com, ";
    expect(addressTokens(value)).toHaveLength(3);
    expect(parseAddresses(value)).toEqual([
      a,
      { name: "", email: "other@example.com" },
    ]);
    expect(parseAddresses("bad address; valid@example.com；")).toEqual([
      { name: "", email: "valid@example.com" },
    ]);
  });
});
