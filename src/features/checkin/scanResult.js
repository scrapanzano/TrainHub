const REFUSAL = {
  unknown: {
    title: 'Badge not recognised',
    message: 'That badge is not one of ours. No check-in was recorded.',
  },
  used: {
    title: 'Badge already used',
    message: 'Ask the member for a fresh badge. No check-in was recorded.',
  },
  expired: {
    title: 'Badge expired',
    message: 'Ask the member to reopen their badge. No check-in was recorded.',
  },
  suspended: {
    title: 'Subscription suspended',
    message: 'Access is not active. No check-in was recorded.',
  },
}

/** Turn the server result into one unambiguous scanner state. */
export function scanResultView(result) {
  if (result?.status === 'ok') {
    return {
      accepted: true,
      title: result.full_name || 'Access granted',
      message: 'Check-in recorded. Subscription active.',
    }
  }

  const refusal = REFUSAL[result?.status]
  return {
    accepted: false,
    title: refusal?.title ?? 'Check-in failed',
    message: refusal?.message ?? result?.message ?? 'No check-in was recorded.',
  }
}
