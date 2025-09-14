import { Hono } from "hono";
import { z } from "zod";
import { jwt, sign, verify, decode } from "hono/jwt";
import type {
  KVNamespace,
  DurableObjectNamespace,
  DurableObjectState,
} from "@cloudflare/workers-types";

export interface Env {
  RATE_LIMITER: DurableObjectNamespace;
  USAGE_AGGREGATOR: DurableObjectNamespace;
  RATE_LIMIT_BYPASS_SUBS?: string;
  OPENROUTER_API_KEY: string;
  APP_HTTP_REFERER: string;
  ALLOWED_ORIGINS?: string;
  ALLOWED_HOSTS?: string;
  MIN_ENHANCE_INTERVAL_MS?: string;
  APP_TITLE?: string;
  RATE_LIMIT_PER_DAY?: string;
  MAX_PROMPT_CHARS?: string;
  REQUEST_TIMEOUT_MS?: string;
  DEFAULT_MODEL?: string;
  DEFAULT_MAX_TOKENS?: string;
  DEFAULT_TEMPERATURE?: string;
  SYSTEM_PROMPT?: string | { get: () => Promise<string> };
  JWT_SECRET: string;
  TURNSTILE_SECRET_KEY: string;
  TURNSTILE_SITE_KEY: string;
}

export class RateLimiter {
  state: DurableObjectState;
  limit: number = 100;
  windowMs: number = 24 * 60 * 60 * 1000;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
    this.state.blockConcurrencyWhile(async () => {
      const storedLimit = await this.state.storage.get<number>("limit");
      if (storedLimit) this.limit = storedLimit;
    });
    if (env.RATE_LIMIT_PER_DAY) {
      this.limit = parseInt(env.RATE_LIMIT_PER_DAY, 10);
    }
  }

  async fetch(request: Request): Promise<Response> {
    const now = new Date();
    const y = now.getUTCFullYear();
    const m = now.getUTCMonth();
    const d = now.getUTCDate();
    const todayKey = `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const resetEpoch = Math.floor(Date.UTC(y, m, d + 1, 0, 0, 0) / 1000);

    let bucket = (await this.state.storage.get<{ day: string; count: number }>("day_bucket")) || {
      day: todayKey,
      count: 0,
    };
    if (bucket.day !== todayKey) {
      bucket = { day: todayKey, count: 0 };
    }

    const remaining = Math.max(0, this.limit - bucket.count);
    const reset = resetEpoch;

    const url = new URL(request.url);
    const isPeek = request.method === "GET" || url.searchParams.get("peek") === "1";

    if (isPeek) {
      return new Response(
        JSON.stringify({
          limit: this.limit,
          remaining,
          reset,
          success: true,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    if (bucket.count >= this.limit) {
      return new Response(
        JSON.stringify({
          limit: this.limit,
          remaining: 0,
          reset,
          success: false,
        }),
        {
          status: 429,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    const newCount = bucket.count + 1;
    await this.state.storage.put("day_bucket", { day: todayKey, count: newCount });

    return new Response(
      JSON.stringify({
        limit: this.limit,
        remaining: this.limit - newCount,
        reset,
        success: true,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }
}

export class UsageAggregator {
  state: DurableObjectState;

  constructor(state: DurableObjectState, env: Env) {
    this.state = state;
  }

  async fetch(request: Request): Promise<Response> {
    try {
      const now = new Date();
      const y = now.getUTCFullYear();
      const m = String(now.getUTCMonth() + 1).padStart(2, "0");
      const d = String(now.getUTCDate()).padStart(2, "0");
      const keysFor = (metric: string) => {
        const prefix = metric === "tokens" ? "tokens" : "calls";
        return {
          dayKey: `${prefix}:daily:${y}-${m}-${d}`,
          monthKey: `${prefix}:monthly:${y}-${m}`,
          totalKey: `${prefix}:total`,
        };
      };

      if (request.method === "GET") {
        const kc = keysFor("calls");
        const kt = keysFor("tokens");
        const [cd, cm, ct, td, tm, tt] = await Promise.all([
          this.state.storage.get<number>(kc.dayKey),
          this.state.storage.get<number>(kc.monthKey),
          this.state.storage.get<number>(kc.totalKey),
          this.state.storage.get<number>(kt.dayKey),
          this.state.storage.get<number>(kt.monthKey),
          this.state.storage.get<number>(kt.totalKey),
        ]);
        return new Response(
          JSON.stringify({
            calls: { daily: cd || 0, monthly: cm || 0, total: ct || 0 },
            tokens: { daily: td || 0, monthly: tm || 0, total: tt || 0 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      if (request.method === "POST") {
        let amount = 1;
        let metric = "calls";
        try {
          const body = await request.json();
          if (body && typeof body.amount === "number" && isFinite(body.amount)) {
            amount = Math.max(0, Math.floor(body.amount));
          }
          if (body && typeof body.metric === "string") {
            metric = body.metric === "tokens" ? "tokens" : "calls";
          }
        } catch {}

        const { dayKey, monthKey, totalKey } = keysFor(metric);
        const [daily, monthly, total] = await Promise.all([
          this.state.storage.get<number>(dayKey),
          this.state.storage.get<number>(monthKey),
          this.state.storage.get<number>(totalKey),
        ]);

        const newDaily = (daily || 0) + amount;
        const newMonthly = (monthly || 0) + amount;
        const newTotal = (total || 0) + amount;

        await Promise.all([
          this.state.storage.put(dayKey, newDaily),
          this.state.storage.put(monthKey, newMonthly),
          this.state.storage.put(totalKey, newTotal),
        ]);

        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response("Method Not Allowed", { status: 405 });
    } catch (e) {
      return new Response("Internal Error", { status: 500 });
    }
  }
}

type HonoContext = {
  Variables: {
    usageCount: number;
    rateLimit: {
      limit: number;
      remaining: number;
      reset: number;
    };
    corsOrigin: string;
    jwtPayload: {
      sub: string;
      iat: number;
      exp: number;
    };
  };
};

const app = new Hono<HonoContext & { Bindings: Env }>();

const MAX_BODY_BYTES = 48 * 1024;

function resolveAllowedOrigin(
  originHeader: string | null | undefined,
  env: Env
): string | null {
  const requestedOrigin = originHeader?.trim();
  if (!requestedOrigin) {
    return null;
  }

  const allowed = (env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (requestedOrigin === "null") {
    if (allowed.includes("null") || allowed.includes("chrome-extension://")) {
      return "null";
    }
  }

  if (allowed.includes(requestedOrigin)) {
    return requestedOrigin;
  }

  if (
    requestedOrigin.startsWith("chrome-extension://") &&
    allowed.includes("chrome-extension://")
  ) {
    return requestedOrigin;
  }

  return null;
}

function buildBaseHeaders(
  origin: string,
  extra: Record<string, string> = {}
): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "OPTIONS, GET, POST",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    "Access-Control-Expose-Headers":
      "X-Usage-Count, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset",
    "Cache-Control": "no-store",
    Vary: "Origin",
    ...extra,
  };
}

function jsonError(
  c: any,
  status: number,
  code: string,
  message: string,
  origin: string,
  details?: unknown
) {
  const payload: Record<string, unknown> = { code, message };
  if (details !== undefined) payload.details = details;
  return c.json(payload, status, buildBaseHeaders(origin));
}

async function resolveSystemPrompt(env: Env): Promise<string> {
  const binding: any = (env as any).SYSTEM_PROMPT;
  if (!binding) {
    throw new Error("SYSTEM_PROMPT is not configured in the environment");
  }
  if (typeof binding === "string") {
    const trimmed = binding.trim();
    if (!trimmed) throw new Error("SYSTEM_PROMPT is empty");
    return trimmed;
  }
  if (typeof binding.get === "function") {
    const value = await binding.get();
    if (typeof value === "string" && value.trim()) return value.trim();
    throw new Error("SYSTEM_PROMPT store returned empty value");
  }
  throw new Error("SYSTEM_PROMPT binding type is not supported");
}

function injectSystemPrompt(
  systemPrompt: string,
  messages: Array<{ role: string; content: string }>
): Array<{ role: string; content: string }> {
  const withoutSystem = messages.filter((m) => m.role !== "system");
  return [{ role: "system", content: systemPrompt }, ...withoutSystem];
}

app.use("*", async (c, next) => {
  const { path } = c.req;
  if (
    path === "/turnstile" ||
    path === "/turnstile-embed" ||
    path === "/api/config" ||
    path === "/api/token"
  ) {
    await next();
    return;
  }

  const incomingOrigin = c.req.header("Origin");
  if (!incomingOrigin) {
    if (path === "/api/enhance" || path === "/api/ratelimit" || path === "/api/usage") {
      c.set("corsOrigin", "*");
      if (c.req.method === "OPTIONS") {
        const headers = buildBaseHeaders("*");
        return new Response(null, { status: 204, headers });
      }
      await next();
      return;
    }
    return jsonError(
      c,
      403,
      "CORS_ORIGIN_FORBIDDEN",
      "Origin not allowed",
      "null"
    );
  }
  const origin = resolveAllowedOrigin(incomingOrigin, c.env);
  if (!origin) {
    return jsonError(
      c,
      403,
      "CORS_ORIGIN_FORBIDDEN",
      "Origin not allowed",
      "null"
    );
  }
  c.set("corsOrigin", origin);

  if (c.req.method === "OPTIONS") {
    const reqAllowedHeaders = c.req.header("Access-Control-Request-Headers");
    const preflightOrigin = c.get("corsOrigin") as string;
    const headers = buildBaseHeaders(preflightOrigin);
    if (reqAllowedHeaders)
      headers["Access-Control-Allow-Headers"] = reqAllowedHeaders;
    return new Response(null, { status: 204, headers });
  }

  await next();
});

app.use("/api/enhance", async (c, next) => {
  const jwtMiddleware = jwt({ secret: c.env.JWT_SECRET });
  return jwtMiddleware(c, next);
});

app.use("/api/enhance", async (c, next) => {
  const userToken = c.get("jwtPayload").sub;
  if (!userToken) {
    const errOrigin = c.get("corsOrigin") as string;
    return jsonError(c, 401, "UNAUTHORIZED", "Invalid token", errOrigin);
  }

  const RATE_LIMIT_PER_DAY = parseInt(c.env.RATE_LIMIT_PER_DAY || "100", 10);
  const ip = c.req.header("CF-Connecting-IP") || "unknown";

  try {
    const id = c.env.RATE_LIMITER.idFromName(`${userToken}:${ip}`);
    const stub = c.env.RATE_LIMITER.get(id);
    const bypass = (c.env.RATE_LIMIT_BYPASS_SUBS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const res = bypass.includes(userToken)
      ? await stub.fetch(c.req.url + "?peek=1", { method: "GET" })
      : await stub.fetch(c.req.url, { method: "POST" });
    const rateLimitResult = await res.json<{
      limit: number;
      remaining: number;
      reset: number;
      success: boolean;
    }>();

    c.set("usageCount", RATE_LIMIT_PER_DAY - rateLimitResult.remaining);
    c.set("rateLimit", {
      limit: rateLimitResult.limit,
      remaining: rateLimitResult.remaining,
      reset: rateLimitResult.reset,
    });

    if (!rateLimitResult.success) {
      const errOrigin = (c.get("corsOrigin") as string) || "*";
      const headers = buildBaseHeaders(errOrigin, {
        "X-Usage-Count": String(RATE_LIMIT_PER_DAY - rateLimitResult.remaining),
        "X-RateLimit-Limit": String(rateLimitResult.limit),
        "X-RateLimit-Remaining": String(rateLimitResult.remaining),
        "X-RateLimit-Reset": String(rateLimitResult.reset),
      });
      return c.json(
        { code: "RATE_LIMIT_EXCEEDED", message: "Rate limit exceeded" },
        429,
        headers
      );
    }
  } catch (e) {
    console.error("Durable Object error:", e);
    const errOrigin = (c.get("corsOrigin") as string) || "*";
    return jsonError(
      c,
      500,
      "INTERNAL_ERROR",
      "Rate limiter failed",
      errOrigin
    );
  }

  await next();
});

app.use("/api/ratelimit", async (c, next) => {
  const jwtMiddleware = jwt({ secret: c.env.JWT_SECRET });
  return jwtMiddleware(c, next);
});

app.get("/api/ratelimit", async (c) => {
  const origin = (c.get("corsOrigin") as string) || "*";
  const userToken = (c.get("jwtPayload") as any)?.sub;
  if (!userToken) return jsonError(c, 401, "UNAUTHORIZED", "Invalid token", origin);
  const ip = c.req.header("CF-Connecting-IP") || "unknown";
  try {
    const id = c.env.RATE_LIMITER.idFromName(`${userToken}:${ip}`);
    const stub = c.env.RATE_LIMITER.get(id);
    const res = await stub.fetch(`${c.req.url}?peek=1`, { method: "GET" });
    const data = await res.json<any>();
    return c.json(
      {
        limit: Number(data?.limit) || parseInt(c.env.RATE_LIMIT_PER_DAY || "100", 10),
        remaining: Math.max(0, Number(data?.remaining) || 0),
        reset: Number(data?.reset) || 0,
      },
      200,
      buildBaseHeaders(origin)
    );
  } catch (e) {
    return jsonError(c, 500, "INTERNAL_ERROR", "Failed to read ratelimit", origin);
  }
});

app.get("/api/config", (c) => {
  const incomingOrigin = c.req.header("Origin");
  const validated =
    resolveAllowedOrigin(incomingOrigin, c.env) || incomingOrigin || "null";
  return c.json(
    {
      turnstileSiteKey: c.env.TURNSTILE_SITE_KEY,
      rateLimitPerDay: parseInt(c.env.RATE_LIMIT_PER_DAY || "100", 10),
      maxPromptChars: parseInt(c.env.MAX_PROMPT_CHARS || "4000", 10),
      defaultModel: c.env.DEFAULT_MODEL || "google/gemini-2.0-flash-exp:free",
      allowedHosts: (c.env.ALLOWED_HOSTS || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
      minEnhanceIntervalMs: parseInt(
        c.env.MIN_ENHANCE_INTERVAL_MS || "3000",
        10
      ),
    },
    200,
    buildBaseHeaders(validated)
  );
});

app.use("/api/usage", async (c, next) => {
  const jwtMiddleware = jwt({ secret: c.env.JWT_SECRET });
  return jwtMiddleware(c, next);
});

app.get("/api/usage", async (c) => {
  const origin = c.get("corsOrigin") as string;
  const userId = (c.get("jwtPayload") as any)?.sub;
  if (!userId) return jsonError(c, 401, "UNAUTHORIZED", "Invalid token", origin);
  try {
    const aggId = c.env.USAGE_AGGREGATOR.idFromName(String(userId));
    const agg = c.env.USAGE_AGGREGATOR.get(aggId);
    const res = await agg.fetch("https://usage/stats", { method: "GET" });
    const raw: any = await res.json().catch(() => ({}));
    const payload = {
      calls: {
        daily: Number(raw?.calls?.daily) || 0,
        monthly: Number(raw?.calls?.monthly) || 0,
        total: Number(raw?.calls?.total) || 0,
      },
      tokens: {
        daily: Number(raw?.tokens?.daily) || 0,
        monthly: Number(raw?.tokens?.monthly) || 0,
        total: Number(raw?.tokens?.total) || 0,
      },
    };
    return c.json(payload, 200, buildBaseHeaders(origin));
  } catch (e) {
    return jsonError(c, 500, "INTERNAL_ERROR", "Failed to fetch usage", origin);
  }
});

app.get("/turnstile", async (c) => {
  const url = new URL(c.req.url);
  const redirect = url.searchParams.get("redirect_uri") || "";
  const isValid = /^https:\/\/[a-zA-Z0-9]+\.chromiumapp\.org\//.test(redirect);
  if (!isValid) {
    return new Response("Invalid redirect", { status: 400 });
  }
  const siteKey = c.env.TURNSTILE_SITE_KEY;
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Verify</title><style>html,body{height:100%;display:grid;place-items:center;background:#0b0b0c;color:#fff;margin:0}</style></head><body><div id="cf-turnstile"></div><script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script><script>window.addEventListener('load',function(){if(window.turnstile){turnstile.render('#cf-turnstile',{sitekey:'${siteKey}',callback:function(t){location.href='${redirect}#token='+encodeURIComponent(t);}});} else {document.body.innerHTML='<div style="color:#fff;font:14px sans-serif">Load error. Please refresh.</div>';}});</script></body></html>`;
  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
});

app.get("/turnstile-embed", async (c) => {
  const siteKey = c.env.TURNSTILE_SITE_KEY;
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Verify</title><style>html,body{height:100%;display:grid;place-items:center;background:#0b0b0c;color:#fff;margin:0;font:14px system-ui}</style></head><body><div id="cf-turnstile"></div><script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script><script>window.addEventListener('load',function(){function r(){if(!window.turnstile){setTimeout(r,50);return;}turnstile.render('#cf-turnstile',{sitekey:'${siteKey}',theme:'dark',size:'normal',callback:function(t){parent.postMessage({type:'turnstile:token',token:t},'*');},'error-callback':function(){parent.postMessage({type:'turnstile:error'},'*');},'timeout-callback':function(){parent.postMessage({type:'turnstile:timeout'},'*');}});}r();});</script></body></html>`;
  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
});

app.post("/api/token", async (c) => {
  const incomingOrigin = c.req.header("Origin");
  const origin =
    resolveAllowedOrigin(incomingOrigin, c.env) || incomingOrigin || "*";
  try {
    const body = await c.req.json();
    const turnstileToken = body.turnstileToken;

    if (!turnstileToken) {
      return jsonError(
        c,
        400,
        "BAD_REQUEST",
        "Turnstile token required",
        origin
      );
    }

    const secret = (c.env.TURNSTILE_SECRET_KEY || "").trim();
    if (!secret) {
      console.error("Missing or empty TURNSTILE_SECRET_KEY in worker environment");
      return jsonError(
        c,
        500,
        "SERVER_MISCONFIGURED",
        "Turnstile secret key not configured on the server.",
        origin
      );
    }

    const ip = c.req.header("CF-Connecting-IP") || "";
    const params = new URLSearchParams();
    params.set("secret", secret);
    params.set("response", turnstileToken);
    if (ip) params.set("remoteip", ip);

    const response = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
      }
    );

    const result: any = await response.json();
    if (!result?.success) {
      return c.json(
        { code: "UNAUTHORIZED", message: "Turnstile verification failed", details: result?.["error-codes"] },
        401,
        buildBaseHeaders(origin)
      );
    }

    const jwtSecret = (c.env.JWT_SECRET || "").trim();
    if (!jwtSecret) {
      console.error("Missing or empty JWT_SECRET in worker environment");
      return jsonError(
        c,
        500,
        "SERVER_MISCONFIGURED",
        "JWT secret not configured on the server.",
        origin
      );
    }

    const userId = crypto.randomUUID();
    const payload = {
      sub: userId,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60, // 7 days
    };
    const token = await sign(payload, jwtSecret);
    return c.json({ token }, 200, buildBaseHeaders(origin));
  } catch (e: any) {
    const origin = c.get("corsOrigin") || "*";
    console.error("/api/token error:", e?.message || e);
    return c.json(
      { code: "INTERNAL_ERROR", message: "Failed to issue token", details: e?.message || String(e) },
      500,
      buildBaseHeaders(origin)
    );
  }
});

app.post("/api/enhance", async (c) => {
  const origin = c.get("corsOrigin");
  try {
    const contentLengthHeader = c.req.header("Content-Length");
    if (contentLengthHeader && Number(contentLengthHeader) > MAX_BODY_BYTES) {
      return jsonError(
        c,
        413,
        "PAYLOAD_TOO_LARGE",
        "Request body too large",
        origin
      );
    }

    const MAX_PROMPT_CHARS = parseInt(c.env.MAX_PROMPT_CHARS || "4000", 10);
    const DEFAULT_MODEL =
      c.env.DEFAULT_MODEL || "google/gemini-2.0-flash-exp:free";
    const DEFAULT_MAX_TOKENS = parseInt(c.env.DEFAULT_MAX_TOKENS || "500", 10);
    const DEFAULT_TEMPERATURE = parseFloat(c.env.DEFAULT_TEMPERATURE || "0.7");

    const apiRequestSchema = z.object({
      model: z.string().optional().default(DEFAULT_MODEL),
      messages: z
        .array(
          z.object({
            role: z.string(),
            content: z.string().min(1).max(MAX_PROMPT_CHARS),
          })
        )
        .min(1),
      max_tokens: z
        .number()
        .int()
        .positive()
        .max(4096)
        .optional()
        .default(DEFAULT_MAX_TOKENS),
      temperature: z
        .number()
        .min(0)
        .max(2)
        .optional()
        .default(DEFAULT_TEMPERATURE),
    });

    const rawText = await c.req.text();
    const rawBytes = new TextEncoder().encode(rawText).length;
    if (rawBytes > MAX_BODY_BYTES) {
      return jsonError(
        c,
        413,
        "PAYLOAD_TOO_LARGE",
        "Request body too large",
        origin
      );
    }

    let body: unknown;
    try {
      body = JSON.parse(rawText || "{}");
    } catch {
      return jsonError(c, 400, "INVALID_JSON", "Malformed JSON body", origin);
    }

    const validation = apiRequestSchema.safeParse(body);
    if (!validation.success) {
      return c.json(
        {
          code: "INVALID_BODY",
          message: "Invalid request body",
          details: validation.error.flatten(),
        },
        400,
        buildBaseHeaders(origin)
      );
    }

    const totalPromptChars = validation.data.messages.reduce(
      (sum, m) => sum + m.content.length,
      0
    );
    if (totalPromptChars > MAX_PROMPT_CHARS) {
      return jsonError(
        c,
        413,
        "PROMPT_TOO_LARGE",
        "Prompt length exceeds limit",
        origin
      );
    }

    const openRouterKey = (c.env.OPENROUTER_API_KEY || "").trim();
    if (!openRouterKey) {
      return jsonError(
        c,
        500,
        "SERVER_MISCONFIGURED",
        "Missing OPENROUTER_API_KEY in worker environment",
        origin
      );
    }

    const REQUEST_TIMEOUT_MS = parseInt(
      c.env.REQUEST_TIMEOUT_MS || "15000",
      10
    );
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let response: Response;
    try {
      const systemPrompt = await resolveSystemPrompt(c.env);
      const payload = {
        ...validation.data,
        model: DEFAULT_MODEL,
        messages: injectSystemPrompt(systemPrompt, validation.data.messages),
      };
      response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${openRouterKey}`,
          "HTTP-Referer": c.env.APP_HTTP_REFERER,
          "X-Title": c.env.APP_TITLE || "Enhance Prompt",
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (err: any) {
      if (err?.name === "AbortError") {
        clearTimeout(timeoutId);
        return jsonError(
          c,
          504,
          "UPSTREAM_TIMEOUT",
          "Upstream request timed out",
          origin
        );
      }
      clearTimeout(timeoutId);
      return jsonError(
        c,
        502,
        "UPSTREAM_UNAVAILABLE",
        "Upstream request failed",
        origin
      );
    }
    clearTimeout(timeoutId);

    const usageCount = c.get("usageCount") as number;
    const rate = c.get("rateLimit") as {
      limit: number;
      remaining: number;
      reset: number;
    };

    if (!response.ok) {
      let upstreamPayload: unknown = null;
      const ct = response.headers.get("content-type") || "";
      try {
        if (ct.includes("application/json")) {
          upstreamPayload = await response.json();
        } else {
          const txt = await response.text();
          upstreamPayload = txt.slice(0, 2000);
        }
      } catch {}
      const headers = buildBaseHeaders(origin, {
        "Content-Type": "application/json",
        "X-Usage-Count": String(usageCount),
        "X-RateLimit-Limit": String(rate.limit),
        "X-RateLimit-Remaining": String(rate.remaining),
        "X-RateLimit-Reset": String(rate.reset),
      });
      return new Response(
        JSON.stringify({
          code: "UPSTREAM_ERROR",
          message: "Upstream error",
          status: response.status,
          upstream: upstreamPayload,
        }),
        { status: response.status, headers: new Headers(headers) }
      );
    }

    const headers = new Headers(response.headers);
    headers.set("X-Usage-Count", String(usageCount));
    headers.set("X-RateLimit-Limit", String(rate.limit));
    headers.set("X-RateLimit-Remaining", String(rate.remaining));
    headers.set("X-RateLimit-Reset", String(rate.reset));
    for (const [key, value] of Object.entries(buildBaseHeaders(origin))) {
      headers.set(key, value);
    }

    // Increment per-user usage counters for cost tracking
    try {
      const userId = (c.get("jwtPayload") as any)?.sub;
      if (userId) {
        const aggId = c.env.USAGE_AGGREGATOR.idFromName(String(userId));
        const agg = c.env.USAGE_AGGREGATOR.get(aggId);
        await agg.fetch("https://usage/incr", {
          method: "POST",
          body: JSON.stringify({ amount: 1 }),
        });
      }
    } catch {}

    return new Response(response.body, {
      status: response.status,
      headers,
    });
  } catch (e: any) {
    return c.json(
      {
        code: "INTERNAL_ERROR",
        message: "Internal Server Error",
        details: e?.message || String(e),
      },
      500,
      buildBaseHeaders(origin)
    );
  }
});

// BYOK variant: user provides an OpenRouter API key per request via header.
// System prompt is injected server-side to avoid exposing it in client code.
app.use("/api/enhance/byok", async (c, next) => {
  const jwtMiddleware = jwt({ secret: c.env.JWT_SECRET });
  return jwtMiddleware(c, next);
});

app.use("/api/enhance/byok", async (c, next) => {
  const userToken = (c.get("jwtPayload") as any)?.sub;
  if (!userToken) {
    const errOrigin = c.get("corsOrigin") as string;
    return jsonError(c, 401, "UNAUTHORIZED", "Invalid token", errOrigin);
  }

  const RATE_LIMIT_PER_DAY = parseInt(c.env.RATE_LIMIT_PER_DAY || "100", 10);
  const ip = c.req.header("CF-Connecting-IP") || "unknown";

  try {
    const id = c.env.RATE_LIMITER.idFromName(`${userToken}:${ip}`);
    const stub = c.env.RATE_LIMITER.get(id);
    const bypass = (c.env.RATE_LIMIT_BYPASS_SUBS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const res = bypass.includes(userToken)
      ? await stub.fetch(c.req.url + "?peek=1", { method: "GET" })
      : await stub.fetch(c.req.url, { method: "POST" });
    const rateLimitResult = await res.json<{
      limit: number;
      remaining: number;
      reset: number;
      success: boolean;
    }>();

    c.set("usageCount", RATE_LIMIT_PER_DAY - rateLimitResult.remaining);
    c.set("rateLimit", {
      limit: rateLimitResult.limit,
      remaining: rateLimitResult.remaining,
      reset: rateLimitResult.reset,
    });

    if (!rateLimitResult.success) {
      const errOrigin = (c.get("corsOrigin") as string) || "*";
      const headers = buildBaseHeaders(errOrigin, {
        "X-Usage-Count": String(RATE_LIMIT_PER_DAY - rateLimitResult.remaining),
        "X-RateLimit-Limit": String(rateLimitResult.limit),
        "X-RateLimit-Remaining": String(rateLimitResult.remaining),
        "X-RateLimit-Reset": String(rateLimitResult.reset),
      });
      return c.json(
        { code: "RATE_LIMIT_EXCEEDED", message: "Rate limit exceeded" },
        429,
        headers
      );
    }
  } catch (e) {
    console.error("Durable Object error:", e);
    const errOrigin = (c.get("corsOrigin") as string) || "*";
    return jsonError(
      c,
      500,
      "INTERNAL_ERROR",
      "Rate limiter failed",
      errOrigin
    );
  }

  await next();
});

app.post("/api/enhance/byok", async (c) => {
  const origin = c.get("corsOrigin");
  try {
    const contentLengthHeader = c.req.header("Content-Length");
    if (contentLengthHeader && Number(contentLengthHeader) > MAX_BODY_BYTES) {
      return jsonError(
        c,
        413,
        "PAYLOAD_TOO_LARGE",
        "Request body too large",
        origin
      );
    }

    const MAX_PROMPT_CHARS = parseInt(c.env.MAX_PROMPT_CHARS || "4000", 10);
    const DEFAULT_MODEL =
      c.env.DEFAULT_MODEL || "google/gemini-2.0-flash-exp:free";
    const DEFAULT_MAX_TOKENS = parseInt(c.env.DEFAULT_MAX_TOKENS || "500", 10);
    const DEFAULT_TEMPERATURE = parseFloat(c.env.DEFAULT_TEMPERATURE || "0.7");

    const apiRequestSchema = z.object({
      byokKey: z.string().min(1, "byokKey required"),
      model: z.string().optional().default(DEFAULT_MODEL),
      messages: z
        .array(
          z.object({
            role: z.string(),
            content: z.string().min(1).max(MAX_PROMPT_CHARS),
          })
        )
        .min(1),
      max_tokens: z
        .number()
        .int()
        .positive()
        .max(4096)
        .optional()
        .default(DEFAULT_MAX_TOKENS),
      temperature: z
        .number()
        .min(0)
        .max(2)
        .optional()
        .default(DEFAULT_TEMPERATURE),
    });

    const rawText = await c.req.text();
    const rawBytes = new TextEncoder().encode(rawText).length;
    if (rawBytes > MAX_BODY_BYTES) {
      return jsonError(
        c,
        413,
        "PAYLOAD_TOO_LARGE",
        "Request body too large",
        origin
      );
    }

    let body: unknown;
    try {
      body = JSON.parse(rawText || "{}");
    } catch {
      return jsonError(c, 400, "INVALID_JSON", "Malformed JSON body", origin);
    }

    const validation = apiRequestSchema.safeParse(body);
    if (!validation.success) {
      return c.json(
        {
          code: "INVALID_BODY",
          message: "Invalid request body",
          details: validation.error.flatten(),
        },
        400,
        buildBaseHeaders(origin)
      );
    }

    const totalPromptChars = validation.data.messages.reduce(
      (sum, m) => sum + m.content.length,
      0
    );
    if (totalPromptChars > MAX_PROMPT_CHARS) {
      return jsonError(
        c,
        413,
        "PROMPT_TOO_LARGE",
        "Prompt length exceeds limit",
        origin
      );
    }

    const byokKey = validation.data.byokKey.trim();

    const REQUEST_TIMEOUT_MS = parseInt(
      c.env.REQUEST_TIMEOUT_MS || "15000",
      10
    );
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let response: Response;
    try {
      const systemPrompt = await resolveSystemPrompt(c.env);
      const { byokKey: _omit, ...rest } = validation.data as any;
      const payload = {
        ...rest,
        model: DEFAULT_MODEL,
        messages: injectSystemPrompt(systemPrompt, rest.messages),
      } as any;
      response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${byokKey}`,
          "HTTP-Referer": c.env.APP_HTTP_REFERER,
          "X-Title": c.env.APP_TITLE || "Enhance Prompt",
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (err: any) {
      if (err?.name === "AbortError") {
        clearTimeout(timeoutId);
        return jsonError(
          c,
          504,
          "UPSTREAM_TIMEOUT",
          "Upstream request timed out",
          origin
        );
      }
      clearTimeout(timeoutId);
      return jsonError(
        c,
        502,
        "UPSTREAM_UNAVAILABLE",
        "Upstream request failed",
        origin
      );
    }
    clearTimeout(timeoutId);

    const usageCount = c.get("usageCount") as number;
    const rate = c.get("rateLimit") as {
      limit: number;
      remaining: number;
      reset: number;
    };

    if (!response.ok) {
      let upstreamPayload: unknown = null;
      const ct = response.headers.get("content-type") || "";
      try {
        if (ct.includes("application/json")) {
          upstreamPayload = await response.json();
        } else {
          const txt = await response.text();
          upstreamPayload = txt.slice(0, 2000);
        }
      } catch {}
      const headers = buildBaseHeaders(origin, {
        "Content-Type": "application/json",
        "X-Usage-Count": String(usageCount),
        "X-RateLimit-Limit": String(rate.limit),
        "X-RateLimit-Remaining": String(rate.remaining),
        "X-RateLimit-Reset": String(rate.reset),
      });
      return new Response(
        JSON.stringify({
          code: "UPSTREAM_ERROR",
          message: "Upstream error",
          status: response.status,
          upstream: upstreamPayload,
        }),
        { status: response.status, headers: new Headers(headers) }
      );
    }

    const headers = new Headers(response.headers);
    headers.set("X-Usage-Count", String(usageCount));
    headers.set("X-RateLimit-Limit", String(rate.limit));
    headers.set("X-RateLimit-Remaining", String(rate.remaining));
    headers.set("X-RateLimit-Reset", String(rate.reset));
    for (const [key, value] of Object.entries(buildBaseHeaders(origin))) {
      headers.set(key, value);
    }

    // Increment per-user usage counters for cost tracking
    try {
      const userId = (c.get("jwtPayload") as any)?.sub;
      if (userId) {
        const aggId = c.env.USAGE_AGGREGATOR.idFromName(String(userId));
        const agg = c.env.USAGE_AGGREGATOR.get(aggId);
        await agg.fetch("https://usage/incr", {
          method: "POST",
          body: JSON.stringify({ amount: 1 }),
        });
      }
    } catch {}

    return new Response(response.body, {
      status: response.status,
      headers,
    });
  } catch (e: any) {
    return c.json(
      {
        code: "INTERNAL_ERROR",
        message: "Internal Server Error",
        details: e?.message || String(e),
      },
      500,
      buildBaseHeaders(origin)
    );
  }
});

export default app;
