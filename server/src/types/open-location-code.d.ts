/** No published types for this package — minimal ambient declaration covering only what
 *  lib/plusCode/index.ts actually uses. Verified against the real package (v1.0.3, Google's
 *  official reference implementation) by decoding a known real field ID and confirming the
 *  result matches that field's real centroid within ~7m. */
declare module 'open-location-code' {
  export interface CodeArea {
    latitudeLo: number
    longitudeLo: number
    latitudeHi: number
    longitudeHi: number
    latitudeCenter: number
    longitudeCenter: number
    codeLength: number
  }

  export class OpenLocationCode {
    isValid(code: string): boolean
    isFull(code: string): boolean
    isShort(code: string): boolean
    decode(code: string): CodeArea
    encode(latitude: number, longitude: number, codeLength?: number): string
  }
}
