import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DigestRow, Night, ReadNight, RunLine, RunStatus } from './types.js';

const NIGHT = /^\d{4}-\d{2}-\d{2}$/;
const STATUSES: readonly RunStatus[] = ['ok', 'retry', 'fail'];

function isStatus(value: unknown): value is RunStatus {
  return typeof value === 'string' && (STATUSES as readonly string[]).includes(value);
}

// null when the line is not a RunLine. `at` must also be a parseable time, so lines can be ordered.
export function parseLine(text: string): RunLine | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const { at, job, status, owner, error } = value as Record<string, unknown>;
  if (typeof at !== 'string' || !Number.isFinite(Date.parse(at))) return null;
  if (typeof job !== 'string' || !isStatus(status)) return null;
  if (owner !== null && typeof owner !== 'string') return null;
  if (error !== undefined && typeof error !== 'string') return null;
  return error === undefined ? { at, job, status, owner } : { at, job, status, owner, error };
}

function readFile(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return null;
    throw err;
  }
}

type Acc = DigestRow & { firstMs: number; lastMs: number; lastErrorMs: number };

export const readNight: ReadNight = (runsDir, night) => {
  if (!NIGHT.test(night)) return null;
  const text = readFile(join(runsDir, `${night}.jsonl`));
  if (text === null) return null;

  const jobs = new Map<string, Acc>();
  const counts: Record<RunStatus, number> = { ok: 0, retry: 0, fail: 0 };
  let badLines = 0;

  for (const raw of text.split(/\r?\n/)) {
    if (raw.trim() === '') continue;
    const line = parseLine(raw);
    if (line === null) {
      badLines++;
      continue;
    }
    counts[line.status]++;
    const ms = Date.parse(line.at);
    const acc = jobs.get(line.job);
    if (acc === undefined) {
      jobs.set(line.job, {
        job: line.job,
        owner: line.owner,
        runs: 1,
        retries: line.status === 'retry' ? 1 : 0,
        lastStatus: line.status,
        lastError: line.error ?? null,
        firstAt: line.at,
        lastAt: line.at,
        firstMs: ms,
        lastMs: ms,
        lastErrorMs: line.error === undefined ? -Infinity : ms,
      });
      continue;
    }
    acc.runs++;
    if (line.status === 'retry') acc.retries++;
    // Ties go to file order: a later line wins "last", an earlier line keeps "first".
    if (ms < acc.firstMs) {
      acc.firstMs = ms;
      acc.firstAt = line.at;
    }
    if (ms >= acc.lastMs) {
      acc.lastMs = ms;
      acc.lastAt = line.at;
      acc.lastStatus = line.status;
      acc.owner = line.owner;
    }
    if (line.error !== undefined && ms >= acc.lastErrorMs) {
      acc.lastErrorMs = ms;
      acc.lastError = line.error;
    }
  }

  const rows: DigestRow[] = [...jobs.values()]
    .map(({ firstMs: _f, lastMs: _l, lastErrorMs: _e, ...row }) => row)
    .sort((a, b) => (a.job < b.job ? -1 : a.job > b.job ? 1 : 0));

  return { night, rows, badLines, counts } satisfies Night;
};
