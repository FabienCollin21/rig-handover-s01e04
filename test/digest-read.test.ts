import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/read.js';

function runsDirWith(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'rig-runs-'));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return dir;
}

const line = (fields: Record<string, unknown>) => JSON.stringify(fields);

describe('readNight', () => {
  it('reads runs/2026-10-28.jsonl into 5 jobs and 1 bad line', () => {
    const night = readNight('runs', '2026-10-28');
    expect(night).not.toBeNull();
    expect(night?.badLines).toBe(1);
    expect(night?.counts).toEqual({ ok: 10, retry: 4, fail: 1 });
    expect(night?.rows.map(({ job, runs, retries, lastStatus, lastError }) => ({ job, runs, retries, lastStatus, lastError }))).toEqual([
      { job: 'digest/render', runs: 1, retries: 0, lastStatus: 'ok', lastError: null },
      { job: 'fixtures/refresh', runs: 4, retries: 3, lastStatus: 'ok', lastError: 'upstream 503' },
      { job: 'lane/sync', runs: 8, retries: 1, lastStatus: 'ok', lastError: 'lock held' },
      { job: 'notes/backup', runs: 1, retries: 0, lastStatus: 'fail', lastError: 'quota exceeded' },
      { job: 'rig/rotate-logs', runs: 1, retries: 0, lastStatus: 'ok', lastError: null },
    ]);
    const sync = night?.rows.find((r) => r.job === 'lane/sync');
    expect(sync).toMatchObject({ owner: 'rook', firstAt: '2026-10-28T23:00:06+01:00', lastAt: '2026-10-29T05:00:04+01:00' });
  });

  it('keeps a row whose owner is null', () => {
    const night = readNight('runs', '2026-10-28');
    expect(night?.rows.find((r) => r.job === 'digest/render')?.owner).toBeNull();
  });

  it('returns null for a night with no file', () => {
    expect(readNight(runsDirWith({}), '2026-10-30')).toBeNull();
  });

  it('reads an empty file as a night where nothing ran', () => {
    expect(readNight(runsDirWith({ '2026-10-30.jsonl': '' }), '2026-10-30')).toEqual({
      night: '2026-10-30',
      rows: [],
      badLines: 0,
      counts: { ok: 0, retry: 0, fail: 0 },
    });
  });

  it.each(['../runs/2026-10-28', '2026-10-28.jsonl', '2026-1-28', '', 'latest'])('returns null for night %j', (bad) => {
    expect(readNight('runs', bad)).toBeNull();
  });

  it('counts wrong-shaped lines as bad and orders by time, not file position', () => {
    const dir = runsDirWith({
      '2026-10-30.jsonl': [
        line({ at: '2026-10-30T02:00:00+01:00', job: 'a', status: 'fail', owner: 'x', error: 'late' }),
        line({ at: '2026-10-30T00:30:00Z', job: 'a', status: 'retry', owner: 'y', error: 'early' }),
        line({ at: '2026-10-30T01:00:00+01:00', job: 'a', status: 'ok', owner: 'z' }),
        line({ at: '2026-10-30T01:00:00+01:00', job: 'b', status: 'nope', owner: 'x' }),
        line({ at: '2026-10-30T01:00:00+01:00', job: 'b', status: 'ok', owner: 7 }),
        line({ at: 5, job: 'b', status: 'ok', owner: null }),
        '[1,2]',
        '',
      ].join('\n'),
    });
    const night = readNight(dir, '2026-10-30');
    expect(night?.badLines).toBe(4);
    expect(night?.rows).toEqual([
      {
        job: 'a',
        owner: 'x',
        runs: 3,
        retries: 1,
        lastStatus: 'fail',
        lastError: 'late',
        firstAt: '2026-10-30T01:00:00+01:00',
        lastAt: '2026-10-30T02:00:00+01:00',
      },
    ]);
  });
});
