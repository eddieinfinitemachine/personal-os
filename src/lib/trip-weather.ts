// Weather context for AI packing-list generation. Keyless Open-Meteo (same
// no-API-key posture as Nominatim in place-enrich.ts). Trips starting soon get
// the real forecast; trips beyond the 16-day forecast window fall back to the
// same dates last year as "typical" weather. Every failure path returns null —
// callers proceed without weather and let Claude infer season from the
// destination + dates.

const GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search";
const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive";

const FETCH_TIMEOUT_MS = 5000;
// Open-Meteo's forecast covers 16 days; leave a day of slack.
const FORECAST_HORIZON_DAYS = 15;
const MAX_DAYS = 21;

type DailyWeather = {
  time: string[];
  temperature_2m_max: number[];
  temperature_2m_min: number[];
  precipitation_probability_max?: (number | null)[];
  precipitation_sum?: (number | null)[];
  weathercode?: number[];
};

// WMO weather interpretation codes → short labels.
function describeCode(code: number | undefined): string | null {
  if (code == null) return null;
  if (code === 0) return "clear";
  if (code <= 2) return "partly cloudy";
  if (code === 3) return "overcast";
  if (code <= 48) return "fog";
  if (code <= 57) return "drizzle";
  if (code <= 67) return "rain";
  if (code <= 77) return "snow";
  if (code <= 82) return "rain showers";
  if (code <= 86) return "snow showers";
  return "thunderstorms";
}

async function fetchJSON<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Build a compact plain-text weather summary for a destination + date range,
 * suitable for inclusion in a Claude prompt. Returns null when the destination
 * can't be geocoded, dates are missing, or Open-Meteo is unreachable.
 */
export async function tripWeatherSummary(
  destination: string | null | undefined,
  startDate: Date | null | undefined,
  endDate: Date | null | undefined
): Promise<string | null> {
  if (!destination?.trim() || !startDate) return null;

  const geo = await fetchJSON<{
    results?: Array<{
      latitude: number;
      longitude: number;
      name: string;
      country?: string;
      admin1?: string;
    }>;
  }>(
    `${GEOCODE_URL}?name=${encodeURIComponent(destination.trim())}&count=1&language=en&format=json`
  );
  const place = geo?.results?.[0];
  if (!place) return null;

  const start = new Date(startDate);
  const rawEnd = endDate ? new Date(endDate) : start;
  const end =
    rawEnd.getTime() - start.getTime() > MAX_DAYS * 86400_000
      ? new Date(start.getTime() + MAX_DAYS * 86400_000)
      : rawEnd;

  const daysOut = (start.getTime() - Date.now()) / 86400_000;
  const useForecast =
    daysOut <= FORECAST_HORIZON_DAYS &&
    (end.getTime() - Date.now()) / 86400_000 <= FORECAST_HORIZON_DAYS;

  const daily =
    "temperature_2m_max,temperature_2m_min," +
    (useForecast ? "precipitation_probability_max" : "precipitation_sum") +
    ",weathercode";
  let queryStart = start;
  let queryEnd = end;
  if (!useForecast) {
    // Same dates last year as a stand-in for typical conditions.
    queryStart = new Date(start);
    queryStart.setFullYear(queryStart.getFullYear() - 1);
    queryEnd = new Date(end);
    queryEnd.setFullYear(queryEnd.getFullYear() - 1);
  }

  const data = await fetchJSON<{ daily?: DailyWeather }>(
    `${useForecast ? FORECAST_URL : ARCHIVE_URL}?latitude=${place.latitude}&longitude=${place.longitude}` +
      `&daily=${daily}&temperature_unit=fahrenheit&precipitation_unit=inch&timezone=auto` +
      `&start_date=${ymd(queryStart)}&end_date=${ymd(queryEnd)}`
  );
  const d = data?.daily;
  if (!d || !d.time?.length) return null;

  const lines: string[] = [];
  const placeName = [place.name, place.admin1, place.country]
    .filter(Boolean)
    .join(", ");
  lines.push(
    useForecast
      ? `Forecast for ${placeName}:`
      : `Typical weather for ${placeName} on these dates (same dates last year):`
  );
  for (let i = 0; i < d.time.length; i++) {
    const hi = Math.round(d.temperature_2m_max[i]);
    const lo = Math.round(d.temperature_2m_min[i]);
    const cond = describeCode(d.weathercode?.[i]);
    let precip = "";
    if (useForecast) {
      const p = d.precipitation_probability_max?.[i];
      if (p != null && p >= 20) precip = `, ${p}% chance of precipitation`;
    } else {
      const p = d.precipitation_sum?.[i];
      if (p != null && p > 0.05) precip = `, ${p.toFixed(1)}in precipitation`;
    }
    // Historical rows shift the label back to the trip's actual year.
    let label = d.time[i];
    if (!useForecast) {
      const shifted = new Date(d.time[i] + "T00:00:00Z");
      shifted.setUTCFullYear(shifted.getUTCFullYear() + 1);
      label = ymd(shifted);
    }
    lines.push(`  ${label}: ${lo}–${hi}°F${cond ? `, ${cond}` : ""}${precip}`);
  }
  return lines.join("\n");
}
