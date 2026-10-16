// Edge Function — send-push v2
// Envia Web Push com criptografia RFC 8291 (aes128gcm via Web Crypto API).
//
// POST /functions/v1/send-push
// Body: {
//   user_ids?:    string[]   — envia para todos os dispositivos desses usuários
//   paroquia_id?: string     — envia para todos os dispositivos da paróquia
//   title:        string
//   body:         string
//   url?:         string
// }
//
// Secrets obrigatórios:
//   VAPID_PUBLIC_KEY   — base64url, sem padding
//   VAPID_PRIVATE_KEY  — base64url, sem padding (raw P-256 scalar, 32 bytes)
//   VAPID_SUBJECT      — mailto: ou https://

// @ts-ignore
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ─── Utilitários base64url ────────────────────────────────────────────────────

function b64urlDecode(s: string): Uint8Array {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function b64urlEncode(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

// ─── VAPID JWT (RFC 8292) ─────────────────────────────────────────────────────

async function buildVapidJwt(
  audience:   string,
  subject:    string,
  privKeyB64: string,
): Promise<string> {
  const hdr = b64urlEncode(new TextEncoder().encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const pay = b64urlEncode(new TextEncoder().encode(JSON.stringify({
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 43200, // 12h
    sub: subject,
  })));
  const signing = `${hdr}.${pay}`;

  // Tenta importar como raw P-256 scalar (32 bytes — formato gerado por web-push CLI)
  const rawBytes = b64urlDecode(privKeyB64);
  let privKey: CryptoKey;

  if (rawBytes.length === 32) {
    // Constrói PKCS#8 DER minimal para P-256 a partir do scalar raw
    // (sec1 ECPrivateKey embutido em PKCS#8 PrivateKeyInfo)
    const header = new Uint8Array([
      0x30, 0x41,                         // SEQUENCE (65 bytes)
      0x02, 0x01, 0x00,                   // version = 0
      0x30, 0x13,                         // SEQUENCE (AlgorithmIdentifier)
        0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01, // OID ecPublicKey
        0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07, // OID P-256
      0x04, 0x27,                         // OCTET STRING (39 bytes = ECPrivateKey)
        0x30, 0x25,                       // SEQUENCE
          0x02, 0x01, 0x01,               // version = 1
          0x04, 0x20,                     // OCTET STRING (32 bytes = scalar)
    ]);
    const pkcs8 = new Uint8Array(header.length + 32);
    pkcs8.set(header);
    pkcs8.set(rawBytes, header.length);
    privKey = await crypto.subtle.importKey(
      "pkcs8", pkcs8,
      { name: "ECDSA", namedCurve: "P-256" },
      false, ["sign"],
    );
  } else {
    // Assume PKCS#8 DER direto (base64url de 67+ bytes)
    privKey = await crypto.subtle.importKey(
      "pkcs8", rawBytes,
      { name: "ECDSA", namedCurve: "P-256" },
      false, ["sign"],
    );
  }

  const sig = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    privKey,
    new TextEncoder().encode(signing),
  );
  return `${signing}.${b64urlEncode(sig)}`;
}

// ─── Criptografia RFC 8291 (aes128gcm / RFC 8188) ────────────────────────────

async function encryptPayload(
  plaintext: string,
  clientP256dh:  string, // base64url, uncompressed P-256 public key (65 bytes)
  clientAuth:    string, // base64url, 16-byte auth secret
): Promise<Uint8Array> {
  const ua = b64urlDecode(clientP256dh); // client's ECDH public key (65 bytes)
  const as = b64urlDecode(clientAuth);   // auth secret (16 bytes)

  // 1. Gera par ECDH efêmero no servidor
  const serverKP = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"],
  );
  const serverPubRaw = new Uint8Array(
    await crypto.subtle.exportKey("raw", serverKP.publicKey),
  ); // 65 bytes uncompressed

  // 2. Importa chave pública do cliente
  const clientPubKey = await crypto.subtle.importKey(
    "raw", ua, { name: "ECDH", namedCurve: "P-256" }, false, [],
  );

  // 3. ECDH: extrai 32 bytes de segredo compartilhado
  const sharedBits = await crypto.subtle.deriveBits(
    { name: "ECDH", public: clientPubKey }, serverKP.privateKey, 256,
  );

  // 4. RFC 8291 §3.3 — IKM via HKDF-SHA-256
  //    info = "WebPush: info\0" || ua_public (65) || as_public (65)
  const infoPrefix = new TextEncoder().encode("WebPush: info\0");
  const webpushInfo = new Uint8Array(infoPrefix.length + 65 + 65);
  webpushInfo.set(infoPrefix);
  webpushInfo.set(ua,          infoPrefix.length);
  webpushInfo.set(serverPubRaw, infoPrefix.length + 65);

  const prk = await crypto.subtle.importKey(
    "raw", sharedBits, { name: "HKDF" }, false, ["deriveBits"],
  );
  const ikm = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: as, info: webpushInfo }, prk, 256,
  );

  // 5. RFC 8188 — gera salt aleatório (16 bytes), deriva CEK (16b) e nonce (12b)
  const salt = crypto.getRandomValues(new Uint8Array(16));

  const ikmKey = await crypto.subtle.importKey(
    "raw", ikm, { name: "HKDF" }, false, ["deriveBits"],
  );

  const cekInfo   = new TextEncoder().encode("Content-Encoding: aes128gcm\0");
  const nonceInfo = new TextEncoder().encode("Content-Encoding: nonce\0");

  const cekBits   = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt, info: cekInfo }, ikmKey, 128,
  );
  const nonceBits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt, info: nonceInfo }, ikmKey, 96,
  );

  // 6. AES-128-GCM: plaintext + 1 byte padding delimiter (0x02)
  const msgBytes = new TextEncoder().encode(plaintext);
  const record   = new Uint8Array(msgBytes.length + 1);
  record.set(msgBytes);
  record[msgBytes.length] = 2; // AEAD_AES_128_GCM padding delimiter

  const aesKey = await crypto.subtle.importKey(
    "raw", cekBits, { name: "AES-GCM" }, false, ["encrypt"],
  );
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonceBits, tagLength: 128 }, aesKey, record,
    ),
  );

  // 7. Monta cabeçalho RFC 8188:
  //    salt (16) | rs (4, BE) | idlen (1) | keyid = server_pub (65)
  const rs = 4096;
  const hdr = new Uint8Array(16 + 4 + 1 + 65);
  hdr.set(salt);
  new DataView(hdr.buffer).setUint32(16, rs, false);
  hdr[20] = 65;
  hdr.set(serverPubRaw, 21);

  const result = new Uint8Array(hdr.length + ciphertext.length);
  result.set(hdr);
  result.set(ciphertext, hdr.length);
  return result;
}

// ─── Envio individual ─────────────────────────────────────────────────────────

interface PushSub {
  id:       string;
  endpoint: string;
  p256dh:   string;
  auth_key: string;
}

async function sendOne(
  sub:        PushSub,
  payload:    string,
  vapidPub:   string,
  vapidPriv:  string,
  subject:    string,
): Promise<{ ok: boolean; gone: boolean }> {
  const origin = new URL(sub.endpoint).origin;
  const jwt    = await buildVapidJwt(origin, subject, vapidPriv);

  const encBody = await encryptPayload(payload, sub.p256dh, sub.auth_key);

  const res = await fetch(sub.endpoint, {
    method: "POST",
    headers: {
      "Authorization":    `vapid t=${jwt},k=${vapidPub}`,
      "Content-Encoding": "aes128gcm",
      "Content-Type":     "application/octet-stream",
      "TTL":              "86400",
    },
    body: encBody,
  });

  return { ok: res.ok || res.status === 201, gone: res.status === 410 || res.status === 404 };
}

// ─── Handler ─────────────────────────────────────────────────────────────────

// Resposta padrão para chamadas não autorizadas — idêntica ao 400 para não
// revelar se o endpoint existe ou qual campo está faltando.
const FORBIDDEN = new Response(JSON.stringify({ error: "forbidden" }), {
  status: 403, headers: { ...CORS, "Content-Type": "application/json" },
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  // ── Autenticação interna ──────────────────────────────────────────────────
  // Rejeita chamadas com anon key ou sem x-push-secret válido.
  // INTERNAL_PUSH_SECRET é configurado via: supabase secrets set INTERNAL_PUSH_SECRET=...
  // O valor deve corresponder ao registrado em public._push_config.
  const internalSecret = Deno.env.get("INTERNAL_PUSH_SECRET") ?? "";
  if (!internalSecret) {
    // Secret não configurado → falha fechado (não processa nada)
    return FORBIDDEN;
  }
  const callerSecret = req.headers.get("x-push-secret") ?? "";
  // Comparação em tempo constante para evitar timing attacks
  const secretBytes   = new TextEncoder().encode(internalSecret);
  const callerBytes   = new TextEncoder().encode(callerSecret);
  if (secretBytes.length !== callerBytes.length) return FORBIDDEN;
  let diff = 0;
  for (let i = 0; i < secretBytes.length; i++) diff |= secretBytes[i] ^ callerBytes[i];
  if (diff !== 0) return FORBIDDEN;
  // ─────────────────────────────────────────────────────────────────────────

  try {
    const vapidPub  = Deno.env.get("VAPID_PUBLIC_KEY")  ?? "";
    const vapidPriv = Deno.env.get("VAPID_PRIVATE_KEY") ?? "";
    const subject   = Deno.env.get("VAPID_SUBJECT")     ?? "";

    if (!vapidPub || !vapidPriv || !subject) {
      return new Response(
        JSON.stringify({ error: "VAPID secrets não configurados" }),
        { status: 500, headers: { ...CORS, "Content-Type": "application/json" } },
      );
    }

    const body = await req.json();
    const { user_ids, paroquia_id, title, body: msgBody, url } = body as {
      user_ids?:    string[];
      paroquia_id?: string;
      title:        string;
      body:         string;
      url?:         string;
    };

    if (!title) {
      return new Response(JSON.stringify({ error: "title obrigatório" }), {
        status: 400, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }
    if (!user_ids?.length && !paroquia_id) {
      return new Response(JSON.stringify({ error: "user_ids ou paroquia_id obrigatório" }), {
        status: 400, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    let query = supabase.from("push_subscriptions")
      .select("id, endpoint, p256dh, auth_key");
    if (user_ids?.length) query = query.in("user_id", user_ids);
    else                  query = query.eq("paroquia_id", paroquia_id);

    const { data: subs, error } = await query;
    if (error) throw error;
    if (!subs?.length) {
      return new Response(
        JSON.stringify({ sent: 0, failed: 0, removed: 0 }),
        { headers: { ...CORS, "Content-Type": "application/json" } },
      );
    }

    const payload = JSON.stringify({ title, body: msgBody ?? "", url: url ?? "/" });
    let sent = 0, failed = 0, removed = 0;
    const toRemove: string[] = [];

    await Promise.all(
      (subs as PushSub[]).map(async (sub) => {
        try {
          const { ok, gone } = await sendOne(sub, payload, vapidPub, vapidPriv, subject);
          if (gone)     { toRemove.push(sub.id); removed++; }
          else if (ok)  { sent++; }
          else          { failed++; }
        } catch {
          failed++;
        }
      }),
    );

    if (toRemove.length) {
      await supabase.from("push_subscriptions").delete().in("id", toRemove);
    }

    return new Response(JSON.stringify({ sent, failed, removed }), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
