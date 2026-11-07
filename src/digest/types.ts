// Plan morning-digest § 1. The contract every part of § 2 builds against.

export type RunStatus = 'ok' | 'retry' | 'fail';

// One line of runs/<night>.jsonl, after parsing at the edge.
export type RunLine = {
  at: string;
  job: string;
  status: RunStatus;
  owner: string | null;
  error?: string;
};

// One row per job. Times keep the log's offset; never converted to UTC.
export type DigestRow = {
  job: string;
  // null when the log says null; views render it as `—`.
  owner: string | null;
  runs: number;
  retries: number;
  lastStatus: RunStatus;
  // The most recent `error` logged for this job, null if none was.
  lastError: string | null;
  firstAt: string;
  lastAt: string;
};

export type Night = {
  night: string;
  // Sorted by job. The page and the JSON both use this order (ADR 0001).
  rows: DigestRow[];
  // Lines that don't parse into a RunLine. Counted, never thrown.
  badLines: number;
  // Parsed lines by status, for the board's counts.
  counts: Record<RunStatus, number>;
};

// null when runs/<night>.jsonl does not exist (the route answers 404).
// An empty file is a Night with no rows ("nothing ran").
export type ReadNight = (runsDir: string, night: string) => Night | null;
