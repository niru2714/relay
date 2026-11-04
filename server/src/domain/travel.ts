export const ZONES = Object.freeze({
  'T. Nagar': { x: 0, y: 0 },
  'Anna Nagar': { x: -2, y: 5 },
  Adyar: { x: 4, y: -4 },
  Guindy: { x: -4, y: -3 },
  Porur: { x: -11, y: 3 },
  Sholinganallur: { x: 8, y: -15 },
  Ambattur: { x: -6, y: 12 },
});
export type ZoneName = keyof typeof ZONES;
export const ZONE_NAMES = Object.freeze(Object.keys(ZONES)) as readonly ZoneName[];
export const ZONE_ENUM = ZONE_NAMES as unknown as [ZoneName, ...ZoneName[]];
export const isKnownZone = (zone: string): zone is ZoneName => Object.hasOwn(ZONES, zone);
const BASE_MINUTES = 5;
const MINUTES_PER_KM = 3.2;
export function travelMinutes(from: string, to: string): number {
  if (!isKnownZone(from) || !isKnownZone(to)) return Number.POSITIVE_INFINITY;
  if (from === to) return BASE_MINUTES;
  const km = Math.hypot(ZONES[from].x - ZONES[to].x, ZONES[from].y - ZONES[to].y);
  return Math.round(BASE_MINUTES + km * MINUTES_PER_KM);
}
