export interface Env {
  DB: D1Database;
  /** Optional: R2-Bucket für Original-.fit-Dateien */
  FILES?: R2Bucket;

  TIMEZONE?: string;
  BACKFILL_DAYS?: string;

  // Secrets
  APP_PASSWORD?: string;
  SESSION_SECRET?: string;
  API_TOKEN?: string;
  GARMIN_API_KEY?: string;
  /** Optional statt Eintrag in der App: eigene Withings-App (#3) */
  WITHINGS_CLIENT_ID?: string;
  WITHINGS_CLIENT_SECRET?: string;
  /** Optional statt Eintrag in der App: eigene Strava-App (#44) */
  STRAVA_CLIENT_ID?: string;
  STRAVA_CLIENT_SECRET?: string;
}
