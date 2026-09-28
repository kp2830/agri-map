/**
 * Real growing-season month ranges for this project's custom (non-AMED) crop models, and the
 * shared gate logic both Sunflower RF and Safflower RF use to decide whether a prediction should
 * even be attempted for the month the user currently has selected in the UI.
 *
 * WHY THIS EXISTS: Sunflower RF was temporarily hidden from the frontend
 * (client/src/lib/featureFlags.ts) specifically because the month-based predictive Crop Outlook
 * feature (cropPrediction.ts) launched without an equivalent concept for the custom RF models --
 * Sunflower RF always evaluates its fixed training windows (April/May/June 2026) regardless of
 * which month the user has selected, so showing its result next to a Crop Outlook for, say,
 * October would be genuinely misleading (the RF's answer has nothing to do with October; it is
 * always describing the same fixed April-June evidence). This gate fixes that: a prediction is
 * only attempted when the SELECTED MONTH falls within the real real-world period this crop could
 * plausibly be sown, growing, or standing unharvested in a field -- outside that range, the
 * endpoint returns `OUT_OF_SEASON` immediately, with no CDSE spend, rather than an irrelevant
 * answer.
 *
 * These ranges are the FULL real sowing-to-harvest window for the SPECIFIC real cycle each
 * project's model was actually trained on -- not a generic "safflower is grown somewhere in
 * India" claim (both crops are grown in multiple real Indian seasons/regions; this project's
 * models only represent one specific real cycle each, see the citations below).
 */

export type ProjectCrop = 'sunflower' | 'safflower'

/**
 * Sunflower RF v0/v1 was trained on the Kurukshetra-Karnal, Haryana real fields (see
 * training/sunflower/), whose real hypothesis (April green -> May flowering -> June
 * harvested/brown, per kurukshetra_karnal_sunflower_weak_label_report.md) matches India's real
 * Zaid/summer sunflower cycle specifically: sown from the second fortnight of February, ~90-110
 * day duration, consistent with an April/May/June growing-to-harvest window (source: real web
 * search on India's sunflower crop calendar, Kharif/Rabi/Zaid sowing windows, Sep 2026). This
 * project's Haryana data and fixed feature windows represent THIS cycle, not Sunflower's other
 * real Kharif (June-Aug sown) or Rabi (Sep-Nov sown) cycles grown elsewhere in India, which this
 * model was never trained or validated against.
 */
const SUNFLOWER_SEASON = { startMonth: 2, endMonth: 6 } // February - June

/**
 * Safflower RF v0 was trained on the Latur, Maharashtra real fields (see training/safflower/),
 * whose real ~130-135 day rabi cycle is sown late September-October and harvested February-March
 * (source: real web search on India's safflower crop calendar, Sep 2026 -- see
 * server/src/services/agricultural/safflower/config.ts's own citation). This project's Latur
 * data and fixed feature windows represent this specific rabi cycle.
 */
const SAFFLOWER_SEASON = { startMonth: 10, endMonth: 3 } // October - March (wraps the year boundary)

const SEASONS: Record<ProjectCrop, { startMonth: number; endMonth: number }> = {
  sunflower: SUNFLOWER_SEASON,
  safflower: SAFFLOWER_SEASON,
}

/** True if `month` (1-12) falls within [startMonth, endMonth], handling a range that wraps the
 *  Dec->Jan boundary (e.g. Safflower's October-March) the same way client/src's own
 *  circularMonthRange/windowsOverlap logic does for the Crop Outlook feature. */
function isMonthInRange(month: number, startMonth: number, endMonth: number): boolean {
  if (startMonth <= endMonth) return month >= startMonth && month <= endMonth
  return month >= startMonth || month <= endMonth
}

/** The real, single source of truth both sunflowerRf/service.ts and safflowerRf/service.ts call
 *  before doing any real CDSE/inference work for a given selected month. */
export function isCropInSeasonForMonth(crop: ProjectCrop, selectedMonth: number): boolean {
  const season = SEASONS[crop]
  return isMonthInRange(selectedMonth, season.startMonth, season.endMonth)
}

export function getSeasonRange(crop: ProjectCrop): { startMonth: number; endMonth: number } {
  return SEASONS[crop]
}
