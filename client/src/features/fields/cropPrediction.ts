import type { MonitoringSeason, NormalizedFieldProperties } from '../../types/agricultural'
import { dayOfYear, inferSeasonalCrop, monthToReferenceDateSec, windowsOverlap } from './cropDisplay'

export interface MonthRange {
  /** 1-12. */
  startMonth: number
  /** 1-12. Can be numerically less than startMonth when the range crosses the Dec→Jan
   *  boundary (e.g. startMonth: 11, endMonth: 2 means "November–February"). */
  endMonth: number
}

export type CropOutlookBasis = 'previous_year_exact' | 'seasonal_fallback' | 'insufficient_data'

export interface CropOutlook {
  selectedMonth: number
  selectedYear: number
  crop: string | null
  /** 0-100, or null when dataAvailable is false. See predictCropOutlook's docstring for the
   *  exact (fully documented, non-arbitrary) formula. Never confuse with ALU classConfidence
   *  or a raw single-season AMED prediction confidence — this is a distinct, derived metric. */
  confidencePercent: number | null
  sowing: MonthRange | null
  harvest: MonthRange | null
  /** The calendar year the reference evidence actually comes from — selectedYear - 1 for an
   *  exact previous-year match, or whichever year the matched seasonal-fallback season itself
   *  started in. Null when there's no match at all. */
  historicalReferenceYear: number | null
  /** The real start/end timestamps of the specific historical season the prediction is based
   *  on — for display alongside formatTimestamp, exactly like the existing Sowing/Harvest rows
   *  already shown elsewhere in the app. Derived from matchedSeason below; kept as its own
   *  field so presentation components don't need the full MonitoringSeason shape. */
  historicalSeasonRange: { startSec: number; endSec: number } | null
  /** The actual historical season object the prediction is based on — exposed so callers (e.g.
   *  FieldDetailsPanel's "Crop History" section) can find the other historical records that
   *  explain this prediction via getCurrentSeasonHistory, without re-matching by timestamp. */
  matchedSeason: MonitoringSeason | null
  basis: CropOutlookBasis
  dataAvailable: boolean
}

const REFERENCE_LEAP_SAFE_YEAR = 2001 // non-leap — matches dayOfYear's own leap-day convention

/** Day-of-year ordinal window [1st, last day] of `month`, in a fixed non-leap reference year —
 *  "the selected month" expressed the same way a season's own date range already is, so it can
 *  be compared with windowsOverlap. */
function monthWindowOrdinals(month: number): { startOrdinal: number; endOrdinal: number } {
  const startSec = Date.UTC(REFERENCE_LEAP_SAFE_YEAR, month - 1, 1) / 1000
  const endSec = Date.UTC(REFERENCE_LEAP_SAFE_YEAR, month, 0) / 1000 // day 0 of next month = last day of this one
  return { startOrdinal: dayOfYear(startSec), endOrdinal: dayOfYear(endSec) }
}

function monthOf(sec: number): number {
  return new Date(sec * 1000).getUTCMonth() + 1
}

/** The most recently-started historical season whose real, absolute [start, end] window
 *  actually covers `atSec` — i.e. "what was genuinely recorded as happening at this exact
 *  point in time." Mirrors getActiveCropOutcome's own 'observed' check, just evaluated at an
 *  arbitrary reference date instead of always real "now". */
function findObservedAt(seasons: MonitoringSeason[], atSec: number): MonitoringSeason | null {
  const covering = seasons.filter(
    (season) => season.startTimestampSec <= atSec && (!Number.isFinite(season.endTimestampSec) || season.endTimestampSec >= atSec),
  )
  if (covering.length === 0) return null
  return covering.reduce((latest, season) => (season.startTimestampSec > latest.startTimestampSec ? season : latest))
}

/** Every historical season whose calendar day-of-year window overlaps the given month at all
 *  (year discarded, any number of past years) — the evidence pool used both to gauge how
 *  consistently a crop recurs at this time of year and to derive a real sowing/harvest range. */
function seasonsOverlappingMonth(seasons: MonitoringSeason[], month: number): MonitoringSeason[] {
  const { startOrdinal, endOrdinal } = monthWindowOrdinals(month)
  return seasons.filter((season) => {
    if (!Number.isFinite(season.startTimestampSec) || !Number.isFinite(season.endTimestampSec)) return false
    if (season.predictions[0]?.crop === undefined) return false
    return windowsOverlap(startOrdinal, endOrdinal, dayOfYear(season.startTimestampSec), dayOfYear(season.endTimestampSec))
  })
}

/** Smallest circular arc (on a 12-month wheel) covering every given month — handles a
 *  historical sowing/harvest spread that crosses the Dec→Jan boundary (e.g. observed in both
 *  December and January across different years) without wrongly reporting "January–December"
 *  the way a naive min/max would. */
function circularMonthRange(months: number[]): MonthRange {
  const unique = [...new Set(months)].sort((a, b) => a - b)
  if (unique.length === 1) return { startMonth: unique[0], endMonth: unique[0] }

  let maxGap = -1
  let gapStartIndex = 0
  for (let i = 0; i < unique.length; i++) {
    const current = unique[i]
    const next = unique[(i + 1) % unique.length]
    const gap = next > current ? next - current : next + 12 - current
    if (gap > maxGap) {
      maxGap = gap
      gapStartIndex = i
    }
  }
  return { startMonth: unique[(gapStartIndex + 1) % unique.length], endMonth: unique[gapStartIndex] }
}

/**
 * The single source of truth for AgriMap's predictive crop outlook — used for the Crop Outlook
 * card, and (via getPredictedCrop below) for map coloring, crop distribution, and crop
 * filtering, so the whole UI stays consistent for whichever month is selected.
 *
 * Three-tier basis, in order:
 *
 * 1. 'previous_year_exact' — a historical season's real, absolute date range actually covers
 *    the 15th of `selectedMonth` in `selectedYear - 1`. This is the PRIMARY basis: "what
 *    genuinely happened at this exact point in time, one year before the date being asked
 *    about" — real recorded evidence, not an inference.
 * 2. 'seasonal_fallback' — no exact previous-year record exists, so this falls through to the
 *    existing calendar-matching logic (inferSeasonalCrop, unchanged, already used elsewhere in
 *    this app) — the most recent historical season (any year) whose own calendar month/day
 *    window covers the selected month.
 * 3. 'insufficient_data' — neither tier found anything. No crop, confidence, sowing, or harvest
 *    is fabricated in this case; the caller must show an honest empty state.
 *
 * Predicted Crop Confidence = sourceConfidence * consistencyRatio (both terms real, no
 * arbitrary constants):
 *   - sourceConfidence: AMED's own real prediction confidence (0-1) for the matched reference
 *     season's top crop — genuine API evidence.
 *   - consistencyRatio: (# of seasons overlapping this calendar month, across every available
 *     year, that agree with the matched crop) / (# of seasons overlapping this calendar month
 *     at all). A lone matching season with nothing else to compare against scores 1 (no
 *     corroborating OR conflicting evidence — treated as neutral, not penalized); a crop
 *     contested by other years' records at the same time of year scores lower, reflecting real
 *     inconsistency in the historical record.
 *
 * Sowing/harvest are the real observed month range (via circularMonthRange) across every
 * historical season that agrees with the predicted crop — never an invented agricultural
 * calendar. A single agreeing season yields a single-month "range" (start === end).
 */
export function predictCropOutlook(
  properties: NormalizedFieldProperties,
  selectedMonth: number,
  selectedYear: number = new Date().getFullYear(),
): CropOutlook {
  const base = { selectedMonth, selectedYear }
  const insufficient: CropOutlook = {
    ...base,
    crop: null,
    confidencePercent: null,
    sowing: null,
    harvest: null,
    historicalReferenceYear: null,
    historicalSeasonRange: null,
    matchedSeason: null,
    basis: 'insufficient_data',
    dataAvailable: false,
  }

  const seasons = properties.monitoring ?? []
  if (seasons.length === 0) return insufficient

  const previousYearRefSec = monthToReferenceDateSec(selectedMonth, selectedYear - 1)
  const exactMatch = findObservedAt(seasons, previousYearRefSec)

  let matchedSeason: MonitoringSeason | null = null
  let basis: CropOutlookBasis = 'insufficient_data'
  let historicalReferenceYear: number | null = null

  if (exactMatch && exactMatch.predictions[0]?.crop !== undefined) {
    matchedSeason = exactMatch
    basis = 'previous_year_exact'
    historicalReferenceYear = selectedYear - 1
  } else {
    const seasonal = inferSeasonalCrop(seasons, monthToReferenceDateSec(selectedMonth, selectedYear))
    if (seasonal) {
      matchedSeason = seasonal.matchedSeason
      basis = 'seasonal_fallback'
      historicalReferenceYear = new Date(matchedSeason.startTimestampSec * 1000).getUTCFullYear()
    }
  }

  if (!matchedSeason) return insufficient

  const crop = matchedSeason.predictions[0].crop
  const sourceConfidence = matchedSeason.predictions[0].confidence

  const overlapping = seasonsOverlappingMonth(seasons, selectedMonth)
  const agreeing = overlapping.filter((season) => season.predictions[0]?.crop === crop)
  const consistencyRatio = overlapping.length > 0 ? agreeing.length / overlapping.length : 1
  const confidencePercent = Math.round(100 * Math.max(0, Math.min(1, sourceConfidence * consistencyRatio)))

  const sowingMonths = agreeing.map((season) => monthOf(season.startTimestampSec))
  const harvestMonths = agreeing.map((season) => monthOf(season.endTimestampSec))

  return {
    ...base,
    crop,
    confidencePercent,
    sowing: sowingMonths.length > 0 ? circularMonthRange(sowingMonths) : null,
    harvest: harvestMonths.length > 0 ? circularMonthRange(harvestMonths) : null,
    historicalReferenceYear,
    historicalSeasonRange: { startSec: matchedSeason.startTimestampSec, endSec: matchedSeason.endTimestampSec },
    matchedSeason,
    basis,
    dataAvailable: true,
  }
}

/** Convenience accessor for call sites that only need the predicted crop identity (map
 *  coloring, crop distribution, crop filtering) — never a separate calculation from
 *  predictCropOutlook, just its `.crop` field. */
export function getPredictedCrop(
  properties: NormalizedFieldProperties,
  selectedMonth: number,
  selectedYear: number = new Date().getFullYear(),
): string | null {
  return predictCropOutlook(properties, selectedMonth, selectedYear).crop
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

export function formatMonthName(month: number): string {
  return MONTH_NAMES[month - 1] ?? String(month)
}

export function formatMonthRange(range: MonthRange): string {
  if (range.startMonth === range.endMonth) return formatMonthName(range.startMonth)
  return `${formatMonthName(range.startMonth)} – ${formatMonthName(range.endMonth)}`
}

export function formatOutlookBasis(basis: CropOutlookBasis): string {
  switch (basis) {
    case 'previous_year_exact':
      return "Previous year's corresponding historical data"
    case 'seasonal_fallback':
      return 'Historical seasonal pattern (nearest matching year on record)'
    case 'insufficient_data':
      return 'Insufficient historical data'
  }
}
