/**
 * Optional Datadog Browser RUM.
 * Enabled only when VITE_DD_APPLICATION_ID and VITE_DD_CLIENT_TOKEN are set.
 * @see OBSERVABILITY.md
 */

let rumReady = false;

function env(key, fallback = "") {
  try {
    return import.meta.env?.[key] ?? fallback;
  } catch {
    return fallback;
  }
}

/**
 * Initialize RUM once. Safe to call multiple times.
 * @returns {Promise<boolean>} true if RUM started
 */
export async function initDatadogRum() {
  if (rumReady) return true;

  const applicationId = env("VITE_DD_APPLICATION_ID");
  const clientToken = env("VITE_DD_CLIENT_TOKEN");
  if (!applicationId || !clientToken) {
    return false;
  }

  const site = env("VITE_DD_SITE", "datadoghq.com");
  const service = env("VITE_DD_SERVICE", "threejs-punk-adam");
  const envName = env("VITE_DD_ENV", env("MODE", "production"));

  try {
    const { datadogRum } = await import("@datadog/browser-rum");
    datadogRum.init({
      applicationId,
      clientToken,
      site,
      service,
      env: envName,
      sessionSampleRate: 100,
      sessionReplaySampleRate: 0,
      trackUserInteractions: true,
      trackResources: true,
      trackLongTasks: true,
      defaultPrivacyLevel: "mask-user-input",
    });
    rumReady = true;
    datadogRum.addAction("boot_start", { service, env: envName });
    return true;
  } catch (err) {
    console.warn("[observability] Datadog RUM init failed:", err);
    return false;
  }
}

export function trackAction(name, context = {}) {
  if (!rumReady) return;
  try {
    import("@datadog/browser-rum").then(({ datadogRum }) => {
      datadogRum.addAction(name, context);
    });
  } catch {
    /* ignore */
  }
}

export function trackError(error, context = {}) {
  if (!rumReady) return;
  try {
    import("@datadog/browser-rum").then(({ datadogRum }) => {
      datadogRum.addError(error, context);
    });
  } catch {
    /* ignore */
  }
}

/** Attach a numeric timing as action context (use Generate Metrics in DD). */
export function trackTiming(name, durationMs, context = {}) {
  trackAction(name, { ...context, durationMs: Math.round(durationMs) });
}
