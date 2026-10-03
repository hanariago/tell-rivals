import { mkdir, readFile, writeFile, rename, chmod } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  FEATURE_LABELS,
  type Feature,
  type Match,
  type Mode,
  type RecordEntry,
  type Measurement,
} from "../src/game/engine.js";
export const dataDirectory =
  process.env.TELL_DATA_DIR ||
  (process.platform === "win32"
    ? path.join(process.env.LOCALAPPDATA || os.homedir(), "TellRivals")
    : path.join(os.homedir(), ".local", "share", "tell-rivals"));
export async function atomicWrite(filename: string, data: string | Buffer) {
  await mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
  const tmp = filename + ".tmp";
  await writeFile(tmp, data, { mode: 0o600 });
  if (process.platform !== "win32") await chmod(tmp, 0o600);
  await rename(tmp, filename);
}
async function dpapi(
  operation: "protect" | "unprotect",
  bytes: Buffer,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        fileURLToPath(new URL("./protect.ps1", import.meta.url)),
        operation,
      ],
      { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
    );
    let output = "";
    child.stdout.on("data", (b) => {
      output += b;
    });
    // Do not echo child errors: the credential payload must never reach logs.
    child.stderr.resume();
    child.on("error", () =>
      reject(new Error("Windows 자격 증명 보호를 시작할 수 없습니다.")),
    );
    child.on("close", (code) =>
      code === 0
        ? resolve(Buffer.from(output.trim(), "base64"))
        : reject(new Error("Windows 자격 증명 보호에 실패했습니다.")),
    );
    child.stdin.end(bytes.toString("base64"));
  });
}
export class ProtectedFile<T> {
  constructor(private filename: string) {}
  async load(): Promise<T | null> {
    let b: Buffer;
    try {
      b = await readFile(this.filename);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
    const plain =
      process.platform === "win32" ? await dpapi("unprotect", b) : b;
    return JSON.parse(plain.toString("utf8"));
  }
  async save(value: T) {
    const bytes = Buffer.from(JSON.stringify(value));
    await atomicWrite(
      this.filename,
      process.platform === "win32" ? await dpapi("protect", bytes) : bytes,
    );
  }
}
export interface TellStore {
  read(mode: Mode): Promise<RecordEntry[]>;
  append(mode: Mode, record: RecordEntry): Promise<void>;
  clear(mode: Mode): Promise<void>;
}
export class LocalTellStore implements TellStore {
  constructor(private root = dataDirectory) {}
  private filename(mode: Mode) {
    return path.join(this.root, "game", mode + ".json");
  }
  async read(mode: Mode): Promise<RecordEntry[]> {
    let raw;
    try {
      raw = JSON.parse(await readFile(this.filename(mode), "utf8"));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw new Error("기록 파일을 읽을 수 없습니다. 백업 후 복구해 주세요.");
    }
    if (
      raw.version !== 1 ||
      !Array.isArray(raw.rounds) ||
      raw.rounds.some(
        (r: RecordEntry, i: number) =>
          r.mode !== mode ||
          r.round !== i + 1 ||
          !["citizen", "mafia"].includes(r.humanRole) ||
          !r.features ||
          (Object.keys(FEATURE_LABELS) as Feature[]).some(
            (key) => typeof r.features[key] !== "boolean",
          ),
      )
    )
      throw new Error(
        "기록 형식이 올바르지 않습니다. 원본 파일을 보존했습니다.",
      );
    return raw.rounds;
  }
  async append(mode: Mode, record: RecordEntry) {
    const rounds = await this.read(mode);
    if (record.round !== rounds.length + 1)
      throw new Error("중복 판 기록을 차단했습니다.");
    rounds.push(record);
    await atomicWrite(
      this.filename(mode),
      JSON.stringify({ version: 1, rounds }),
    );
  }
  async clear(mode: Mode) {
    await atomicWrite(
      this.filename(mode),
      JSON.stringify({ version: 1, rounds: [] }),
    );
  }
  async saveMatch(match: Match | null) {
    await atomicWrite(
      path.join(this.root, "game", "current.json"),
      JSON.stringify(match),
    );
  }
  async loadMatch(): Promise<Match | null> {
    try {
      return JSON.parse(
        await readFile(path.join(this.root, "game", "current.json"), "utf8"),
      );
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw new Error(
        "진행 중 판을 복구할 수 없습니다. 원본 파일을 보존했습니다.",
      );
    }
  }
  async saveBenchmark(metric: Measurement) {
    await atomicWrite(
      path.join(this.root, "game", "benchmark.json"),
      JSON.stringify(metric),
    );
  }
  async loadBenchmark(): Promise<Measurement | null> {
    try {
      return JSON.parse(
        await readFile(path.join(this.root, "game", "benchmark.json"), "utf8"),
      );
    } catch {
      return null;
    }
  }
}
