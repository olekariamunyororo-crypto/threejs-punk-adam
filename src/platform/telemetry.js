/**
 * Optional Datadog RUM + custom actions.
 * Enable when VITE_DD_APPLICATION_ID and VITE_DD_CLIENT_TOKEN are set
 * (and optionally FEATURES.telemetry).
 *
 * Full design: docs/OBSERVABILITY.md
 *
 * Does not import @datadog/browser-rum until those env vars exist,
 * so default builds stay dependency-light. After `npm i @datadog/browser-rum`,
 * replace the dynamic import path below if the package is installed.
 */

let enabled = false
let rum = null

function envEnabled() {
  return Boolean(
    import.meta.env.VITE_DD_APPLICATION_ID &&
      import.meta.env.VITE_DD_CLIENT_TOKEN,
  )
}

/**
 * Call once near the start of main.js (before heavy world load).
 * @param {{ force?: boolean }} [opts]
 */
export async function initTelemetry(opts = {}) {
  if (enabled) return rum
  if (!opts.force && !envEnabled()) {
    return null
  }

  try {
    // Install with: npm i @datadog/browser-rum
    const mod = await import('@datadog/browser-rum')
    rum = mod.datadogRum
    rum.init({
      applicationId: import.meta.env.VITE_DD_APPLICATION_ID,
      clientToken: import.meta.env.VITE_DD_CLIENT_TOKEN,
      site: import.meta.env.VITE_DD_SITE || 'datadoghq.com',
      service: import.meta.env.VITE_DD_SERVICE || 'threejs-punk-adam',
      env: import.meta.env.VITE_DD_ENV || import.meta.env.MODE || 'development',
      version: import.meta.env.VITE_APP_VERSION || '0.0.1',
      sessionSampleRate: Number(import.meta.env.VITE_DD_SESSION_SAMPLE_RATE ?? 100),
      sessionReplaySampleRate: Number(
        import.meta.env.VITE_DD_REPLAY_SAMPLE_RATE ?? 0,
      ),
      trackUserInteractions: true,
      trackResources: true,
      trackLongTasks: true,
      defaultPrivacyLevel: 'mask-user-input',
    })
    enabled = true
    return rum
  } catch (err) {
    // Package missing or init failed — game continues without RUM
    console.warn('[telemetry] RUM not active:', err?.message || err)
    return null
  }
}

/** @param {string} name @param {Record<string, unknown>} [context] */
export function trackAction(name, context = {}) {
  if (!enabled || !rum) return
  try {
    rum.addAction(name, context)
  } catch {
    /* ignore */
  }
}

/** @param {string} name */
export function trackError(error, context = {}) {
  if (!enabled || !rum) return
  try {
    rum.addError(error, context)
  } catch {
    /* ignore */
  }
}

export function isTelemetryEnabled() {
  return enabled
}
