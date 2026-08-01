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

async function validateMercadoPagoSignature(payload: string, signature: string): Promise<boolean> {
  const secret = Deno.env.get('MERCADOPAGO_WEBHOOK_SECRET')
  if (!secret) return true // skip validation if secret not configured

  const parts: Record<string, string> = {}
  for (const part of signature.split(',')) {
    const [k, v] = part.split('=')
    if (k && v) parts[k.trim()] = v.trim()
  }

  const ts = parts['ts']
  const receivedHash = parts['v1']
  if (!ts || !receivedHash) return false

  const signedTemplate = `${ts}.${payload}`
  const encoder = new TextEncoder()

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )

  const signatureBuffer = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(signedTemplate))
  const computed = Array.from(new Uint8Array(signatureBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')

  return computed === receivedHash
}

async function fetchMercadoPagoPayment(paymentId: string) {
  const token = getEnv('MERCADOPAGO_ACCESS_TOKEN')
  const res = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) return null
  return res.json() as Promise<{
    id: number
    status: string
    external_reference: string
    transaction_amount: number
    payer: { email: string }
  }>
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS })
  }

  try {
    const supabaseUrl = getEnv('SUPABASE_URL')
    const serviceRoleKey = getEnv('SUPABASE_SERVICE_ROLE_KEY')
    const supabase = createClient(supabaseUrl, serviceRoleKey)

    const url = new URL(req.url)
    const gateway = url.searchParams.get('gateway') ?? 'mercadopago'

    const rawPayload = await req.text()
    const body = JSON.parse(rawPayload) as Record<string, unknown>

    // Validar assinatura
    if (gateway === 'mercadopago') {
      const signature = req.headers.get('x-signature') ?? ''
      const valid = await validateMercadoPagoSignature(rawPayload, signature)
      if (!valid) {
        console.warn('webhook-payment: invalid signature')
        return new Response(JSON.stringify({ ok: false, reason: 'invalid_signature' }), {
          status: 200,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        })
      }
    }

    // Normalizar evento
    const eventType = (body.action ?? body.type ?? 'unknown') as string
    const dataId = ((body.data as Record<string, unknown>)?.id ?? body.id ?? '') as string
    const idempotencyKey = `${gateway}:${dataId}`

    // Upsert webhook_events com ON CONFLICT DO NOTHING
    const { error: upsertError } = await supabase.from('webhook_events').upsert(
      {
        gateway,
        event_type: eventType,
        idempotency_key: idempotencyKey,
        raw_payload: body,
        processed: false,
      },
      { onConflict: 'idempotency_key', ignoreDuplicates: true },
    )

    if (upsertError) {
      console.error('webhook_events upsert error:', upsertError)
    }

    // Processar pagamento aprovado
    if (
      (eventType === 'payment.created' || eventType === 'payment.updated') &&
      dataId
    ) {
      const payment = await fetchMercadoPagoPayment(dataId)

      if (payment && payment.status === 'approved' && payment.external_reference) {
        const [paroquia_id, plan_slug] = payment.external_reference.split(':')

        if (paroquia_id && plan_slug) {
          // Busca plano para saber billing_cycle
          const { data: plan } = await supabase
            .from('plans')
            .select('id, billing_cycle')
            .eq('slug', plan_slug)
            .single()

          const now = new Date()
          const periodEnd = new Date(now)
          if (plan?.billing_cycle === 'monthly') {
            periodEnd.setMonth(periodEnd.getMonth() + 1)
          } else {
            periodEnd.setFullYear(periodEnd.getFullYear() + 1)
          }

          // Atualiza subscription
          const { data: sub } = await supabase
            .from('subscriptions')
            .select('id')
            .eq('paroquia_id', paroquia_id)
            .order('created_at', { ascending: false })
            .limit(1)
            .single()

          if (sub) {
            await supabase.from('subscriptions').update({
              status: 'active',
              plan_id: plan?.id,
              current_period_start: now.toISOString(),
              current_period_end: periodEnd.toISOString(),
              gateway,
              gateway_subscription_id: String(payment.id),
            }).eq('id', sub.id)

            // Cria invoice
            await supabase.from('invoices').insert({
              subscription_id: sub.id,
              paroquia_id,
              amount_brl: payment.transaction_amount,
              status: 'paid',
              gateway,
              gateway_payment_id: String(payment.id),
              paid_at: now.toISOString(),
            })
          } else {
            // Cria subscription se não existir
            const { data: newSub } = await supabase.from('subscriptions').insert({
              paroquia_id,
              plan_id: plan?.id,
              status: 'active',
              current_period_start: now.toISOString(),
              current_period_end: periodEnd.toISOString(),
              gateway,
              gateway_subscription_id: String(payment.id),
            }).select('id').single()

            if (newSub) {
              await supabase.from('invoices').insert({
                subscription_id: newSub.id,
                paroquia_id,
                amount_brl: payment.transaction_amount,
                status: 'paid',
                gateway,
                gateway_payment_id: String(payment.id),
                paid_at: now.toISOString(),
              })
            }
          }

          // Atualiza paróquia
          await supabase.from('paroquias').update({ status: 'active' }).eq('id', paroquia_id)

          // Marca webhook_events como processado
          await supabase
            .from('webhook_events')
            .update({ processed: true, processed_at: now.toISOString() })
            .eq('idempotency_key', idempotencyKey)
        }
      }
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('webhook-payment error:', err)
    // Retorna 200 para o gateway não retentar
    return new Response(JSON.stringify({ ok: false, reason: 'internal_error' }), {
      status: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }
})
