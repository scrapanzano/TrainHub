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
  clients: (proId) => ['clients', proId],
  client: (clientId) => ['client', clientId],
  agendaOnDay: (proId, dayISO) => ['agenda', proId, 'day', dayISO],
  // The calendar loads a whole month at once and filters in memory: one request
  // serves both the per-day dots and the selected day's list.
  agendaRange: (proId, fromISO, toISO) => ['agenda', proId, 'range', fromISO, toISO],
  appointment: (appointmentId) => ['appointment', appointmentId],
  nutritionPlan: (memberId) => ['nutritionPlan', memberId],
  availability: (proId) => ['availability', proId],
  bodyMetrics: (memberId) => ['bodyMetrics', memberId],
  clientTraining: (memberId) => ['clientTraining', memberId],
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
  clients: ['clients'],
  // Both `agendaOnDay` and `agendaRange` start with 'agenda', so one prefix
  // invalidates the home agenda and every loaded calendar month together.
  agenda: ['agenda'],
  appointment: ['appointment'],
  nutritionPlan: ['nutritionPlan'],
  availability: ['availability'],
  bodyMetrics: ['bodyMetrics'],
}
