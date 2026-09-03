/**
 * Decodes a real ALU field ID — which IS a standard Google Open Location Code ("Plus Code"),
 * confirmed by decoding a known real field ID and finding the result within ~7m of that field's
 * real, independently-known centroid — into the lat/lng needed to drive the existing
 * location-based field search (searchAgriculturalArea). Powers "Search by Field ID": decode the
 * entered ID, run the normal area search at that point, then look for the exact ID in the
 * result. No new field-lookup system — reuses the existing search entirely.
 */
import { OpenLocationCode } from 'open-location-code'

const olc = new OpenLocationCode()

export interface DecodedPlusCode {
  lat: number
  lng: number
}

/** Returns the decoded center point, or `null` if the given string isn't a valid, full Open
 *  Location Code (never throws — callers turn `null` into a real "not found" response, never a
 *  fabricated location). */
export function decodePlusCode(code: string): DecodedPlusCode | null {
  const trimmed = code.trim().toUpperCase()
  if (!olc.isFull(trimmed)) return null
  try {
    const area = olc.decode(trimmed)
    return { lat: area.latitudeCenter, lng: area.longitudeCenter }
  } catch {
    return null
  }
}
