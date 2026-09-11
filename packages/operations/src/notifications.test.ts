import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { signNotification, verifyNotification } from "./notifications.js";
const key = "test-only-signature-key-32-characters",
  now = Date.parse("2026-09-06T00:00:00Z");
const payload = {
  purpose: "dispatch" as const,
  deliveryId: randomUUID(),
  attempt: 1,
};
describe("notification capabilities", () => {
  it("authenticates the delivery ID and attempt inside the signed payload", () =>
    expect(
      verifyNotification(
        signNotification(payload, key, now),
        "dispatch",
        key,
        now,
      ),
    ).toEqual(payload));
  it("rejects payload substitution", () => {
    const e = signNotification(payload, key, now);
    e.payloadBase64 = Buffer.from(
      JSON.stringify({ ...payload, deliveryId: randomUUID() }),
    ).toString("base64url");
    expect(() => verifyNotification(e, "dispatch", key, now)).toThrow(
      "invalid",
    );
  });
  it("rejects a wrong key and stale signatures", () => {
    const e = signNotification(payload, key, now);
    expect(() =>
      verifyNotification(e, "dispatch", "different-key", now),
    ).toThrow();
    expect(() => verifyNotification(e, "dispatch", key, now + 301000)).toThrow(
      "expired",
    );
  });
  it("cannot reuse a dispatch capability to acknowledge delivery", () =>
    expect(() =>
      verifyNotification(signNotification(payload, key, now), "ack", key, now),
    ).toThrow("purpose"));
});
