// Basketly parse proxy — Cloudflare Worker.
// Holds your ANTHROPIC_API_KEY server-side so it never ships in the PWA.
// Deploy: paste into a Worker in the Cloudflare dashboard, add ANTHROPIC_API_KEY as an encrypted variable.
//
// POST body: { items:[...], stores:[{id,name,color}], categories:[...] }
//   categories = the household's own category list (head-managed). Falls back to a default set.
// Returns:   [{ "name":"cilantro", "stores":["heb","walmart"], "category":"Produce" }, ...]

const MODEL = "claude-haiku-4-5-20251001";
const CATS_DEFAULT = ["Produce","Bakery","Dairy","Meat","Frozen","Spices","Staples","Household"];

// Lock this to your fork's GitHub Pages origin in production, e.g. "https://you.github.io"
const ALLOW_ORIGIN = "https://anandshubh.github.io";

const CORS = {
  "Access-Control-Allow-Origin": ALLOW_ORIGIN,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS } });

export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
    if (req.method !== "POST") return json({ error: "POST only" }, 405);

    let items = [], stores = [], categories = [];
    try { ({ items = [], stores = [], categories = [] } = await req.json()); }
    catch { return json({ error: "bad json" }, 400); }
    if (!items.length) return json([]);

    // Use the household's own categories; fall back to defaults. Drop empties + "Unsorted".
    const cats = (Array.isArray(categories) && categories.length ? categories : CATS_DEFAULT)
      .map(c => String(c || "").trim())
      .filter(c => c && c.toLowerCase() !== "unsorted");
    const catList = cats.length ? cats : CATS_DEFAULT;

    const ids = stores.map(s => s.id);
    const names = stores.map(s => `${s.id} (${s.name})`).join(", ");

    const system =
      `You route grocery items to stores for a household. Stores: ${names}. ` +
      `Categories (pick exactly one from this list): ${catList.join(", ")}. ` +
      `If none fits well, use the closest one. ` +
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
          model: MODEL,
          max_tokens: 1024,
          system,
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

    // sanitize to known store ids + this household's valid categories
    const catSet = new Set(catList);
    const out = (Array.isArray(arr) ? arr : []).map(r => ({
      name: String(r.name || "").trim(),
      stores: (r.stores || []).filter(s => ids.includes(s)),
      category: catSet.has(r.category) ? r.category : "Unsorted",
    })).filter(r => r.name);

    return json(out);
  },
};
