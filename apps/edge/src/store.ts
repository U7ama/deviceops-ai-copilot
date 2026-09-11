import { mkdir, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
/** Single-process serialized transactions, atomic rename, and fsync before exposing new state. */
export class JsonStore<T extends object> {
  private pending: Promise<void> = Promise.resolve();
  private constructor(private readonly filename: string, private value: T) {}
  static async load<T extends object>(filename: string, initial: T): Promise<JsonStore<T>> {
    let value = initial;
    try {
      const encoded = await readFile(filename, "utf8");
      if (encoded.length > 32 * 1024 * 1024) throw new Error("State file exceeds 32 MiB limit");
      const parsed: unknown = JSON.parse(encoded);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid collector state");
      value = parsed as T;
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    return new JsonStore(filename, value);
  }
  snapshot(): T { return structuredClone(this.value); }
  async update(mutate: (value: T) => void): Promise<void> {
    const operation = this.pending.then(async () => {
      const next = structuredClone(this.value); mutate(next);
      const encoded = JSON.stringify(next);
      if (encoded.length > 32 * 1024 * 1024) throw new Error("State file exceeds 32 MiB limit");
      await mkdir(dirname(this.filename), { recursive: true, mode: 0o700 });
      const temporary = `${this.filename}.${randomUUID()}.tmp`;
      const handle = await open(temporary, "wx", 0o600);
      try { await handle.writeFile(encoded); await handle.sync(); } finally { await handle.close(); }
      await rename(temporary, this.filename);
      const directory = await open(dirname(this.filename), "r");
      try { await directory.sync(); } finally { await directory.close(); }
      this.value = next;
    });
    this.pending = operation.catch(() => undefined); return operation;
  }
}
/** Main processes must hold this lock; a second collector must not share command state. */
export async function acquireProcessLock(filename: string): Promise<() => Promise<void>> {
  await mkdir(dirname(filename), { recursive: true, mode: 0o700 });
  const nonce = randomUUID(), contents = JSON.stringify({ pid: process.pid, nonce });
  try { await writeFile(filename, contents, { flag: "wx", mode: 0o600 }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const previous = JSON.parse(await readFile(filename, "utf8")) as { pid?: number };
    if (!Number.isInteger(previous.pid) || previous.pid! < 1) throw new Error("Invalid edge lock; inspect it manually");
    try { process.kill(previous.pid!, 0); } catch (probe) {
      if ((probe as NodeJS.ErrnoException).code === "ESRCH") { await unlink(filename); return acquireProcessLock(filename); }
      throw probe;
    }
    throw new Error("Another edge process owns this state directory");
  }
  return async () => {
    const current = JSON.parse(await readFile(filename, "utf8")) as { nonce?: string };
    if (current.nonce === nonce) await unlink(filename);
  };
}
