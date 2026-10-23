/**
 * Mixpanel browser analytics (EU project).
 * Project: https://eu.mixpanel.com/project/4076561
 * Enable with VITE_MIXPANEL_TOKEN (project token from Mixpanel → Settings → Project).
 * API host defaults to api-eu.mixpanel.com for EU data residency.
 *
 * @see docs/OBSERVABILITY.md
 */

let ready = false;
let mp = null;

function env(key, fallback = "") {
  try {
    return import.meta.env?.[key] ?? fallback;
  } catch {
    return fallback;
  }
}

/**
 * Initialize Mixpanel once. Safe to call multiple times.
 * @returns {Promise<boolean>}
 */
export async function initMixpanel() {
  if (ready) return true;

  const token = env("VITE_MIXPANEL_TOKEN");
  if (!token) {
    return false;
  }

  const apiHost = env("VITE_MIXPANEL_API_HOST", "https://api-eu.mixpanel.com");
  const envName = env("VITE_MIXPANEL_ENV", env("MODE", "production"));

  try {
    const mod = await import("mixpanel-browser");
    mp = mod.default;
    mp.init(token, {
      api_host: apiHost,
      persistence: "localStorage",
      batch_requests: true,
      ignore_dnt: false,
      // Autocapture off — we send explicit game events only
      autocapture: false,
    });
    mp.register({
      service: "threejs-punk-adam",
      env: envName,
      app_version: env("VITE_APP_VERSION", "0.0.1"),
    });
    ready = true;
    mp.track("boot_start", { env: envName });
    return true;
  } catch (err) {
    console.warn("[observability] Mixpanel init failed:", err);
    return false;
  }
}

/** @deprecated use initMixpanel — kept so older imports still resolve */
export async function initDatadogRum() {
  return initMixpanel();
}

/** @param {string} name @param {Record<string, unknown>} [context] */
export function trackAction(name, context = {}) {
  if (!ready || !mp) return;
  try {
    mp.track(name, context);
  } catch {
    /* ignore */
  }
}

/** @param {unknown} error @param {Record<string, unknown>} [context] */
export function trackError(error, context = {}) {
  if (!ready || !mp) return;
  try {
    const message =
      error instanceof Error
        ? error.message
        : typeof error === "string"
          ? error
          : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    mp.track("error", {
      ...context,
      message,
      stack: stack ? String(stack).slice(0, 2000) : undefined,
    });
  } catch {
    /* ignore */
  }
}

/** @param {string} name @param {number} durationMs @param {Record<string, unknown>} [context] */
export function trackTiming(name, durationMs, context = {}) {
  trackAction(name, { ...context, durationMs: Math.round(durationMs) });
}

export function isTelemetryEnabled() {
  return ready;
}
