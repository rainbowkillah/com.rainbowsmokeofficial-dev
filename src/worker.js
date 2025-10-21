const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store"
};

const SESSION_COOKIE_NAME = "rainbow_session";

const NSFW_MEDIA_PREFIX = "nsfw/";
const GALLERY_MEDIA_PREFIX = "gallery/";

async function hashWithSalt(value, salt = "") {
  const encoder = new TextEncoder();
  const data = encoder.encode(`${value}:${salt}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function json(data, init = {}) {
  const status = init.status || 200;
  const headers = new Headers(JSON_HEADERS);
  if (init.headers) {
    for (const [key, value] of Object.entries(init.headers)) {
      headers.set(key, value);
    }
  }
  return new Response(JSON.stringify(data), { status, headers });
}

function badRequest(message) {
  return json({ error: message }, { status: 400 });
}

function unauthorized(message = "Unauthorized") {
  return json({ error: message }, { status: 401 });
}

function forbidden(message = "Forbidden") {
  return json({ error: message }, { status: 403 });
}

function notFound(message = "Not found") {
  return json({ error: message }, { status: 404 });
}

function parseCookies(value = "") {
  return value.split(/;\s*/).reduce((all, part) => {
    const [name, ...rest] = part.split("=");
    if (!name) return all;
    all[name] = decodeURIComponent(rest.join("="));
    return all;
  }, {});
}

function buildCookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (options.maxAge) parts.push(`Max-Age=${options.maxAge}`);
  if (options.expires) parts.push(`Expires=${options.expires.toUTCString()}`);
  if (options.path) parts.push(`Path=${options.path}`);
  if (options.domain) parts.push(`Domain=${options.domain}`);
  if (options.httpOnly) parts.push("HttpOnly");
  if (options.secure) parts.push("Secure");
  if (options.sameSite) parts.push(`SameSite=${options.sameSite}`);
  return parts.join("; ");
}

async function requireSession(request, env) {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return null;
  const cookies = parseCookies(cookieHeader);
  const sessionId = cookies[SESSION_COOKIE_NAME];
  if (!sessionId) return null;
  const session = await env.SESSION_KV.get(`session:${sessionId}`, "json");
  if (!session) return null;
  return { sessionId, ...session };
}

async function createSession(env, contactId) {
  const sessionId = crypto.randomUUID();
  const ttlSeconds = 60 * 60 * 3; // 3 hours
  await env.SESSION_KV.put(
    `session:${sessionId}`,
    JSON.stringify({ contactId }),
    { expirationTtl: ttlSeconds }
  );
  return { sessionId, ttlSeconds };
}

async function destroySession(env, sessionId) {
  await env.SESSION_KV.delete(`session:${sessionId}`);
}

async function incrementVisitCounter(env, pageKey) {
  const id = env.VisitCounter.idFromName(pageKey);
  const stub = env.VisitCounter.get(id);
  const response = await stub.fetch("https://counter.internal/increment", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pageKey })
  });
  if (!response.ok) {
    throw new Error(`Failed to increment counter for ${pageKey}`);
  }
  const data = await response.json();
  return data.count;
}

async function getGalleryMedia(env) {
  const listing = await env.MEDIA_BUCKET.list({
    prefix: GALLERY_MEDIA_PREFIX,
    include: ["httpMetadata", "customMetadata"],
    limit: 100
  });
  const items = [];
  for (const obj of listing.objects) {
    const url = await generateSignedUrl(env.MEDIA_BUCKET, {
      key: obj.key,
      method: "GET",
      expiration: 600
    });
    items.push({
      key: obj.key,
      name: obj.key.replace(GALLERY_MEDIA_PREFIX, ""),
      size: obj.size,
      uploaded: obj.uploaded,
      contentType: obj.httpMetadata?.contentType || "application/octet-stream",
      url
    });
  }
  return items;
}

async function listNsfwMedia(env) {
  const listing = await env.MEDIA_BUCKET.list({
    prefix: NSFW_MEDIA_PREFIX,
    include: ["httpMetadata", "customMetadata"],
    limit: 50
  });
  return listing.objects.map((obj) => ({
    key: obj.key,
    name: obj.key.replace(NSFW_MEDIA_PREFIX, ""),
    size: obj.size,
    contentType: obj.httpMetadata?.contentType || "application/octet-stream"
  }));
}

async function streamNsfwMedia(env, key) {
  const object = await env.MEDIA_BUCKET.get(key);
  if (!object) {
    return notFound("Media not found");
  }
  const headers = new Headers();
  headers.set("content-type", object.httpMetadata?.contentType || "application/octet-stream");
  headers.set("cache-control", "private, max-age=120");
  return new Response(object.body, { status: 200, headers });
}

async function handleAiChat(request, env) {
  const body = await request.json().catch(() => null);
  if (!body || !body.prompt) {
    return badRequest("prompt is required");
  }

  const messages = body.messages || [{ role: "user", content: body.prompt }];

  const gatewayUrl = env.AI_GATEWAY_BASE_URL;
  if (!gatewayUrl || !env.AI_MODEL) {
    return new Response(
      JSON.stringify({
        error: "AI gateway is not configured. Set AI_GATEWAY_BASE_URL and AI_MODEL env vars."
      }),
      { status: 500, headers: JSON_HEADERS }
    );
  }

  const headers = new Headers({ "content-type": "application/json" });
  if (env.AI_GATEWAY_TOKEN) {
    headers.set("authorization", `Bearer ${env.AI_GATEWAY_TOKEN}`);
  }

  const response = await fetch(`${gatewayUrl}/worker-ai/run/${encodeURIComponent(env.AI_MODEL)}`, {
    method: "POST",
    headers,
    body: JSON.stringify({ messages })
  });

  if (!response.ok) {
    const text = await response.text();
    return new Response(text || JSON.stringify({ error: "Failed to reach AI service" }), {
      status: response.status,
      headers: JSON_HEADERS
    });
  }

  const aiResult = await response.json();
  const reply =
    aiResult?.result?.response ??
    aiResult?.result?.output_text ??
    aiResult?.result?.message ??
    aiResult?.response ??
    aiResult?.output_text ??
    aiResult;
  return json({ reply });
}

async function handleContactSubmission(request, env) {
  const body = await request.json().catch(() => null);
  if (!body) {
    return badRequest("Request body must be valid JSON");
  }

  const {
    firstName,
    lastName,
    email,
    mobile,
    discord,
    interests = [],
    message = ""
  } = body;

  if (!firstName || !lastName || !email) {
    return badRequest("firstName, lastName, and email are required");
  }

  const normalizedInterests = Array.isArray(interests) ? interests : [];
  const accessCode = crypto.randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase();
  const accessCodeHash = await hashWithSalt(accessCode, env.ACCESS_CODE_SALT || "");

  const stmt = env.RAINBOW_DB.prepare(`
    INSERT INTO contacts (id, first_name, last_name, email, mobile, discord, interests, message, nsfw_access, access_code_hash, access_code_last_four)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  await stmt
    .bind(
      crypto.randomUUID(),
      firstName.trim(),
      lastName.trim(),
      email.trim().toLowerCase(),
      mobile ? mobile.trim() : null,
      discord ? discord.trim() : null,
      JSON.stringify(normalizedInterests),
      message.trim(),
      1,
      accessCodeHash,
      accessCode.slice(-4)
    )
    .run();

  return json({
    message: "Thanks for reaching out! Keep the access code safe for the MembersOnly NSFW area.",
    accessCode
  });
}

async function handleAuthLogin(request, env) {
  const body = await request.json().catch(() => null);
  if (!body) {
    return badRequest("Invalid JSON body");
  }

  const { email, accessCode } = body;
  if (!email || !accessCode) {
    return badRequest("email and accessCode are required");
  }

  const result = await env.RAINBOW_DB.prepare(
    `SELECT id, nsfw_access, access_code_hash FROM contacts WHERE email = ? ORDER BY created_at DESC LIMIT 1`
  )
    .bind(email.trim().toLowerCase())
    .first();

  if (!result) {
    return unauthorized("No contact submission found for that email yet.");
  }

  if (!result.nsfw_access) {
    return forbidden("This account does not yet have NSFW access. Please wait for approval.");
  }

  const incomingHash = await hashWithSalt(accessCode.trim(), env.ACCESS_CODE_SALT || "");
  if (incomingHash !== result.access_code_hash) {
    return forbidden("Invalid access code.");
  }

  const { sessionId, ttlSeconds } = await createSession(env, result.id);
  const cookie = buildCookie(SESSION_COOKIE_NAME, sessionId, {
    path: "/",
    httpOnly: true,
    secure: true,
    sameSite: "Strict",
    maxAge: ttlSeconds
  });

  return json(
    { message: "Authenticated", expiresIn: ttlSeconds },
    { headers: { "set-cookie": cookie } }
  );
}

async function handleAuthLogout(request, env) {
  const session = await requireSession(request, env);
  if (!session) {
    return json({ message: "Already logged out" });
  }
  await destroySession(env, session.sessionId);
  const cookie = buildCookie(SESSION_COOKIE_NAME, "", {
    path: "/",
    httpOnly: true,
    secure: true,
    sameSite: "Strict",
    expires: new Date(0)
  });
  return json({ message: "Logged out" }, { headers: { "set-cookie": cookie } });
}

function pageKeyFromPath(pathname) {
  switch (pathname) {
    case "/":
    case "/index.html":
      return "home";
    case "/about":
    case "/about.html":
      return "about";
    case "/contact":
    case "/contact.html":
      return "contact";
    case "/gallery":
    case "/gallery.html":
      return "gallery";
    case "/privacy":
    case "/tospolicy":
    case "/privacy.html":
    case "/tospolicy.html":
      return "privacy";
    case "/nsfw":
    case "/nsfw.html":
    case "/nfsw":
    case "/nfsw.html":
      return "nsfw";
    default:
      return null;
  }
}

async function handleNsfwContent(request, env) {
  const session = await requireSession(request, env);
  if (!session) {
    return unauthorized("Sign in to view NSFW content.");
  }
  const media = await listNsfwMedia(env);
  return json({ media });
}

async function handleNsfwStream(request, env, key) {
  const session = await requireSession(request, env);
  if (!session) {
    return unauthorized("Sign in to view NSFW content.");
  }
  if (!key.startsWith(NSFW_MEDIA_PREFIX)) {
    return forbidden("Invalid media key");
  }
  return streamNsfwMedia(env, key);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const { pathname } = url;

    try {
      if (pathname.startsWith("/api/visits/")) {
        if (request.method !== "POST") {
          return badRequest("Use POST to increment visit counters");
        }
        const pageKey = pathname.replace("/api/visits/", "").replace(/\.json$/, "");
        if (!pageKey) {
          return badRequest("Page key missing");
        }
        const count = await incrementVisitCounter(env, pageKey);
        return json({ count });
      }

      if (pathname === "/api/contact" && request.method === "POST") {
        return await handleContactSubmission(request, env);
      }

      if (pathname === "/api/gallery" && request.method === "GET") {
        const items = await getGalleryMedia(env).catch((error) => {
          console.error("Failed to fetch gallery media", error);
          return [];
        });
        return json({ items });
      }

      if (pathname === "/api/ai/chat" && request.method === "POST") {
        return await handleAiChat(request, env);
      }

      if (pathname === "/api/auth/login" && request.method === "POST") {
        return await handleAuthLogin(request, env);
      }

      if (pathname === "/api/auth/logout" && request.method === "POST") {
        return await handleAuthLogout(request, env);
      }

      if (pathname === "/api/nsfw/content" && request.method === "GET") {
        return await handleNsfwContent(request, env);
      }

      if (pathname.startsWith("/media/nsfw/") && request.method === "GET") {
        const encodedKey = pathname.replace("/media/nsfw/", "");
        let key;
        try {
          key = decodeURIComponent(encodedKey);
        } catch (error) {
          return badRequest("Invalid media key");
        }
        return await handleNsfwStream(request, env, key);
      }

      const pageKey = pageKeyFromPath(pathname);
      if (pageKey) {
        ctx.waitUntil(
          incrementVisitCounter(env, pageKey).catch((error) => {
            console.error("visit counter error", { pageKey, error });
          })
        );
      }

      return await env.ASSETS.fetch(request);
    } catch (error) {
      console.error("Worker error", error);
      return new Response(JSON.stringify({ error: "Internal Server Error" }), {
        status: 500,
        headers: JSON_HEADERS
      });
    }
  },

  async scheduled(event, env, ctx) {
    // placeholder for any scheduled cleanup jobs (e.g., clearing stale KV sessions)
  }
};

export class VisitCounter {
  constructor(state, env) {
    this.state = state;
  }

  async fetch(request) {
    const body = await request.json().catch(() => null);
    const pageKey = body?.pageKey;
    if (!pageKey) {
      return new Response(JSON.stringify({ error: "pageKey required" }), {
        status: 400,
        headers: JSON_HEADERS
      });
    }
    const current = (await this.state.storage.get(pageKey)) || 0;
    const next = current + 1;
    await this.state.storage.put(pageKey, next);
    return new Response(JSON.stringify({ count: next }), {
      status: 200,
      headers: JSON_HEADERS
    });
  }
}
