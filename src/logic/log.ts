import type { RunState } from "../models/types.ts";

export function pushLog(state: RunState, text: string): RunState {
  const log = [
    ...state.log,
    { id: state.nextLogId, day: state.day, hour: state.hour, text },
  ].slice(-120);
  return { ...state, nextLogId: state.nextLogId + 1, log };
}
