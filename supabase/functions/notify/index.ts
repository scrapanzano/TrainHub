// Sends one Web Push notification to every device a user has registered.
//
// Deployed WITHOUT JWT verification, because its caller is Postgres, which has
// no user session. It authenticates that caller with a shared secret instead.
// Without this check anyone who learned the URL could push anything to anyone.
//
//   npx supabase functions deploy notify --no-verify-jwt
//
// Secrets it expects (set with `npx supabase secrets set NAME=value`):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, NOTIFY_SECRET
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected by the platform.

import webpush from 'npm:web-push@3.6.7'
import { createClient } from 'jsr:@supabase/supabase-js@2'

webpush.setVapidDetails(
  Deno.env.get('VAPID_SUBJECT')!,
  Deno.env.get('VAPID_PUBLIC_KEY')!,
  Deno.env.get('VAPID_PRIVATE_KEY')!,
)

const admin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
)

Deno.serve(async (request) => {
  if (request.headers.get('x-notify-secret') !== Deno.env.get('NOTIFY_SECRET')) {
    return new Response('forbidden', { status: 403 })
  }

  const { user_id, title, body, url } = await request.json()

  const { data: subscriptions, error } = await admin
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('user_id', user_id)

  if (error) return new Response(error.message, { status: 500 })

  const payload = JSON.stringify({ title, body, url })

  const results = await Promise.allSettled(
    (subscriptions ?? []).map((row) =>
      webpush.sendNotification(
        { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
        payload,
      ),
    ),
  )

  // 404 and 410 mean the browser threw the subscription away -- the app was
  // uninstalled, or the user cleared their data. Keeping those rows means
  // pushing to devices that no longer exist, forever.
  const dead = results.flatMap((result, index) =>
    result.status === 'rejected' &&
    [404, 410].includes((result.reason as { statusCode?: number }).statusCode ?? 0)
      ? [subscriptions![index].id]
      : [],
  )
  if (dead.length > 0) await admin.from('push_subscriptions').delete().in('id', dead)

  // Every failure that is NOT a dead endpoint, with what the push service said.
  // `Promise.allSettled` never rejects, so counting its results would report a
  // send that Apple or Google refused as a success -- and the caller is a
  // Postgres trigger that ignores this response entirely, so the log is the
  // only place a human can find out. A VAPID public key that does not match the
  // one the device subscribed with shows up here as a 403, and nowhere else.
  const failed = results.flatMap((result, index) =>
    result.status === 'rejected'
      ? [
          {
            endpoint: subscriptions![index].endpoint.slice(0, 60),
            statusCode: (result.reason as { statusCode?: number })?.statusCode ?? null,
            body: String(
              (result.reason as { body?: string; message?: string })?.body ??
                (result.reason as { message?: string })?.message ??
                result.reason,
            ).slice(0, 300),
          },
        ]
      : [],
  )
  if (failed.length > 0) console.error('push send failed', failed)

  const sent = results.filter((result) => result.status === 'fulfilled').length

  return new Response(JSON.stringify({ sent, failed: failed.length, pruned: dead.length }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
