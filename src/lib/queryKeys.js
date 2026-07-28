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
  exerciseCatalogue: () => ['exerciseCatalogue'],
}

// Prefixes, for invalidating a whole family at once.  `invalidateQueries`
// matches by prefix -- `partialMatchKey` walks only the given key's length --
// so `['session']` reaches `['session', anyId]`.  Invalidating the family
// rather than one id is deliberate: it cannot be defeated by a caller that
// forgets to pass the id, which would otherwise produce `['session', undefined]`
// and silently match nothing.
export const queryPrefixes = {
  plan: ['plan'],
  session: ['session'],
  sessionLogs: ['sessionLogs'],
  rewards: ['rewards'],
}
