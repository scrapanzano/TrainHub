// Mutation keys are not merely cache bookkeeping like query keys: the persister
// stores a paused mutation BY KEY and, after a reload, finds its function again
// through `setMutationDefaults(key, ...)`.  A key that drifts between the
// registration and the call site produces a mutation with no function, which is
// discarded without an error.  One home for both halves.
export const mutationKeys = {
  logSet: ['logSet'],
  startRun: ['startRun'],
  pauseRun: ['pauseRun'],
  resumeRun: ['resumeRun'],
  endRun: ['endRun'],
  saveRunNote: ['saveRunNote'],
  awardReward: ['awardReward'],
  createSession: ['createSession'],
  createPlan: ['createPlan'],
  deleteSession: ['deleteSession'],
  addSessionExercise: ['addSessionExercise'],
  deleteSessionExercise: ['deleteSessionExercise'],
  saveNutritionPlan: ['saveNutritionPlan'],
  saveMeal: ['saveMeal'],
  deleteMeal: ['deleteMeal'],
  saveBodyMetric: ['saveBodyMetric'],
  createAppointment: ['createAppointment'],
  setAppointmentStatus: ['setAppointmentStatus'],
  addAvailability: ['addAvailability'],
  deleteAvailability: ['deleteAvailability'],
  sendMessage: ['sendMessage'],
  markThreadRead: ['markThreadRead'],
  ensureThread: ['ensureThread'],
  chooseProfessional: ['chooseProfessional'],
}
