import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile, chmod } from "node:fs/promises";
import { dirname } from "node:path";
interface Envelope { version: 1; iv: string; tag: string; ciphertext: string }
export class CredentialVault {
  private readonly key: Buffer;
  constructor(private readonly filename: string, keyBase64: string) {
    this.key = Buffer.from(keyBase64, "base64");
    if (this.key.length !== 32 || this.key.toString("base64") !== keyBase64) throw new Error("Vault key must be a canonical base64-encoded 32-byte secret stored separately from the vault");
  }
  private async load(): Promise<Record<string, string>> {
    let encoded: string;
    try { encoded = await readFile(this.filename, "utf8"); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return {}; throw error; }
    try {
      if (encoded.length > 1048576) throw new Error("oversized");
      const envelope = JSON.parse(encoded) as Envelope;
      if (envelope.version !== 1) throw new Error("version");
      const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(envelope.iv, "base64"));
      decipher.setAAD(Buffer.from("deviceops-edge-vault-v1")); decipher.setAuthTag(Buffer.from(envelope.tag, "base64"));
      const value: unknown = JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, "base64")), decipher.final()]).toString("utf8"));
      if (!value || typeof value !== "object" || Array.isArray(value) || Object.values(value).some((item) => typeof item !== "string")) throw new Error("shape");
      return value as Record<string, string>;
    } catch { throw new Error("Vault authentication failed; check key or file integrity"); }
  }
  private async save(values: Record<string, string>): Promise<void> {
    const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", this.key, iv);
    cipher.setAAD(Buffer.from("deviceops-edge-vault-v1"));
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(values)), cipher.final()]);
    const envelope: Envelope = { version: 1, iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64") };
    await mkdir(dirname(this.filename), { recursive: true, mode: 0o700 });
    const temporary = `${this.filename}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(envelope), { mode: 0o600 }); await rename(temporary, this.filename); await chmod(this.filename, 0o600);
  }
  async get(reference: string): Promise<string | undefined> { const values = await this.load(); return Object.hasOwn(values, reference) ? values[reference] : undefined; }
  async set(reference: string, secret: string): Promise<void> {
    if (["__proto__", "constructor", "prototype"].includes(reference) || !/^[a-zA-Z0-9_-]{1,128}$/.test(reference) || !secret || secret.length > 4096) throw new Error("Invalid credential reference or secret");
    const values = await this.load();
    if (!Object.hasOwn(values, reference) && Object.keys(values).length >= 256) throw new Error("Vault entry limit reached");
    values[reference] = secret; await this.save(values);
  }
  async revoke(reference: string): Promise<void> { const values = await this.load(); delete values[reference]; await this.save(values); }
}
