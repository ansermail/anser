import { describe, expect, it } from "vitest";
import { parseMailtoLink } from "./mailto";

describe("mailto links", () => {
  it("reads recipients, copies, subject and body", () => {
    expect(
      parseMailtoLink(
        "mailto:team%40example.com,Mail%20Team%20%3Cmail%40example.com%3E?cc=copy%40example.com&bcc=secret%40example.com&subject=Project%20update&body=Hello%0AWorld",
      ),
    ).toEqual({
      to: "team@example.com, Mail Team <mail@example.com>",
      cc: "copy@example.com",
      bcc: "secret@example.com",
      subject: "Project update",
      body: "Hello\nWorld",
    });
  });

  it("supports query recipients, repeated headers and encoded reserved characters", () => {
    expect(
      parseMailtoLink(
        "MAILTO:?to=first@example.com&To=second@example.com&cc=Support%20%3Csupport%40example.com%3E&subject=One%0ATwo",
      ),
    ).toEqual({
      to: "first@example.com, second@example.com",
      cc: "Support <support@example.com>",
      bcc: "",
      subject: "One Two",
      body: "",
    });
  });

  it("keeps plus signs in addresses and accepts an empty compose link", () => {
    expect(parseMailtoLink("mailto:alice+mail@example.com")).toMatchObject({
      to: "alice+mail@example.com",
    });
    expect(parseMailtoLink("mailto:")).toEqual({
      to: "",
      cc: "",
      bcc: "",
      subject: "",
      body: "",
    });
  });

  it("rejects malformed encoding and non-mailto URLs", () => {
    expect(() => parseMailtoLink("mailto:user%ZZ@example.com")).toThrow(
      "Invalid recipient encoding",
    );
    expect(() =>
      parseMailtoLink("mailto:x@example.com?subject=%E0%A4%A"),
    ).toThrow("Invalid subject encoding");
    expect(() => parseMailtoLink("https://example.com")).toThrow(
      "Not a mailto link",
    );
  });
});
