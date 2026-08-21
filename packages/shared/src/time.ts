const ART_TZ = 'America/Argentina/Buenos_Aires';

export interface ArtParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

export function artParts(d: Date = new Date()): ArtParts {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: ART_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value]));
  return {
    year: Number(parts['year']),
    month: Number(parts['month']),
    day: Number(parts['day']),
    hour: Number(parts['hour'] === '24' ? '0' : parts['hour']),
    minute: Number(parts['minute']),
  };
}

export function currentArtDateKey(now: Date = new Date()): string {
  const p = artParts(now);
  return `${String(p.year).padStart(4, '0')}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

function utcFromArt(year: number, month: number, day: number, hourArt: number): Date {
  return new Date(Date.UTC(year, month - 1, day, hourArt + 3, 0, 0));
}

export function nightlyWindowUtc(
  dateKey?: string,
  now: Date = new Date(),
): {
  startUtc: Date;
  endUtc: Date;
} {
  let y: number;
  let m: number;
  let d: number;
  if (dateKey) {
    const [yy, mm, dd] = dateKey.split('-').map(Number);
    y = yy!;
    m = mm!;
    d = dd!;
  } else {
    const p = artParts(now);
    y = p.year;
    m = p.month;
    d = p.day;
  }
  return {
    startUtc: utcFromArt(y, m, d, 0),
    endUtc: new Date(utcFromArt(y, m, d, 0).getTime() + 6 * 3_600_000),
  };
}

export function freshnessHours(capturedIso: string, now: Date = new Date()): number {
  const captured = new Date(capturedIso);
  const diffMs = now.getTime() - captured.getTime();
  return Math.max(0, Math.round((diffMs / 3_600_000) * 10) / 10);
}
