import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { dayKey, weekStrip } from './progress.ts';

/**
 * Week-strip tests — run with `npm test`.
 *
 * All of this is local-calendar arithmetic, which is exactly where date code
 * goes wrong: week boundaries (Sunday is the END of the week here, not the
 * start), month and year rollover, and DST weeks where a day is not 24 hours.
 * The strip is built with day-of-month maths rather than millisecond offsets
 * for that last reason, so there is a test that would catch a regression to
 * `+ 86_400_000`.
 */

/** Local noon, so a timezone offset can never shift the calendar day. */
function at(year: number, month: number, day: number): number {
  return new Date(year, month - 1, day, 12, 0, 0).getTime();
}

describe('weekStrip', () => {
  it('is Monday-first and seven days long', () => {
    const strip = weekStrip([], at(2026, 7, 23));
    assert.equal(strip.length, 7);
    assert.deepEqual(
      strip.map((d) => d.label),
      ['M', 'T', 'W', 'T', 'F', 'S', 'S']
    );
  });

  it('places today in the right column (Thursday)', () => {
    // 2026-07-23 is a Thursday.
    const strip = weekStrip([], at(2026, 7, 23));
    const todayIndex = strip.findIndex((d) => d.isToday);
    assert.equal(todayIndex, 3);
    assert.equal(strip[todayIndex].key, '2026-07-23');
  });

  it('treats Sunday as the last day of the week, not the first', () => {
    // 2026-07-26 is a Sunday: it must be the 7th cell, and the week must
    // start on the preceding Monday.
    const strip = weekStrip([], at(2026, 7, 26));
    assert.equal(strip[6].isToday, true);
    assert.equal(strip[0].key, '2026-07-20');
    assert.equal(strip[6].key, '2026-07-26');
    assert.ok(strip.every((d) => !d.isFuture));
  });

  it('marks only days after today as future', () => {
    const strip = weekStrip([], at(2026, 7, 23)); // Thursday
    assert.deepEqual(
      strip.map((d) => d.isFuture),
      [false, false, false, false, true, true, true]
    );
  });

  it('fills the days present in the recall list, and only those', () => {
    const strip = weekStrip(
      ['2026-07-20', '2026-07-22', '2026-07-23'],
      at(2026, 7, 23)
    );
    assert.deepEqual(
      strip.map((d) => d.active),
      [true, false, true, true, false, false, false]
    );
  });

  it('ignores recall days from other weeks', () => {
    const strip = weekStrip(['2026-07-13', '2026-08-01'], at(2026, 7, 23));
    assert.ok(strip.every((d) => !d.active));
  });

  it('crosses a month boundary correctly', () => {
    // 2026-08-01 is a Saturday, so its week starts Monday 2026-07-27.
    const strip = weekStrip(['2026-07-27'], at(2026, 8, 1));
    assert.equal(strip[0].key, '2026-07-27');
    assert.equal(strip[0].active, true);
    assert.equal(strip[5].key, '2026-08-01');
    assert.equal(strip[5].isToday, true);
  });

  it('crosses a year boundary correctly', () => {
    // 2027-01-01 is a Friday; the week starts Monday 2026-12-28.
    const strip = weekStrip([], at(2027, 1, 1));
    assert.equal(strip[0].key, '2026-12-28');
    assert.equal(strip[4].key, '2027-01-01');
    assert.equal(strip[4].isToday, true);
  });

  it('keeps seven distinct consecutive days across a DST change', () => {
    // Last Sunday of October is the European DST fallback; that week contains
    // a 25-hour day. Millisecond-offset arithmetic would repeat or skip a day.
    const strip = weekStrip([], at(2026, 10, 28));
    const keys = strip.map((d) => d.key);
    assert.equal(new Set(keys).size, 7, 'a day was repeated across the DST shift');
    for (let i = 1; i < keys.length; i++) {
      const prev = new Date(`${keys[i - 1]}T00:00:00Z`).getTime();
      const cur = new Date(`${keys[i]}T00:00:00Z`).getTime();
      assert.equal(cur - prev, 86_400_000, `${keys[i - 1]} -> ${keys[i]}`);
    }
  });

  it('agrees with dayKey for today', () => {
    const now = at(2026, 7, 23);
    const strip = weekStrip([dayKey(now)], now);
    assert.equal(strip.find((d) => d.isToday)?.active, true);
  });
});
