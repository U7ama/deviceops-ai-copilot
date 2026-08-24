import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import { createConnection } from "node:net";
import { dirname, extname, join, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import {
  HeadObjectCommand,
  S3Client,
  type ServerSideEncryption
} from "@aws-sdk/client-s3";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import type { UploadTargetSchema } from "@deviceops/contracts";
import type { z } from "zod";

export type UploadTarget = z.infer<typeof UploadTargetSchema>;
export type ScannerVerdict = "clean" | "infected" | "unsupported" | "failed" | "unscanned";

export interface ScanResult {
  verdict: ScannerVerdict;
  engine: string;
  engineVersion: string;
  signatureVersion: string;
  detail: string;
}

export interface MalwareScanner {
  readonly name: string;
  scan(bytes: Uint8Array): Promise<ScanResult>;
}

export interface UploadSession {
  mediaId: string;
  key: string;
  tokenHash: string | null;
  target: UploadTarget;
}

export interface StoredObjectMetadata {
  bytes: number;
  sha256: string;
  contentType: string;
}

export interface MediaStore {
  readonly provider: "local" | "s3";
  createUpload(input: {
    mediaId: string;
    kind: "image" | "voice";
    bytes: number;
    contentType: string;
    sha256: string;
  }): Promise<UploadSession>;
  verifyUpload(session: UploadSession): Promise<StoredObjectMetadata>;
  readQuarantined(session: UploadSession): Promise<Uint8Array>;
  promote(session: UploadSession, normalized: Uint8Array, contentType: string): Promise<string>;
  delete(session: UploadSession, cleanKey?: string | null): Promise<void>;
}

const imageMimes = new Set(["image/jpeg", "image/png", "image/webp"]);
const voiceMimes = new Set([
  "audio/mp4",
  "audio/aac",
  "audio/mpeg",
  "audio/wav",
  "audio/webm",
  "audio/ogg"
]);

export function validateMediaDeclaration(input: {
  kind: "image" | "voice";
  bytes: number;
  contentType: string;
}): void {
  if (input.kind === "image") {
    if (!imageMimes.has(input.contentType)) throw new Error("Unsupported image MIME type");
    if (input.bytes > 10 * 1024 * 1024) throw new Error("Image exceeds 10 MiB limit");
  } else {
    if (!voiceMimes.has(input.contentType)) throw new Error("Unsupported voice MIME type");
    if (input.bytes > 25 * 1024 * 1024) throw new Error("Voice exceeds 25 MiB limit");
  }
}

export function detectMime(bytes: Uint8Array): string | null {
  const head = Buffer.from(bytes.subarray(0, 16));
  if (head.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return "image/jpeg";
  if (head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }
  if (head.subarray(0, 4).toString("ascii") === "RIFF" && head.subarray(8, 12).toString("ascii") === "WAVE") {
    return "audio/wav";
  }
  if (head.subarray(0, 4).toString("ascii") === "OggS") return "audio/ogg";
  if (head.subarray(0, 3).toString("ascii") === "ID3" || (head[0] === 0xff && (head[1]! & 0xe0) === 0xe0)) {
    return "audio/mpeg";
  }
  if (head.subarray(4, 8).toString("ascii") === "ftyp") return "audio/mp4";
  if (head.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) return "audio/webm";
  return null;
}

export async function normalizeImage(
  bytes: Uint8Array,
  contentType: string
): Promise<{ bytes: Uint8Array; contentType: string; width: number; height: number }> {
  if (!imageMimes.has(contentType)) throw new Error("Image normalization received invalid MIME");
  // Keep the optional native decoder out of the web bundle; the isolated media worker loads it.
  const sharp = (await import(/* webpackIgnore: true */ "sharp")).default;
  const pipeline = sharp(bytes, { limitInputPixels: 25_000_000, failOn: "warning" }).rotate();
  const metadata = await pipeline.metadata();
  if (!metadata.width || !metadata.height || metadata.width * metadata.height > 25_000_000) {
    throw new Error("Image dimensions exceed safety limit");
  }
  const normalized = await pipeline.webp({ quality: 88 }).toBuffer();
  return {
    bytes: normalized,
    contentType: "image/webp",
    width: metadata.width,
    height: metadata.height
  };
}

export class FixtureScanner implements MalwareScanner {
  readonly name = "fixture";
  readonly #allowedHashes: Set<string>;

  constructor(allowedHashes: string[] = []) {
    this.#allowedHashes = new Set(allowedHashes);
  }

  async scan(bytes: Uint8Array): Promise<ScanResult> {
    const content = Buffer.from(bytes).toString("utf8");
    if (content.includes("EICAR-STANDARD-ANTIVIRUS-TEST-FILE")) {
      return {
        verdict: "infected",
        engine: "deviceops-fixture-scanner",
        engineVersion: "1",
        signatureVersion: "eicar",
        detail: "EICAR fixture detected"
      };
    }
    const hash = createHash("sha256").update(bytes).digest("hex");
    const clean = this.#allowedHashes.has(hash);
    return {
      verdict: clean ? "clean" : "unscanned",
      engine: "deviceops-fixture-scanner",
      engineVersion: "1",
      signatureVersion: "allowlist-v1",
      detail: clean ? "Allowlisted fixture" : "Arbitrary uploads require a configured scanner"
    };
  }
}

export class ClamAvScanner implements MalwareScanner {
  readonly name = "clamav";
  readonly #host: string;
  readonly #port: number;
  readonly #timeoutMs: number;
  readonly #maxBytes: number;

  constructor(config: { host: string; port?: number; timeoutMs?: number; maxBytes?: number }) {
    this.#host = config.host;
    this.#port = config.port ?? 3310;
    this.#timeoutMs = config.timeoutMs ?? 15_000;
    this.#maxBytes = config.maxBytes ?? 25 * 1024 * 1024;
  }

  scan(bytes: Uint8Array): Promise<ScanResult> {
    if (bytes.byteLength > this.#maxBytes) return Promise.reject(new Error("Scan byte limit exceeded"));
    return new Promise((resolveScan) => {
      const socket = createConnection({ host: this.#host, port: this.#port });
      const response: Buffer[] = [];
      const finish = (result: ScanResult): void => {
        socket.destroy();
        resolveScan(result);
      };
      socket.setTimeout(this.#timeoutMs, () =>
        finish({
          verdict: "failed",
          engine: "clamav",
          engineVersion: "unknown",
          signatureVersion: "unknown",
          detail: "Scanner timeout"
        })
      );
      socket.on("connect", () => {
        socket.write("zINSTREAM\0");
        const chunkSize = 64 * 1024;
        for (let offset = 0; offset < bytes.length; offset += chunkSize) {
          const chunk = Buffer.from(bytes.subarray(offset, offset + chunkSize));
          const length = Buffer.alloc(4);
          length.writeUInt32BE(chunk.length);
          socket.write(length);
          socket.write(chunk);
        }
        socket.end(Buffer.alloc(4));
      });
      socket.on("data", (chunk) => response.push(chunk));
      socket.on("end", () => {
        const message = Buffer.concat(response).toString("utf8").replaceAll("\0", "").trim();
        finish({
          verdict: message.endsWith("OK") ? "clean" : message.includes("FOUND") ? "infected" : "failed",
          engine: "clamav",
          engineVersion: "reported-by-health-check",
          signatureVersion: "reported-by-health-check",
          detail: message || "Empty scanner response"
        });
      });
      socket.on("error", (error) =>
        finish({
          verdict: "failed",
          engine: "clamav",
          engineVersion: "unknown",
          signatureVersion: "unknown",
          detail: error.message
        })
      );
    });
  }
}

export class LocalFilesystemStore implements MediaStore {
  readonly provider = "local" as const;
  readonly #root: string;
  readonly #appUrl: string;

  constructor(config: { root: string; appUrl: string }) {
    this.#root = resolve(config.root);
    this.#appUrl = config.appUrl.replace(/\/$/, "");
  }

  async createUpload(input: {
    mediaId: string;
    kind: "image" | "voice";
    bytes: number;
    contentType: string;
    sha256: string;
  }): Promise<UploadSession> {
    validateMediaDeclaration(input);
    await mkdir(join(this.#root, "quarantine"), { recursive: true, mode: 0o700 });
    const extension = canonicalExtension(input.contentType);
    const key = `quarantine/${input.mediaId}${extension}`;
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();
    return {
      mediaId: input.mediaId,
      key,
      tokenHash: createHash("sha256").update(token).digest("hex"),
      target: {
        provider: "local",
        method: "PUT",
        url: `${this.#appUrl}/api/v1/media/${input.mediaId}/content?uploadToken=${encodeURIComponent(token)}`,
        headers: {
          "Content-Type": input.contentType,
          "X-Content-SHA256": input.sha256
        },
        expiresAt,
        mediaId: input.mediaId
      }
    };
  }

  async writeUpload(
    session: UploadSession,
    stream: ReadableStream<Uint8Array>,
    maxBytes: number
  ): Promise<StoredObjectMetadata> {
    const destination = this.safePath(session.key);
    const temporary = `${destination}.${randomUUID()}.part`;
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
    const handle = await open(temporary, "wx", 0o600);
    const hash = createHash("sha256");
    let bytes = 0;
    try {
      const reader = stream.getReader();
      while (true) {
        const item = await reader.read();
        if (item.done) break;
        bytes += item.value.byteLength;
        if (bytes > maxBytes) throw new Error("Upload exceeded declared byte limit");
        hash.update(item.value);
        await handle.write(item.value);
      }
      await handle.sync();
      await handle.close();
      await rename(temporary, destination);
      return { bytes, sha256: hash.digest("hex"), contentType: "application/octet-stream" };
    } catch (error) {
      await handle.close().catch(() => undefined);
      await rm(temporary, { force: true });
      throw error;
    }
  }

  async verifyUpload(session: UploadSession): Promise<StoredObjectMetadata> {
    const path = this.safePath(session.key);
    const bytes = await readFile(path);
    const info = await stat(path);
    if (!info.isFile()) throw new Error("Media object is not a regular file");
    return {
      bytes: info.size,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      contentType: detectMime(bytes) ?? "application/octet-stream"
    };
  }

  async readQuarantined(session: UploadSession): Promise<Uint8Array> {
    return readFile(this.safePath(session.key));
  }

  async promote(session: UploadSession, normalized: Uint8Array, contentType: string): Promise<string> {
    const cleanKey = `clean/${session.mediaId}${canonicalExtension(contentType)}`;
    const destination = this.safePath(cleanKey);
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 });
    const handle = await open(destination, "wx", 0o600);
    await handle.write(normalized);
    await handle.sync();
    await handle.close();
    return cleanKey;
  }

  async delete(session: UploadSession, cleanKey?: string | null): Promise<void> {
    await rm(this.safePath(session.key), { force: true });
    if (cleanKey) await rm(this.safePath(cleanKey), { force: true });
  }

  private safePath(key: string): string {
    if (key.includes("\0") || key.includes("..") || extname(key).length > 8) {
      throw new Error("Unsafe media key");
    }
    const candidate = resolve(this.#root, key);
    if (!candidate.startsWith(`${this.#root}${sep}`)) throw new Error("Media path escaped root");
    return candidate;
  }
}

export class AwsS3Store implements MediaStore {
  readonly provider = "s3" as const;
  readonly #client: S3Client;
  readonly #bucket: string;
  readonly #kmsKeyId: string | undefined;

  constructor(config: { region: string; bucket: string; endpoint?: string; kmsKeyId?: string }) {
    this.#client = new S3Client({
      region: config.region,
      ...(config.endpoint ? { endpoint: config.endpoint, forcePathStyle: true } : {})
    });
    this.#bucket = config.bucket;
    this.#kmsKeyId = config.kmsKeyId;
  }

  async createUpload(input: {
    mediaId: string;
    kind: "image" | "voice";
    bytes: number;
    contentType: string;
    sha256: string;
  }): Promise<UploadSession> {
    validateMediaDeclaration(input);
    const key = `quarantine/${input.mediaId}${canonicalExtension(input.contentType)}`;
    const encryption: ServerSideEncryption = this.#kmsKeyId ? "aws:kms" : "AES256";
    const post = await createPresignedPost(this.#client, {
      Bucket: this.#bucket,
      Key: key,
      Expires: 900,
      Fields: {
        "Content-Type": input.contentType,
        "x-amz-checksum-sha256": Buffer.from(input.sha256, "hex").toString("base64"),
        "x-amz-server-side-encryption": encryption,
        ...(this.#kmsKeyId ? { "x-amz-server-side-encryption-aws-kms-key-id": this.#kmsKeyId } : {})
      },
      Conditions: [
        ["content-length-range", input.bytes, input.bytes],
        ["eq", "$Content-Type", input.contentType],
        ["eq", "$key", key]
      ]
    });
    return {
      mediaId: input.mediaId,
      key,
      tokenHash: null,
      target: {
        provider: "s3",
        method: "POST",
        url: post.url,
        fields: post.fields,
        expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
        mediaId: input.mediaId
      }
    };
  }

  async verifyUpload(session: UploadSession): Promise<StoredObjectMetadata> {
    const result = await this.#client.send(
      new HeadObjectCommand({ Bucket: this.#bucket, Key: session.key })
    );
    if (!result.ContentLength || !result.ChecksumSHA256) {
      throw new Error("S3 upload is missing length or checksum metadata");
    }
    return {
      bytes: result.ContentLength,
      sha256: Buffer.from(result.ChecksumSHA256, "base64").toString("hex"),
      contentType: result.ContentType ?? "application/octet-stream"
    };
  }

  async readQuarantined(_session: UploadSession): Promise<Uint8Array> {
    throw new Error("S3 reads are performed by the isolated media worker adapter");
  }

  async promote(): Promise<string> {
    throw new Error("S3 promotion requires the isolated media worker adapter");
  }

  async delete(): Promise<void> {
    throw new Error("S3 deletion requires the isolated media worker adapter");
  }
}

export function createMediaStore(environment: NodeJS.ProcessEnv = process.env): MediaStore {
  const provider = environment.MEDIA_PROVIDER ?? "local";
  if (environment.NODE_ENV === "production" && provider === "local" && environment.MEDIA_ALLOW_LOCAL_PRODUCTION !== "true") {
    throw new Error("Production refuses MEDIA_PROVIDER=local");
  }
  if (provider === "local") {
    return new LocalFilesystemStore({
      root:
        environment.MEDIA_ROOT ??
        join(process.env.HOME ?? "/tmp", ".local/share/deviceops-ai-copilot/media"),
      appUrl: environment.APP_URL ?? "http://localhost:3000"
    });
  }
  if (provider === "s3") {
    return new AwsS3Store({
      region: environment.AWS_REGION ?? "us-east-1",
      bucket: environment.MEDIA_S3_BUCKET ?? "",
      ...(environment.MEDIA_S3_ENDPOINT ? { endpoint: environment.MEDIA_S3_ENDPOINT } : {}),
      ...(environment.MEDIA_S3_KMS_KEY_ID ? { kmsKeyId: environment.MEDIA_S3_KMS_KEY_ID } : {})
    });
  }
  throw new Error(`Unsupported MEDIA_PROVIDER: ${provider}`);
}

function canonicalExtension(contentType: string): string {
  const extensions: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "audio/mp4": ".m4a",
    "audio/aac": ".aac",
    "audio/mpeg": ".mp3",
    "audio/wav": ".wav",
    "audio/webm": ".webm",
    "audio/ogg": ".opus"
  };
  const extension = extensions[contentType];
  if (!extension) throw new Error("Unsupported media content type");
  return extension;
}
