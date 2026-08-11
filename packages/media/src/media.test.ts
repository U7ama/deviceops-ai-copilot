import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  FixtureScanner,
  LocalFilesystemStore,
  detectMime,
  validateMediaDeclaration
} from "./index.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("media quarantine", () => {
  it("rejects oversized or mismatched declarations", () => {
    expect(() =>
      validateMediaDeclaration({ kind: "image", bytes: 11 * 1024 * 1024, contentType: "image/png" })
    ).toThrow(/10 MiB/);
    expect(() =>
      validateMediaDeclaration({ kind: "voice", bytes: 100, contentType: "image/png" })
    ).toThrow(/voice MIME/);
  });

  it("recognizes supported magic bytes", () => {
    expect(detectMime(Uint8Array.from([0xff, 0xd8, 0xff, 0x00]))).toBe("image/jpeg");
  });

  it("keeps arbitrary files unscanned and detects EICAR", async () => {
    const scanner = new FixtureScanner();
    expect((await scanner.scan(Buffer.from("arbitrary"))).verdict).toBe("unscanned");
    expect(
      (await scanner.scan(Buffer.from("EICAR-STANDARD-ANTIVIRUS-TEST-FILE"))).verdict
    ).toBe("infected");
  });

  it("writes a bounded upload with an opaque server key", async () => {
    const directory = await mkdtemp(join(tmpdir(), "deviceops-media-"));
    directories.push(directory);
    const store = new LocalFilesystemStore({ root: directory, appUrl: "http://localhost:3000" });
    const bytes = Uint8Array.from([0xff, 0xd8, 0xff, 0x00]);
    const session = await store.createUpload({
      mediaId: "11111111-1111-4111-8111-111111111111",
      kind: "image",
      bytes: bytes.length,
      contentType: "image/jpeg",
      sha256: createHash("sha256").update(bytes).digest("hex")
    });
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      }
    });
    const result = await store.writeUpload(session, stream, bytes.length);
    expect(result.bytes).toBe(bytes.length);
    expect(await readFile(join(directory, session.key))).toEqual(Buffer.from(bytes));
  });
});
