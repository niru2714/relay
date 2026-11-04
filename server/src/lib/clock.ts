let offsetMs = 0;
export const clock = {
  now: () => new Date(Date.now() + offsetMs),
  advanceMinutes(minutes: number): Date {
    offsetMs += minutes * 60_000;
    return this.now();
  },
  travelTo(date: Date | string | number): Date {
    offsetMs = new Date(date).getTime() - Date.now();
    return this.now();
  },
  reset() {
    offsetMs = 0;
    return this.now();
  },
  offsetMinutes: () => Math.round((offsetMs / 60_000) * 100) / 100,
  isSimulated: () => offsetMs !== 0,
};
