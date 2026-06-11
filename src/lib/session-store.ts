import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { GeneratedSessionMeta, SessionRecord } from "./types.ts";

const sessionDir = join(process.cwd(), ".tmp", "sessions");

const ensureDir = async () => {
  await mkdir(sessionDir, { recursive: true });
};

export const createSessionId = () => randomUUID();

export const saveSession = async (record: SessionRecord) => {
  await ensureDir();
  await writeFile(join(sessionDir, `${record.id}.json`), JSON.stringify(record, null, 2), "utf8");
};

export const loadSession = async (id: string): Promise<SessionRecord | null> => {
  try {
    await ensureDir();
    const content = await readFile(join(sessionDir, `${id}.json`), "utf8");
    return JSON.parse(content) as SessionRecord;
  } catch {
    return null;
  }
};

export const listSessions = async (): Promise<GeneratedSessionMeta[]> => {
  await ensureDir();
  const files = await readdir(sessionDir);
  const items = await Promise.all(
    files
      .filter((file) => file.endsWith(".json"))
      .map(async (file) => {
        const content = await readFile(join(sessionDir, file), "utf8");
        const record = JSON.parse(content) as SessionRecord;
        const { warnings, canonicalModel, flowGraph, qualityGate, documents, ...meta } = record;
        void warnings;
        void canonicalModel;
        void flowGraph;
        void qualityGate;
        void documents;
        return meta;
      }),
  );

  return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
};
