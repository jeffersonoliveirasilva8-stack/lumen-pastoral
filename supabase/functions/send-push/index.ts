// Edge Function — send-push v3
// Usa npm:web-push (mesma lib do site de casamento) em vez de criptografia manual.
//
// POST /functions/v1/send-push
// Header: x-push-secret: <INTERNAL_PUSH_SECRET>
// Body: { user_ids?: string[], paroquia_id?: string, title: string, body: string, url?: string }

// @ts-ignore
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// @ts-ignore
import webpush from "npm:web-push@3.6.7";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (d: unknown, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  // Autenticação interna via x-push-secret
  const internalSecret = Deno.env.get("INTERNAL_PUSH_SECRET") ?? "";
  if (!internalSecret) return json({ error: "forbidden" }, 403);
  const callerSecret = req.headers.get("x-push-secret") ?? "";
  const se = new TextEncoder().encode(internalSecret);
  const ce = new TextEncoder().encode(callerSecret);
  if (se.length !== ce.length) return json({ error: "forbidden" }, 403);
  let diff = 0;
  for (let i = 0; i < se.length; i++) diff |= se[i] ^ ce[i];
  if (diff !== 0) return json({ error: "forbidden" }, 403);

  try {
    const vapidPub  = Deno.env.get("VAPID_PUBLIC_KEY")  ?? "";
    const vapidPriv = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
    const subject   = Deno.env.get("VAPID_SUBJECT")     ?? "";

    if (!vapidPub || !vapidPriv || !subject) {
      return json({ error: "VAPID secrets não configurados" }, 500);
    }

    webpush.setVapidDetails(subject, vapidPub, vapidPriv);

    const body = await req.json() as {
      user_ids?:    string[];
      paroquia_id?: string;
      title:        string;
      body:         string;
      url?:         string;
    };
    const { user_ids, paroquia_id, title, body: msgBody, url } = body;

    if (!title) return json({ error: "title obrigatório" }, 400);
    if (!user_ids?.length && !paroquia_id) return json({ error: "user_ids ou paroquia_id obrigatório" }, 400);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    let query = supabase.from("push_subscriptions").select("id, endpoint, p256dh, auth_key");
    if (user_ids?.length) query = query.in("user_id", user_ids);
    else                  query = query.eq("paroquia_id", paroquia_id);

    const { data: subs, error: dbErr } = await query;
    if (dbErr) throw dbErr;
    if (!subs?.length) return json({ sent: 0, failed: 0, removed: 0 });

    const payload = JSON.stringify({ title, body: msgBody ?? "", url: url ?? "/" });
    let sent = 0, failed = 0, removed = 0;
    const toRemove: string[] = [];

    await Promise.allSettled(
      (subs as { id: string; endpoint: string; p256dh: string; auth_key: string }[]).map(async (sub) => {
        try {
          const sendPromise = webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_key } },
            payload,
            { TTL: 86400, urgency: "normal" },
          );
          const timeoutPromise = new Promise<never>((_, reject) =>
            setTimeout(() => reject(Object.assign(new Error("timeout"), { statusCode: 0 })), 15000)
          );
          await Promise.race([sendPromise, timeoutPromise]);
          sent++;
        } catch (e: unknown) {
          const status = (e as { statusCode?: number })?.statusCode;
          console.error("push error", status, (e as { body?: string })?.body ?? String(e));
          if (status === 410 || status === 404) { toRemove.push(sub.id); removed++; }
          else failed++;
        }
      }),
    );

    if (toRemove.length) {
      await supabase.from("push_subscriptions").delete().in("id", toRemove);
    }

    return json({ sent, failed, removed });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});
