import { describe, expect, it } from 'vitest';
import { addDays, daysBetween, formatDay, formatDayLong, parseISO, parseLooseDate, toISO, weekdayOf } from '../../src/engine';

describe('dates', () => {
  it('parses and prints ISO dates without time-zone drift', () => {
    expect(toISO(parseISO('2026-10-05')!)).toBe('2026-10-05');
    expect(parseISO('2026-02-30')).toBeNull();
    expect(parseISO('2026-13-01')).toBeNull();
    expect(parseISO('05.10.2026')).toBeNull();
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(daysBetween('2026-09-24', '2026-10-07')).toBe(13);
  });

  it('knows the weekday of any date', () => {
    expect(weekdayOf(parseISO('2026-10-05')!)).toBe('mon');
    expect(weekdayOf(parseISO('2026-09-23')!)).toBe('wed');
    expect(weekdayOf(parseISO('1970-01-01')!)).toBe('thu');
    expect(weekdayOf(parseISO('2024-02-29')!)).toBe('thu');
  });

  it('formats short and long dates', () => {
    expect(formatDay('2026-10-07')).toBe('7 Oct');
    expect(formatDay('2027-01-03', 2026)).toBe('3 Jan 2027');
    expect(formatDayLong('2026-10-07')).toBe('Wed 7 Oct');
  });

  it('reads the date formats people type', () => {
    const ref = '2026-09-23';
    expect(parseLooseDate('7 Oct', ref)).toBe('2026-10-07');
    expect(parseLooseDate('Oct 7', ref)).toBe('2026-10-07');
    expect(parseLooseDate('7th October 2026', ref)).toBe('2026-10-07');
    expect(parseLooseDate('07.10.2026', ref)).toBe('2026-10-07');
    expect(parseLooseDate('10/27/2026', ref)).toBe('2026-10-27');
    expect(parseLooseDate('2026/11/02', ref)).toBe('2026-11-02');
    expect(parseLooseDate('25 Sep', ref)).toBe('2026-09-25');
    expect(parseLooseDate('3 Jan', ref)).toBe('2027-01-03');
    expect(parseLooseDate('soon', ref)).toBeNull();
  });
});
