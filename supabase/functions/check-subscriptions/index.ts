import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function getEnv(key: string): string {
  const value = Deno.env.get(key)
  if (!value) throw new Error(`Missing environment variable: ${key}`)
  return value
}

async function auditLog(
  supabase: ReturnType<typeof createClient>,
  action: string,
  details: Record<string, unknown>,
) {
  await supabase.from('platform_audit_logs').insert({
    action,
    details,
    created_at: new Date().toISOString(),
  })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS })
  }

  try {
    const supabase = createClient(getEnv('SUPABASE_URL'), getEnv('SUPABASE_SERVICE_ROLE_KEY'))
    const now = new Date()

    const counts = {
      trial_to_past_due: 0,
      past_due_to_suspended: 0,
      suspended_to_blocked: 0,
    }

    // 1. Trial expirado → past_due
    const { data: expiredTrials } = await supabase
      .from('subscriptions')
      .select('id, paroquia_id')
      .eq('status', 'trial')
      .lt('trial_ends_at', now.toISOString())

    for (const sub of expiredTrials ?? []) {
      await supabase.from('subscriptions').update({ status: 'past_due' }).eq('id', sub.id)
      await supabase.from('paroquias').update({ status: 'past_due' }).eq('id', sub.paroquia_id)
      await auditLog(supabase, 'subscription.trial_expired', {
        subscription_id: sub.id,
        paroquia_id: sub.paroquia_id,
        new_status: 'past_due',
      })
      counts.trial_to_past_due++
    }

    // 2. past_due há mais de 7 dias → suspended
    const sevenDaysAgo = new Date(now)
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)

    const { data: pastDueSubs } = await supabase
      .from('subscriptions')
      .select('id, paroquia_id')
      .eq('status', 'past_due')
      .lt('updated_at', sevenDaysAgo.toISOString())

    for (const sub of pastDueSubs ?? []) {
      await supabase.from('subscriptions').update({ status: 'suspended' }).eq('id', sub.id)
      await supabase.from('paroquias').update({ status: 'suspended' }).eq('id', sub.paroquia_id)
      await auditLog(supabase, 'subscription.suspended', {
        subscription_id: sub.id,
        paroquia_id: sub.paroquia_id,
        new_status: 'suspended',
      })
      counts.past_due_to_suspended++
    }

    // 3. suspended há mais de 15 dias → blocked
    const fifteenDaysAgo = new Date(now)
    fifteenDaysAgo.setDate(fifteenDaysAgo.getDate() - 15)

    const { data: suspendedSubs } = await supabase
      .from('subscriptions')
      .select('id, paroquia_id')
      .eq('status', 'suspended')
      .lt('updated_at', fifteenDaysAgo.toISOString())

    for (const sub of suspendedSubs ?? []) {
      await supabase.from('subscriptions').update({ status: 'blocked' }).eq('id', sub.id)
      await supabase
        .from('paroquias')
        .update({ status: 'blocked', blocked_at: now.toISOString() })
        .eq('id', sub.paroquia_id)
      await auditLog(supabase, 'subscription.blocked', {
        subscription_id: sub.id,
        paroquia_id: sub.paroquia_id,
        new_status: 'blocked',
      })
      counts.suspended_to_blocked++
    }

    return new Response(JSON.stringify({ ok: true, counts }), {
      status: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('check-subscriptions error:', err)
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }
})
