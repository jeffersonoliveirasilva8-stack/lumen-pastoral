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

function addDays(date: Date, days: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

function toDateString(date: Date): string {
  return date.toISOString().split('T')[0]
}

async function wasAlertSentToday(
  supabase: ReturnType<typeof createClient>,
  paroquia_id: string,
  alert_type: string,
): Promise<boolean> {
  const today = toDateString(new Date())
  const { data } = await supabase
    .from('subscription_alerts')
    .select('id')
    .eq('paroquia_id', paroquia_id)
    .eq('alert_type', alert_type)
    .eq('sent_date', today)
    .limit(1)
  return (data?.length ?? 0) > 0
}

async function recordAndSendAlert(
  supabase: ReturnType<typeof createClient>,
  paroquia_id: string,
  alert_type: string,
  email: string,
  message: string,
) {
  const today = toDateString(new Date())
  await supabase.from('subscription_alerts').insert({
    paroquia_id,
    alert_type,
    sent_date: today,
    sent_to_email: email,
  })

  // Implementação real de e-mail é futura — log por ora
  console.log(`[BILLING ALERT] ${alert_type} → ${email}: ${message}`)
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS })
  }

  try {
    const supabase = createClient(getEnv('SUPABASE_URL'), getEnv('SUPABASE_SERVICE_ROLE_KEY'))
    const now = new Date()
    let alertsSent = 0

    // --- Alertas de trial expirando ---
    const trialWarningDays = [7, 3, 1]

    for (const daysLeft of trialWarningDays) {
      const targetDate = addDays(now, daysLeft)
      const dateStart = new Date(targetDate)
      dateStart.setHours(0, 0, 0, 0)
      const dateEnd = new Date(targetDate)
      dateEnd.setHours(23, 59, 59, 999)

      const { data: subs } = await supabase
        .from('subscriptions')
        .select('paroquia_id, paroquias(nome, email_contato)')
        .eq('status', 'trial')
        .gte('trial_until', dateStart.toISOString())
        .lte('trial_until', dateEnd.toISOString())

      for (const sub of subs ?? []) {
        const paroquia = Array.isArray(sub.paroquias) ? sub.paroquias[0] : sub.paroquias
        const email = paroquia?.contato_email
        if (!email) continue

        const alertType = `trial_${daysLeft}d`
        const alreadySent = await wasAlertSentToday(supabase, sub.paroquia_id, alertType)
        if (alreadySent) continue

        await recordAndSendAlert(
          supabase,
          sub.paroquia_id,
          alertType,
          email,
          `Seu período de teste expira em ${daysLeft} dia(s). Assine agora para continuar usando o Lumen Pastoral.`,
        )
        alertsSent++
      }
    }

    // --- Alertas de past_due ---
    const pastDueWarningDays = [1, 7, 15, 30]

    for (const daysAgo of pastDueWarningDays) {
      const targetDate = addDays(now, -daysAgo)
      const dateStart = new Date(targetDate)
      dateStart.setHours(0, 0, 0, 0)
      const dateEnd = new Date(targetDate)
      dateEnd.setHours(23, 59, 59, 999)

      const { data: subs } = await supabase
        .from('subscriptions')
        .select('paroquia_id, paroquias(nome, email_contato)')
        .eq('status', 'past_due')
        .gte('updated_at', dateStart.toISOString())
        .lte('updated_at', dateEnd.toISOString())

      for (const sub of subs ?? []) {
        const paroquia = Array.isArray(sub.paroquias) ? sub.paroquias[0] : sub.paroquias
        const email = paroquia?.contato_email
        if (!email) continue

        const alertType = `past_due_${daysAgo}d`
        const alreadySent = await wasAlertSentToday(supabase, sub.paroquia_id, alertType)
        if (alreadySent) continue

        await recordAndSendAlert(
          supabase,
          sub.paroquia_id,
          alertType,
          email,
          `Sua assinatura está em atraso há ${daysAgo} dia(s). Regularize o pagamento para evitar a suspensão do acesso.`,
        )
        alertsSent++
      }
    }

    return new Response(JSON.stringify({ ok: true, alerts_sent: alertsSent }), {
      status: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('send-billing-alerts error:', err)
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }
})
