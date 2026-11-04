import { afterEach, describe, expect, it } from 'vitest';
import {
  addDays,
  dateKey,
  dateRange,
  formatDate,
  formatRange,
  isEndBeforeStart,
  isValidDate,
  isWithinRange,
  todayString,
} from '../src/lib/dates.js';

const originalTZ = process.env.TZ;
afterEach(() => {
  process.env.TZ = originalTZ;
});

describe('local date handling', () => {
  it('validates real calendar dates only', () => {
    expect(isValidDate('2026-11-04')).toBe(true);
    expect(isValidDate('2028-02-29')).toBe(true);
    expect(isValidDate('2026-02-29')).toBe(false);
    expect(isValidDate('2026-13-01')).toBe(false);
    expect(isValidDate('2026-1-4')).toBe(false);
    expect(isValidDate('')).toBe(false);
    expect(isValidDate(undefined)).toBe(false);
  });

  it('formats YYYY-MM-DD as YYYY.MM.DD without UTC shift (west of UTC)', () => {
    process.env.TZ = 'America/Los_Angeles';
    // The naive approach shifts the day back in negative offsets:
    expect(new Date('2026-11-04').getDate()).toBe(3);
    expect(formatDate('2026-11-04')).toBe('2026.11.04');
    expect(formatDate('2026-11-04', { withWeekday: true })).toBe('2026.11.04 (수)');
  });

  it('uses the local calendar day for "today" late at night (east of UTC)', () => {
    process.env.TZ = 'Asia/Seoul';
    const lateNight = new Date(2026, 10, 4, 23, 50); // local 23:50 = 14:50 UTC
    expect(todayString(lateNight)).toBe('2026-11-04');
    const earlyMorning = new Date(2026, 10, 5, 0, 10); // local 00:10 = previous day in UTC
    expect(earlyMorning.toISOString().slice(0, 10)).toBe('2026-11-04');
    expect(todayString(earlyMorning)).toBe('2026-11-05');
  });

  it('formats ranges', () => {
    expect(formatRange('2026-11-04', '')).toBe('2026.11.04');
    expect(formatRange('2026-11-04', '2026-11-04')).toBe('2026.11.04');
    expect(formatRange('2026-11-04', '2026-11-06')).toBe('2026.11.04 – 11.06');
    expect(formatRange('2026-12-30', '2027-01-02')).toBe('2026.12.30 – 2027.01.02');
  });

  it('end date cannot precede start date', () => {
    expect(isEndBeforeStart('2026-11-04', '2026-11-03')).toBe(true);
    expect(isEndBeforeStart('2026-11-04', '2026-11-04')).toBe(false);
    expect(isEndBeforeStart('2026-11-04', '')).toBe(false);
  });

  it('builds the shooting period across month boundaries', () => {
    expect(dateRange('2026-10-30', '2026-11-02')).toEqual(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
    expect(dateRange('2026-11-04', '')).toEqual(['2026-11-04']);
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(isWithinRange('2026-11-05', '2026-11-04', '2026-11-06')).toBe(true);
    expect(isWithinRange('2026-11-07', '2026-11-04', '2026-11-06')).toBe(false);
  });

  it('dateKey gives numeric keys', () => {
    expect(dateKey('2026-11-04')).toBe(20261104);
    expect(dateKey('bad')).toBeNull();
  });
});
