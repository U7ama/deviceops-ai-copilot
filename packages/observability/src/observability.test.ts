import { describe, expect, it } from "vitest";
import { redact } from "./index.js";

describe("log redaction", () => {
  it("removes nested secrets and bearer values", () => {
    expect(
      redact({ authorization: "Bearer secret", nested: { apiKey: "sk-secret123456" } })
    ).toEqual({ authorization: "[REDACTED]", nested: { apiKey: "[REDACTED]" } });
  });
});
