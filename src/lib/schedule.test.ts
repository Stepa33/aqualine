import { describe, expect, it } from 'vitest';
import { slotsFor, tryStart, type Hours } from './schedule';

const H: Hours = { open: '09:00', close: '21:00', daysOff: [0], holidays: ['2026-12-31'], bufferMin: 15, stepMin: 30, tz: 'Europe/Kyiv' };
const wash = { id: 'w', duration_min: 60, days: 1 };
const ceramic = { id: 'c', duration_min: 0, days: 2 };
const boxes = ['b1', 'b2'];
const past = new Date('2026-01-01T00:00:00Z');

describe('schedule', () => {
  it('lists every step of a working day', () => {
    const s = slotsFor(H, wash, boxes, [], '2026-11-10', past);
    expect(s[0]?.startMin).toBe(9 * 60);
    expect(s.at(-1)?.startMin).toBe(20 * 60);
  });
  it('closes days off and holidays', () => {
    expect(slotsFor(H, wash, boxes, [], '2026-11-08', past)).toHaveLength(0); // Sunday
    expect(slotsFor(H, wash, boxes, [], '2026-12-31', past)).toHaveLength(0);
  });
  it('moves to the second box, then blocks the time with the buffer', () => {
    const busy = [{ box_id: 'b1', starts_at: '2026-11-10T08:00:00.000Z', blocked_until: '2026-11-10T09:15:00.000Z' }]; // 10:00–11:15 Kyiv
    expect(tryStart(H, wash, boxes, busy, '2026-11-10', 10 * 60)?.boxId).toBe('b2');
    const both = [...busy, { ...busy[0]!, box_id: 'b2' }];
    expect(tryStart(H, wash, boxes, both, '2026-11-10', 10 * 60)).toBeNull();
    expect(tryStart(H, wash, boxes, both, '2026-11-10', 9 * 60)).toBeNull(); // 09:00–10:00 + 15 min touches 10:00
    expect(tryStart(H, wash, boxes, both, '2026-11-10', 11 * 60 + 30)).not.toBeNull();
  });
  it('keeps a 2-day job across working days only', () => {
    const s = tryStart(H, ceramic, ['b1'], [], '2026-11-07', 9 * 60); // Saturday → Monday (Sunday off)
    expect(s?.dates).toEqual(['2026-11-07', '2026-11-09']);
    const busy = [{ box_id: 'b1', starts_at: s!.startsAt, blocked_until: s!.blockedUntil }];
    expect(tryStart(H, wash, ['b1'], busy, '2026-11-09', 15 * 60)).toBeNull();
    expect(tryStart(H, ceramic, ['b1'], [], '2026-11-07', 10 * 60)).toBeNull(); // multi-day starts at opening only
  });
  it('hides starts that are too soon', () => {
    const now = new Date('2026-11-10T10:10:00Z'); // 12:10 Kyiv
    expect(slotsFor(H, wash, boxes, [], '2026-11-10', now)[0]?.startMin).toBe(13 * 60);
  });
});
