/**
 * Best-effort mirror of backend/app/routing.py's COUNTRY_TO_REGION, used only
 * to compute the X-Client-Location header sent on registration (see
 * api/client.ts's `register` call). This is NEVER authoritative — the
 * account's real `location` field is always computed server-side from the
 * validated country_code, on whichever region's backend actually receives
 * the request (see Lambda@Edge's jwt-validator-lambda.js.tpl for how the
 * header is consumed). If this table drifts out of sync with the backend's
 * copy, the only consequence is a registration call landing on a
 * sub-optimal region — extra latency, never incorrect data.
 *
 * Keep the groupings identical to backend/app/routing.py's COUNTRY_TO_REGION
 * when either changes — see that file's own comments for the reasoning
 * behind non-geographic groupings (PK -> apac, GH/NG/KE/ZA/TR -> eu).
 */
const COUNTRY_TO_LOCATION_HINT: Record<string, string> = {
  AT: 'eu',
  BE: 'eu',
  BG: 'eu',
  CY: 'eu',
  CZ: 'eu',
  DE: 'eu',
  DK: 'eu',
  EE: 'eu',
  ES: 'eu',
  FI: 'eu',
  FR: 'eu',
  GR: 'eu',
  HR: 'eu',
  HU: 'eu',
  IE: 'eu',
  IT: 'eu',
  LT: 'eu',
  LU: 'eu',
  LV: 'eu',
  MT: 'eu',
  NL: 'eu',
  PL: 'eu',
  PT: 'eu',
  RO: 'eu',
  SE: 'eu',
  SI: 'eu',
  SK: 'eu',
  GB: 'eu',
  NO: 'eu',
  IS: 'eu',
  LI: 'eu',
  UA: 'eu',
  US: 'us',
  CA: 'us',
  MX: 'us',
  BR: 'br',
  AR: 'br',
  CL: 'br',
  CO: 'br',
  SG: 'apac',
  MY: 'apac',
  ID: 'apac',
  PH: 'apac',
  TH: 'apac',
  VN: 'apac',
  JP: 'apac',
  KR: 'apac',
  AU: 'apac',
  NZ: 'apac',
  HK: 'apac',
  TW: 'apac',
  PK: 'apac',
  IN: 'in',
  SA: 'me',
  AE: 'me',
  QA: 'me',
  KW: 'me',
  BH: 'me',
  OM: 'me',
  EG: 'me',
  CN: 'cn',
  RU: 'ru',
  GH: 'eu',
  NG: 'eu',
  KE: 'eu',
  ZA: 'eu',
  TR: 'eu',
};

/**
 * Returns a best-effort location hint for the given country code, or
 * `undefined` if unrecognised. Deliberately does NOT fall back to a default
 * location the way the backend's resolve_region() does — sending no header
 * at all is safer than a wrong guess, since the Lambda@Edge treats a missing
 * hint as "use the bootstrap region" (always reachable) rather than risking
 * a guess that resolves to a region that isn't deployed.
 */
export function locationHint(countryCode: string): string | undefined {
  return COUNTRY_TO_LOCATION_HINT[countryCode.trim().toUpperCase()];
}
