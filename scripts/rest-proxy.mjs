/**
 * A Supabase-shaped front door for a plain PostgREST.
 *
 * supabase-js talks to `{url}/rest/v1/...`; PostgREST serves from `/`. This
 * strips the prefix and forwards, which is enough to exercise every route
 * handler in the app against a real database and real RLS.
 *
 * What it does NOT provide is Realtime — that is a separate Elixir service.
 * Subscriptions are still only testable against Supabase proper.
 */
import { createServer } from "node:http";

const PORT = Number(process.env.PROXY_PORT ?? 54321);
const UPSTREAM = process.env.POSTGREST_URL ?? "http://127.0.0.1:3001";

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");

  if (!url.pathname.startsWith("/rest/v1")) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ message: "Only /rest/v1 is proxied locally." }));
    return;
  }

  const target = UPSTREAM + url.pathname.replace(/^\/rest\/v1/, "") + url.search;
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (typeof value !== "string") continue;
    // Hop-by-hop and length headers must not be forwarded verbatim.
    if (["host", "connection", "content-length"].includes(name)) continue;
    headers.set(name, value);
  }

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined;

  try {
    const upstream = await fetch(target, { method: req.method, headers, body });
    const text = await upstream.text();
    const out = {};
    upstream.headers.forEach((v, k) => {
      if (!["content-encoding", "transfer-encoding", "connection"].includes(k)) out[k] = v;
    });
    res.writeHead(upstream.status, out);
    res.end(text);
  } catch (error) {
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ message: String(error) }));
  }
}).listen(PORT, () => {
  console.log(`rest proxy  http://127.0.0.1:${PORT}/rest/v1  ->  ${UPSTREAM}`);
});
