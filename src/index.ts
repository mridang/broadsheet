// The Hacker Times — Cloudflare Worker. Port of the POC's server.mjs:
// fetch() serves all routes; scheduled() runs the daily feed refresh.
import * as db from "./db";
import * as auth from "./auth";
import { refreshAll, refreshFeed } from "./scrape";
import { renderPaper, renderFeeds, renderLogin } from "./render";
import { cookie, parseCookies, sign, unsign } from "./session";
import type { Env, Feed, User } from "./types";

const DEFAULT_FEEDS: [string, string][] = [
  ["https://hnrss.org/frontpage", "Hacker News"],
  ["https://simonwillison.net/atom/everything/", "Simon Willison"],
  ["https://jvns.ca/atom.xml", "Julia Evans"],
];
// Feeds shown to logged-out visitors — a normal Hacker News paper.
const PUBLIC_FEEDS: [string, string][] = [
  ["https://hnrss.org/frontpage", "Hacker News"],
  ["https://hnrss.org/best", "HN — Best of the Week"],
];

const secret = (env: Env): string => env.SESSION_SECRET || "dev-insecure-secret-change-me";
const baseUrl = (env: Env, url: URL): string => env.BASE_URL || `${url.protocol}//${url.host}`;
const isSecure = (env: Env, url: URL): boolean => baseUrl(env, url).startsWith("https");
const devLoginOn = (env: Env): boolean =>
  env.ALLOW_DEV_LOGIN === "1" || !auth.oauthConfigured(env);

// ---- responses ----
const html = (body: string, init: ResponseInit = {}): Response =>
  new Response(body, {
    ...init,
    headers: { "content-type": "text/html; charset=utf-8", ...(init.headers || {}) },
  });
const text = (body: string, status = 200): Response =>
  new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8" } });
const redirect = (to: string, setCookie?: string): Response => {
  const headers = new Headers({ Location: to });
  if (setCookie) headers.append("Set-Cookie", setCookie);
  return new Response(null, { status: 302, headers });
};

async function formBody(request: Request): Promise<Record<string, string>> {
  const ct = request.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    try {
      return (await request.json()) as Record<string, string>;
    } catch {
      return {};
    }
  }
  const out: Record<string, string> = {};
  try {
    for (const [k, v] of await request.formData()) out[k] = String(v);
  } catch {
    /* no body */
  }
  return out;
}

async function currentUser(request: Request, env: Env): Promise<User | null> {
  const c = parseCookies(request).ht_sess;
  if (!c) return null;
  const id = await unsign(secret(env), c);
  return id ? db.getUser(env.DB, Number(id)) : null;
}

const sessionCookie = async (env: Env, url: URL, userId: number): Promise<string> =>
  cookie("ht_sess", await sign(secret(env), String(userId)), {
    maxAge: 30 * 86400,
    secure: isSecure(env, url),
  });

// Seed a new user's default feeds and warm them in the background.
async function seedDefaults(env: Env, ctx: ExecutionContext, userId: number): Promise<void> {
  if ((await db.listFeeds(env.DB, userId)).length) return;
  const feeds: Feed[] = [];
  for (const [u, t] of DEFAULT_FEEDS) {
    const f = await db.addFeed(env.DB, userId, u, t);
    if (f) feeds.push(f);
  }
  ctx.waitUntil(Promise.all(feeds.map((f) => refreshFeed(env, f).catch(() => {}))));
}

// The logged-out edition is backed by a hidden system user (sub='__public__').
async function ensurePublic(env: Env, ctx: ExecutionContext): Promise<number> {
  const u = await db.upsertUser(env.DB, {
    sub: "__public__",
    email: "public",
    name: "Hacker News",
    picture: "",
  });
  if (!(await db.listFeeds(env.DB, u.id)).length) {
    const feeds: Feed[] = [];
    for (const [url, t] of PUBLIC_FEEDS) {
      const f = await db.addFeed(env.DB, u.id, url, t);
      if (f) feeds.push(f);
    }
    ctx.waitUntil(Promise.all(feeds.map((f) => refreshFeed(env, f).catch(() => {}))));
  }
  return u.id;
}

async function handle(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const p = url.pathname;
  const m = request.method;
  const user = await currentUser(request, env);

  // --- pages ---
  if (m === "GET" && p === "/") {
    const ownerId = user ? user.id : await ensurePublic(env, ctx);
    const feeds = await db.listFeeds(env.DB, ownerId);
    const sections = await Promise.all(
      feeds.map(async (feed) => ({ feed, articles: await db.feedArticles(env.DB, feed.id) })),
    );
    return html(renderPaper(user, sections));
  }
  if (m === "GET" && p === "/login")
    return html(renderLogin(user, { configured: auth.oauthConfigured(env) }));
  if (m === "GET" && p === "/feeds") {
    if (!user) return redirect("/login");
    return html(renderFeeds(user, await db.listFeeds(env.DB, user.id)));
  }
  if (m === "GET" && p === "/logout")
    return redirect("/", cookie("ht_sess", "", { maxAge: 0, secure: isSecure(env, url) }));
  if (m === "GET" && p === "/healthz") return text("ok");

  // --- Google OAuth ---
  if (m === "GET" && p === "/auth/google") {
    if (!auth.oauthConfigured(env)) return redirect("/login");
    const state = crypto.randomUUID().replace(/-/g, "");
    const redirectUri = baseUrl(env, url) + "/auth/google/callback";
    return redirect(
      auth.authUrl(env, redirectUri, state),
      cookie("ht_oauth", await sign(secret(env), state), {
        maxAge: 600,
        secure: isSecure(env, url),
      }),
    );
  }
  if (m === "GET" && p === "/auth/google/callback") {
    const want = await unsign(secret(env), parseCookies(request).ht_oauth || "");
    if (!want || url.searchParams.get("state") !== want) return text("bad state", 400);
    const code = url.searchParams.get("code");
    if (!code) return text("missing code", 400);
    const profile = await auth.exchange(env, code, baseUrl(env, url) + "/auth/google/callback");
    const u = await db.upsertUser(env.DB, profile);
    await seedDefaults(env, ctx, u.id);
    const headers = new Headers({ Location: "/feeds" });
    headers.append("Set-Cookie", await sessionCookie(env, url, u.id));
    headers.append("Set-Cookie", cookie("ht_oauth", "", { maxAge: 0, secure: isSecure(env, url) }));
    return new Response(null, { status: 302, headers });
  }
  if (m === "POST" && p === "/auth/dev") {
    if (!devLoginOn(env)) return text("dev login disabled", 403);
    const { email } = await formBody(request);
    if (!email) return redirect("/login");
    const u = await db.upsertUser(env.DB, {
      sub: "dev:" + email,
      email,
      name: email.split("@")[0],
      picture: "",
    });
    await seedDefaults(env, ctx, u.id);
    return redirect("/feeds", await sessionCookie(env, url, u.id));
  }

  // --- feed API (form posts; redirect back) ---
  if (m === "POST" && p === "/api/feeds") {
    if (!user) return redirect("/login");
    const { url: feedUrl } = await formBody(request);
    if (feedUrl) {
      const f = await db.addFeed(env.DB, user.id, feedUrl.trim());
      if (f) ctx.waitUntil(refreshFeed(env, f).catch(() => {}));
    }
    return redirect("/feeds");
  }
  let mm: RegExpMatchArray | null;
  if (m === "POST" && (mm = p.match(/^\/api\/feeds\/(\d+)\/delete$/))) {
    if (!user) return redirect("/login");
    await db.removeFeed(env.DB, user.id, Number(mm[1]));
    return redirect("/feeds");
  }
  if (m === "POST" && p === "/api/refresh") {
    if (!user) return redirect("/login");
    const feeds = await db.listFeeds(env.DB, user.id);
    await Promise.all(feeds.map((f) => refreshFeed(env, f).catch(() => {})));
    return redirect("/feeds");
  }

  return text("Not found", 404);
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      return await handle(request, env, ctx);
    } catch (e) {
      console.error(e);
      return text("Server error", 500);
    }
  },

  // Daily Cron Trigger — refresh every feed (public + all users).
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(refreshAll(env));
  },
};
