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

async function createMercadoPagoPreference(params: {
  plan_name: string
  plan_slug: string
  price_brl: number
  payer_email: string
  external_reference: string
  notification_url: string
  back_url_success: string
  back_url_failure: string
}) {
  const token = getEnv('MERCADOPAGO_ACCESS_TOKEN')
  const res = await fetch('https://api.mercadopago.com/checkout/preferences', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      items: [
        {
          id: params.plan_slug,
          title: params.plan_name,
          quantity: 1,
          unit_price: params.price_brl,
          currency_id: 'BRL',
        },
      ],
      payer: { email: params.payer_email },
      back_urls: {
        success: params.back_url_success,
        failure: params.back_url_failure,
        pending: params.back_url_failure,
      },
      auto_return: 'approved',
      external_reference: params.external_reference,
      notification_url: params.notification_url,
    }),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`MercadoPago error (${res.status}): ${text}`)
  }

  return res.json() as Promise<{ id: string; init_point: string }>
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS })
  }

  try {
    const supabaseUrl = getEnv('SUPABASE_URL')
    const serviceRoleKey = getEnv('SUPABASE_SERVICE_ROLE_KEY')
    const supabase = createClient(supabaseUrl, serviceRoleKey)

    const body = await req.json() as { plan_slug: string; paroquia_id: string; payer_email: string }
    const { plan_slug, paroquia_id, payer_email } = body

    if (!plan_slug || !paroquia_id || !payer_email) {
      return new Response(
        JSON.stringify({ error: 'plan_slug, paroquia_id e payer_email são obrigatórios' }),
        { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } },
      )
    }

    // Busca plano por slug
    const { data: plan, error: planError } = await supabase
      .from('plans')
      .select('id, name, price_brl, billing_cycle')
      .eq('slug', plan_slug)
      .eq('active', true)
      .single()

    if (planError || !plan) {
      return new Response(
        JSON.stringify({ error: 'Plano não encontrado' }),
        { status: 404, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } },
      )
    }

    const external_reference = `${paroquia_id}:${plan_slug}`
    const notification_url = `${supabaseUrl}/functions/v1/webhook-payment?gateway=mercadopago`

    const appUrl = Deno.env.get('APP_URL') ?? 'https://lumenpastoral.com.br'
    const preference = await createMercadoPagoPreference({
      plan_name: plan.name,
      plan_slug,
      price_brl: plan.price_brl,
      payer_email,
      external_reference,
      notification_url,
      back_url_success: `${appUrl}/assinatura/sucesso`,
      back_url_failure: `${appUrl}/assinatura/falha`,
    })

    return new Response(
      JSON.stringify({ init_point: preference.init_point, preference_id: preference.id }),
      { status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } },
    )
  } catch (err) {
    console.error('create-subscription error:', err)
    return new Response(
      JSON.stringify({ error: 'Erro interno' }),
      { status: 500, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } },
    )
  }
})
