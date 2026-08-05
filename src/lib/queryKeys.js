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
  // Every run key starts with 'runs', so one prefix invalidates the open run,
  // the plan's fortnight and any loaded run's logs together.
  openRun: (memberId) => ['runs', 'open', memberId],
  runsSince: (memberId, sinceISO) => ['runs', 'since', memberId, sinceISO],
  runLogs: (runId) => ['runs', 'logs', runId],
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
  // Keyed on the pair: `threads` is unique per (member, pro), so a member who
  // switches professional has one thread per professional, not one thread.
  memberThread: (memberId, proId) => ['chat', 'memberThread', memberId, proId],
  threads: (proId) => ['chat', 'threads', proId],
  threadMessages: (threadId) => ['chat', 'messages', threadId],
  unreadCount: (userId) => ['chat', 'unread', userId],
  professionals: () => ['professionals'],
  memberAppointments: (memberId, fromISO, toISO) => ['appointments', memberId, 'range', fromISO, toISO],
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
  // The open run, the plan's fortnight and every loaded run's logs.
  runs: ['runs'],
  rewards: ['rewards'],
  clients: ['clients'],
  // Both `agendaOnDay` and `agendaRange` start with 'agenda', so one prefix
  // invalidates the home agenda and every loaded calendar month together.
  agenda: ['agenda'],
  // `appointmentsOnDay` and `memberAppointments` are the member's mirror of
  // the two keys above, both starting with 'appointments'.
  appointments: ['appointments'],
  appointment: ['appointment'],
  nutritionPlan: ['nutritionPlan'],
  availability: ['availability'],
  bodyMetrics: ['bodyMetrics'],
  clientTraining: ['clientTraining'],
  // Every chat key starts with 'chat', so one prefix invalidates the thread
  // list, the open conversation and the unread badge together.
  chat: ['chat'],
  professionals: ['professionals'],
}
