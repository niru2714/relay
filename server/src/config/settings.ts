import { env } from './env.js';

export interface Settings {
  assignmentTimeoutMinutes: number;
  autoDispatch: boolean;
}
const defaults = (): Settings => ({
  assignmentTimeoutMinutes: env.assignmentTimeoutMinutes,
  autoDispatch: env.autoDispatch,
});
let state: Settings = defaults();

export const settings = {
  get: (): Settings => ({ ...state }),
  update: (patch: Partial<Settings>): Settings => {
    state = { ...state, ...patch };
    return { ...state };
  },
  reset: (): Settings => {
    state = defaults();
    return { ...state };
  },
  timeoutMs: () => state.assignmentTimeoutMinutes * 60_000,
};
