// Wetter je Einheit (#54), reine Funktionen (getestet in test/wetter.test.ts), bewusst ohne Importe.
// Quelle: Open-Meteo (kostenlos, ohne Anmeldung). Nur mit Haken unter Konto → Datenquellen → Wetter, weil dafür Startort
// (auf 0,1° gerundet, etwa 10 km) und Startzeit an Open-Meteo gehen. Strava gibt das Wetter über die API nicht heraus,
// Garmins Temperatur am Handgelenk ist durch die Körperwärme verfälscht.

/** Wetter zur Mitte der Einheit: t °C, ta gefühlt °C, hu Luftfeuchte %, ws Wind km/h, wd Windrichtung °, c WMO-Code */
export interface Wx { t: number; ta: number | null; hu: number | null; ws: number | null; wd: number | null; c: number | null }

/** Ort auf 0,1° runden (etwa 10 km), damit Open-Meteo keine genaue Adresse sieht */
export const coarse = (x: number) => Math.round(x * 10) / 10;

/** Abfrage-Adresse: jüngere Tage über die Vorhersage-API (mit Vergangenheit), ältere über das Archiv (etwa 5 Tage Verzug) */
export function wxUrl(lat: number, lng: number, day: string, today: string): string {
  const age = (Date.parse(today + "T12:00:00Z") - Date.parse(day + "T12:00:00Z")) / 864e5;
  const base = age <= 60 ? "https://api.open-meteo.com/v1/forecast" : "https://archive-api.open-meteo.com/v1/archive";
  const q = new URLSearchParams({
    latitude: String(coarse(lat)), longitude: String(coarse(lng)), start_date: day, end_date: day, timezone: "auto",
    hourly: "temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,wind_direction_10m,weather_code",
  });
  return base + "?" + q.toString();
}

/** Stunde zur Mitte der Einheit aus der Open-Meteo-Antwort (Ortszeit des Startorts, `start` = „HH:MM“) */
export function pickHour(json: unknown, start: string, minutes: number): Wx | null {
  const h = (json as any)?.hourly;
  if (!h || !Array.isArray(h.time) || !Array.isArray(h.temperature_2m)) return null;
  const m = /^(\d{1,2}):(\d{2})/.exec(start || "");
  if (!m) return null;
  const mid = Number(m[1]) * 60 + Number(m[2]) + (minutes || 0) / 2;
  const i = Math.max(0, Math.min(h.time.length - 1, Math.round(mid / 60)));
  const v = (arr: unknown, d = 0) => { const x = Array.isArray(arr) ? arr[i] : null; return typeof x === "number" && isFinite(x) ? Math.round(x * 10 ** d) / 10 ** d : null; };
  const t = v(h.temperature_2m, 1);
  if (t == null) return null;
  return { t, ta: v(h.apparent_temperature, 1), hu: v(h.relative_humidity_2m), ws: v(h.wind_speed_10m), wd: v(h.wind_direction_10m), c: v(h.weather_code) };
}

/** WMO-Wettercode → Text und Symbolname (icons.js.txt) */
export function wxKind(c: number | null): { label: string; icon: string } {
  if (c == null) return { label: "", icon: "wolke" };
  if (c === 0) return { label: "Klar", icon: "sonne" };
  if (c <= 2) return { label: "Leicht bewölkt", icon: "sonneWolke" };
  if (c === 3) return { label: "Bewölkt", icon: "wolke" };
  if (c <= 48) return { label: "Nebel", icon: "nebel" };
  if (c <= 67 || (c >= 80 && c <= 82)) return { label: "Regen", icon: "regen" };
  if (c <= 77 || c === 85 || c === 86) return { label: "Schnee", icon: "schnee" };
  return { label: "Gewitter", icon: "gewitter" };
}

/** Windrichtung als Himmelsrichtung (woher der Wind kommt) */
export const windDir = (deg: number | null) => (deg == null ? "" : ["N", "NO", "O", "SO", "S", "SW", "W", "NW"][Math.round(((deg % 360) + 360) % 360 / 45) % 8]);
