/**
 * Runtime configuration persisted in localStorage.
 * All services read from here so the user can update the URLs
 * from the Ajustes screen without touching the source code.
 */

const KEY_APPS_SCRIPT = "ignite-apps-script-url";
const KEY_SHEETS_CSV = "ignite-sheets-csv-url";

/** Default fallbacks (can be empty — will show an error when called without config) */
const DEFAULT_APPS_SCRIPT =
  "https://script.google.com/macros/s/AKfycbytpBPyo5XOSHYmlLw999JJIQJkFt8H2fb-FlWAd0baKOo_iAWieoQ1eMt3UdlTk18XSw/exec";
const DEFAULT_SHEETS_CSV =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vRa4rE-Hzk6fKAGlZmxPna-uKQfv-ufd9yxP3U3EmtHWzeuxBDVCyjNTMxJWurqY9JXxDN2zWznbr8C/pub?gid=0&single=true&output=csv";

// ─── Apps Script Web App URL ──────────────────────────────────────────────────

export function getAppsScriptUrl(): string {
  return localStorage.getItem(KEY_APPS_SCRIPT) ?? DEFAULT_APPS_SCRIPT;
}

export function saveAppsScriptUrl(url: string): void {
  localStorage.setItem(KEY_APPS_SCRIPT, url.trim());
}

// ─── Google Sheets CSV URL ────────────────────────────────────────────────────

/**
 * Derives the CSV export URL from a standard Google Sheets share URL.
 * Accepts:
 *  - Already-correct ?output=csv URLs (returned as-is)
 *  - Standard /edit URLs → converted to /pub?...&output=csv
 *  - Published /pub URLs without output=csv → adds the param
 */
function toSheetsCsvUrl(raw: string): string {
  const trimmed = raw.trim();

  // Already a CSV export URL
  if (trimmed.includes("output=csv")) return trimmed;

  // /pub URL without output=csv → add it
  if (trimmed.includes("/pub")) {
    const sep = trimmed.includes("?") ? "&" : "?";
    return `${trimmed}${sep}output=csv`;
  }

  // Standard /edit URL → convert to /pub?gid=0&single=true&output=csv
  const base = trimmed
    .replace(/\/edit.*$/, "")
    .replace(/\/view.*$/, "")
    .replace("spreadsheets/d/", "spreadsheets/d/e/");

  // If already has /e/ form (published ID), convert properly
  // Most share URLs are like .../d/SPREADSHEET_ID/edit
  // Published CSV is .../d/e/PUBLISHED_KEY/pub?gid=0&single=true&output=csv
  // We can't derive the published key from the edit URL automatically, so we
  // keep the URL as-is and let the user paste the correct one.
  // For now, just append the CSV parameters to whatever they pasted.
  const sep = trimmed.includes("?") ? "&" : "?";
  return `${trimmed}${sep}output=csv`;
}

export function getSheetsCsvUrl(): string {
  const saved = localStorage.getItem(KEY_SHEETS_CSV);
  return saved ? toSheetsCsvUrl(saved) : DEFAULT_SHEETS_CSV;
}

export function saveSheetsCsvUrl(url: string): void {
  localStorage.setItem(KEY_SHEETS_CSV, url.trim());
}

// ─── Connection test ──────────────────────────────────────────────────────────

export interface ConnectionStatus {
  ok: boolean;
  error?: string;
}

/** Quick HEAD/GET probe to verify the Apps Script URL is reachable */
export async function testAppsScriptConnection(): Promise<ConnectionStatus> {
  const url = getAppsScriptUrl();
  if (!url) return { ok: false, error: "URL no configurada" };
  try {
    const res = await fetch(url, { method: "GET", cache: "no-cache" });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const json = await res.json();
    // Apps Script returns { callUps: [...], sessions: [...] }
    if (typeof json === "object" && ("callUps" in json || "sessions" in json)) {
      return { ok: true };
    }
    return { ok: false, error: "Respuesta inesperada del servidor" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Error de red" };
  }
}
