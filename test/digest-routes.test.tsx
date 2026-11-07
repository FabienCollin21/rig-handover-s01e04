import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { Night } from '../src/digest/types.js';

const line = (at: string, job: string, status: string, owner: string | null = 'rook') =>
  JSON.stringify({ at, job, status, owner });

const runsDir = mkdtempSync(join(tmpdir(), 'rig-digest-'));
mkdirSync(runsDir, { recursive: true });

// Written out of job order on purpose: page and JSON must both sort by job.
writeFileSync(
  join(runsDir, '2030-01-01.jsonl'),
  [
    line('2030-01-01T23:00:06+01:00', 'lane/sync', 'ok'),
    line('2030-01-01T23:00:02+01:00', 'rig/rotate-logs', 'ok', 'lane-07'),
    line('2030-01-02T00:00:04+01:00', 'a/first', 'fail'),
  ].join('\n') + '\n',
);
writeFileSync(join(runsDir, '2030-01-02.jsonl'), '');
writeFileSync(
  join(runsDir, '2030-01-03.jsonl'),
  [line('2030-01-03T23:00:06+01:00', 'lane/sync', 'ok'), '{"at":"2030-01-03T23:', ''].join('\n'),
);

const config = { adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60, runsDir };
const app = createApp(config);

beforeAll(() => {
  process.env.LANE_MARKER = 'TEST-MARKER';
});

describe('digest page', () => {
  it('renders a normal night with the banner', async () => {
    const res = await app.request('/digest/2030-01-01');
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('TEST-MARKER');
    for (const job of ['a/first', 'lane/sync', 'rig/rotate-logs']) expect(html).toContain(job);
  });

  it('404s for a night with no file', async () => {
    expect((await app.request('/digest/2030-12-31')).status).toBe(404);
  });

  it('says nothing ran for an empty night', async () => {
    const res = await app.request('/digest/2030-01-02');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('nothing ran');
  });

  it('still renders the good lines when one is bad', async () => {
    const res = await app.request('/digest/2030-01-03');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('lane/sync');
  });
});

describe('digest JSON', () => {
  it('returns the Night for a normal night, sorted by job', async () => {
    const res = await app.request('/api/digest/2030-01-01');
    const night = (await res.json()) as Night;
    expect(res.status).toBe(200);
    expect(night.night).toBe('2030-01-01');
    expect(night.badLines).toBe(0);
    expect(night.rows.map((r) => r.job)).toEqual(['a/first', 'lane/sync', 'rig/rotate-logs']);
  });

  it('404s for a night with no file', async () => {
    expect((await app.request('/api/digest/2030-12-31')).status).toBe(404);
  });

  it('returns no rows for an empty night', async () => {
    const res = await app.request('/api/digest/2030-01-02');
    const night = (await res.json()) as Night;
    expect(res.status).toBe(200);
    expect(night.rows).toEqual([]);
  });

  it('counts a bad line and keeps the good ones', async () => {
    const res = await app.request('/api/digest/2030-01-03');
    const night = (await res.json()) as Night;
    expect(res.status).toBe(200);
    expect(night.badLines).toBe(1);
    expect(night.rows.map((r) => r.job)).toEqual(['lane/sync']);
  });
});

describe('page and JSON agree', () => {
  it('list the same jobs in the same order', async () => {
    const night = (await (await app.request('/api/digest/2030-01-01')).json()) as Night;
    const html = await (await app.request('/digest/2030-01-01')).text();
    const positions = night.rows.map((r) => html.indexOf(r.job));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });
});
