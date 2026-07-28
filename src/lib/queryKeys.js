// One home for every query key.  Invalidation elsewhere refers to these
// functions rather than retyping the array, so a rename cannot leave a stale
// cache entry that nothing invalidates.
export const queryKeys = {
  activePlan: (memberId) => ['plan', memberId],
  session: (sessionId) => ['session', sessionId],
  sessionExercise: (sessionExerciseId) => ['sessionExercise', sessionExerciseId],
  appointmentsOnDay: (memberId, dayISO) => ['appointments', memberId, dayISO],
  sessionLogs: (sessionId) => ['sessionLogs', sessionId],
  rewards: (memberId) => ['rewards', memberId],
}
