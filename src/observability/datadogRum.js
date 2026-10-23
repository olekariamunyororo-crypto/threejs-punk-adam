/**
 * Re-exports Mixpanel telemetry under the previous Datadog-oriented names
 * so existing main.js imports keep working.
 * @see ./mixpanel.js
 * @see docs/OBSERVABILITY.md
 */
export {
  initMixpanel as initDatadogRum,
  trackAction,
  trackError,
  trackTiming,
  isTelemetryEnabled,
} from "./mixpanel.js";
