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

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS })
  }

  try {
    const supabase = createClient(getEnv('SUPABASE_URL'), getEnv('SUPABASE_SERVICE_ROLE_KEY'))

    const body = await req.json() as { user_id: string; claims: Record<string, unknown> }
    const { user_id, claims } = body

    if (!user_id) {
      return new Response(JSON.stringify({ error: 'user_id is required' }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    // Busca role do usuário
    const { data: userRole } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    const app_role = userRole?.role ?? 'membro'
    const is_super_admin = app_role === 'super_admin'

    // Busca paroquia_id do perfil
    const { data: profile } = await supabase
      .from('profiles')
      .select('paroquia_id')
      .eq('id', user_id)
      .single()

    const paroquia_id = profile?.paroquia_id ?? null

    let plan_slug: string | null = null
    let sub_status: string | null = null

    // Se tem paróquia, busca status da assinatura
    if (paroquia_id) {
      const { data: sub } = await supabase
        .from('subscriptions')
        .select('status, plans(slug)')
        .eq('paroquia_id', paroquia_id)
        .order('created_at', { ascending: false })
        .limit(1)
        .single()

      if (sub) {
        sub_status = sub.status
        const planData = Array.isArray(sub.plans) ? sub.plans[0] : sub.plans
        plan_slug = planData?.slug ?? null
      }
    }

    const enrichedClaims: Record<string, unknown> = {
      ...claims,
      app_role,
      paroquia_id,
      plan_slug,
      sub_status,
      is_super_admin,
    }

    return new Response(JSON.stringify({ claims: enrichedClaims }), {
      status: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('custom-jwt-claims error:', err)
    return new Response(JSON.stringify({ error: 'Erro interno' }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }
})
