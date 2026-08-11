import { describe, expect, it } from "vitest";
import { DomainError } from "./index.js";

describe("domain errors", () => {
  it("carry a stable code and HTTP status", () => {
    const error = new DomainError("CONFLICT", "conflict", 409);
    expect(error).toMatchObject({ code: "CONFLICT", status: 409 });
  });
});
