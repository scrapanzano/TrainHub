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
  createPlan: ['createPlan'],
  createNutritionPlan: ['createNutritionPlan'],
  saveBodyMetric: ['saveBodyMetric'],
  createAppointment: ['createAppointment'],
  setAppointmentStatus: ['setAppointmentStatus'],
  setSubscriptionStatus: ['setSubscriptionStatus'],
  addAvailability: ['addAvailability'],
  deleteAvailability: ['deleteAvailability'],
  sendMessage: ['sendMessage'],
  markThreadRead: ['markThreadRead'],
  ensureThread: ['ensureThread'],
  chooseProfessional: ['chooseProfessional'],
  uploadAvatar: ['uploadAvatar'],
  clearAvatar: ['clearAvatar'],
  markNotificationRead: ['markNotificationRead'],
  markNotificationsRead: ['markNotificationsRead'],
  deleteNotification: ['deleteNotification'],
  markNotificationsReadByIds: ['markNotificationsReadByIds'],
  deleteNotificationsByIds: ['deleteNotificationsByIds'],
  markAllNotificationsRead: ['markAllNotificationsRead'],
  deleteAllNotifications: ['deleteAllNotifications'],
}
