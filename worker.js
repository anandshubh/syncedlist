// SyncedList parse proxy — Cloudflare Worker.
// Holds ANTHROPIC_API_KEY server-side, and now REQUIRES a valid Firebase ID token
// so it is no longer an open proxy. The app sends: Authorization: Bearer <idToken>.
//
// Dashboard setup:
//   Settings → Variables:
//     ANTHROPIC_API_KEY   (encrypted secret)
//     FIREBASE_PROJECT_ID (plain var — your new project's id, e.g. "synclist-1234")
//
// POST body: { items:[...], stores:[{id,name,color}], categories:[...] }
// Returns:   [{ "name":"cilantro", "stores":["heb","walmart"], "category":"Produce" }, ...]

const MODEL = "claude-haiku-4-5-20251001";
const CATS_DEFAULT = ["Produce","Bakery","Dairy","Meat","Frozen","Spices","Staples","Household"];
const JWK_URL = "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";

// Lock to your Pages origin if you like; the token is the real gate now.
const ALLOW_ORIGIN = "*";
const CORS = {
  "Access-Control-Allow-Origin": ALLOW_ORIGIN,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS } });

// ---- Firebase ID token verification (RS256, Google securetoken keys) ----
function b64url(s){
  s = s.replace(/-/g,"+").replace(/_/g,"/");
  const pad = s.length % 4; if (pad) s += "=".repeat(4 - pad);
  const bin = atob(s); const u = new Uint8Array(bin.length);
  for (let i=0;i<bin.length;i++) u[i] = bin.charCodeAt(i);
  return u;
}
const seg = s => JSON.parse(new TextDecoder().decode(b64url(s)));

let KEYS = null, KEYS_EXP = 0;
async function jwks(){
  const now = Date.now();
  if (KEYS && now < KEYS_EXP) return KEYS;
  const res = await fetch(JWK_URL);
  const data = await res.json();
  const cc = res.headers.get("cache-control") || "";
  const m = /max-age=(\d+)/.exec(cc);
  KEYS = {}; for (const k of (data.keys || [])) KEYS[k.kid] = k;
  KEYS_EXP = now + (m ? parseInt(m[1],10)*1000 : 3600000);
  return KEYS;
}
async function verifyToken(token, projectId){
  const p = token.split("."); if (p.length !== 3) throw new Error("format");
  const head = seg(p[0]);
  if (head.alg !== "RS256") throw new Error("alg");
  const jwk = (await jwks())[head.kid]; if (!jwk) throw new Error("kid");
  const key = await crypto.subtle.importKey(
    "jwk", { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key,
    b64url(p[2]), new TextEncoder().encode(p[0] + "." + p[1]));
  if (!ok) throw new Error("signature");
  const c = seg(p[1]); const now = Math.floor(Date.now()/1000);
  if (c.exp <= now) throw new Error("expired");
  if (c.iat > now + 300) throw new Error("iat");
  if (c.aud !== projectId) throw new Error("aud");
  if (c.iss !== "https://securetoken.google.com/" + projectId) throw new Error("iss");
  if (!c.sub) throw new Error("sub");
  return c;
}

export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
    if (req.method !== "POST") return json({ error: "POST only" }, 405);

    if (!env.FIREBASE_PROJECT_ID) return json({ error: "server not configured" }, 500);
    const authz = req.headers.get("Authorization") || "";
    const m = /^Bearer (.+)$/.exec(authz);
    if (!m) return json({ error: "unauthorized" }, 401);
    try { await verifyToken(m[1], env.FIREBASE_PROJECT_ID); }
    catch (e) { return json({ error: "unauthorized" }, 401); }

    let items = [], stores = [], categories = [];
    try { ({ items = [], stores = [], categories = [] } = await req.json()); }
    catch { return json({ error: "bad json" }, 400); }
    if (!items.length) return json([]);

    const cats = (Array.isArray(categories) && categories.length ? categories : CATS_DEFAULT)
      .map(c => String(c || "").trim()).filter(c => c && c.toLowerCase() !== "unsorted");
    const catList = cats.length ? cats : CATS_DEFAULT;

    const ids = stores.map(s => s.id);
    const names = stores.map(s => `${s.id} (${s.name})`).join(", ");

    const system =
      `You route grocery items to stores for a household. Stores: ${names}. ` +
      `Categories (pick exactly one from this list): ${catList.join(", ")}. If none fits well, use the closest one. ` +
      `For each item, list which store ids typically carry it. ` +
      `South-Asian / specialty items belong to the specialty store; add a mainstream store only if it genuinely stocks the item. ` +
      `Everyday items belong to the mainstream stores. ` +
      `Respond with ONLY a JSON array, no prose, no markdown fences: ` +
      `[{"name":"<item>","stores":[<ids>],"category":"<category>"}]`;

    let resp;
    try {
      resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: MODEL, max_tokens: 1024, system,
          messages: [{ role: "user", content: "Items:\n" + items.join("\n") }],
        }),
      });
    } catch (e) { return json({ error: "upstream" }, 502); }

    if (!resp.ok) return json({ error: "claude " + resp.status }, 502);
    const data = await resp.json();
    const text = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("\n");
    const clean = text.replace(/```json/gi, "").replace(/```/g, "").trim();

    let arr;
    try { arr = JSON.parse(clean); } catch { return json({ error: "parse", raw: clean }, 502); }

    const catSet = new Set(catList);
    const out = (Array.isArray(arr) ? arr : []).map(r => ({
      name: String(r.name || "").trim(),
      stores: (r.stores || []).filter(s => ids.includes(s)),
      category: catSet.has(r.category) ? r.category : "Unsorted",
    })).filter(r => r.name);

    return json(out);
  },
};
