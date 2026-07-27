import { describe, expect, it } from "vitest";
import { htmlToText } from "@/services/web-search/fetch";

describe("htmlToText", () => {
  it("strips scripts and tags and keeps text", () => {
    const html = `
      <html><head><title>Hi</title><script>evil()</script><style>.x{}</style></head>
      <body><h1>Hello</h1><p>World &amp; friends</p></body></html>
    `;
    const text = htmlToText(html);
    expect(text).toContain("Hello");
    expect(text).toContain("World & friends");
    expect(text).not.toContain("evil");
    expect(text).not.toContain("<");
  });
});
