import { Hono } from "hono";
import { z } from "zod";
import type { KVNamespace } from "@cloudflare/workers-types";

export interface Env {
  REQUEST_COUNT: KVNamespace;
  OPENROUTER_API_KEY: string;
  APP_HTTP_REFERER: string;
  ALLOWED_ORIGINS?: string;
  APP_TITLE?: string;
  RATE_LIMIT_PER_DAY?: string;
  MAX_PROMPT_CHARS?: string;
  REQUEST_TIMEOUT_MS?: string;
  DEFAULT_MODEL?: string;
  DEFAULT_MAX_TOKENS?: string;
  DEFAULT_TEMPERATURE?: string;
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

  if (allowed.includes(requestedOrigin)) {
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
    "Access-Control-Allow-Methods": "OPTIONS, POST",
    "Access-Control-Allow-Headers": "Content-Type, X-User-Token",
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

app.use("/api/enhance", async (c, next) => {
  const incomingOrigin = c.req.header("Origin");
  if (!incomingOrigin) {
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

  const userToken = c.req.header("X-User-Token");
  if (!userToken) {
    const errOrigin = c.get("corsOrigin") as string;
    return jsonError(c, 401, "UNAUTHORIZED", "Missing X-User-Token", errOrigin);
  }

  const RATE_LIMIT_PER_DAY = parseInt(c.env.RATE_LIMIT_PER_DAY || "100", 10);
  const ip = c.req.header("CF-Connecting-IP") || "unknown";
  const rateLimitKey = `rate_limit:${userToken}:${ip}`;

  const stored = (await c.env.REQUEST_COUNT.get(rateLimitKey, "json")) as {
    count: number;
    timestamp: number;
  } | null;
  const now = Date.now();

  let count = stored?.count || 0;
  let timestamp = stored?.timestamp || now;

  if (now - timestamp > 24 * 60 * 60 * 1000) {
    count = 0;
    timestamp = now;
  }

  if (count >= RATE_LIMIT_PER_DAY) {
    const reset = Math.floor((timestamp + 24 * 60 * 60 * 1000) / 1000);
    const rateOrigin = (c.get("corsOrigin") as string) || "*";
    const headers = buildBaseHeaders(rateOrigin, {
      "X-RateLimit-Limit": String(RATE_LIMIT_PER_DAY),
      "X-RateLimit-Remaining": "0",
      "X-RateLimit-Reset": String(reset),
    });
    return c.json(
      { code: "RATE_LIMIT_EXCEEDED", message: "Rate limit exceeded" },
      429,
      headers
    );
  }

  const newCount = count + 1;
  await c.env.REQUEST_COUNT.put(
    rateLimitKey,
    JSON.stringify({ count: newCount, timestamp }),
    { expirationTtl: 86400 }
  );

  const reset = Math.floor((timestamp + 24 * 60 * 60 * 1000) / 1000);
  c.set("usageCount", newCount);
  c.set("rateLimit", {
    limit: RATE_LIMIT_PER_DAY,
    remaining: Math.max(0, RATE_LIMIT_PER_DAY - newCount),
    reset,
  });

  await next();
});

app.options("/api/enhance", (c) => {
  const origin = c.get("corsOrigin");
  return new Response(null, { status: 204, headers: buildBaseHeaders(origin) });
});

// Generic CORS preflight for future endpoints
app.options("*", (c) => {
  const origin = resolveAllowedOrigin(c.req.header("Origin"), c.env);
  if (!origin)
    return new Response(null, {
      status: 403,
      headers: buildBaseHeaders("null"),
    });
  return new Response(null, { status: 204, headers: buildBaseHeaders(origin) });
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

    if (!c.env.OPENROUTER_API_KEY) {
      return jsonError(
        c,
        500,
        "SERVER_MISCONFIGURED",
        "Missing OPENROUTER_API_KEY",
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
      response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${c.env.OPENROUTER_API_KEY}`,
          "HTTP-Referer": c.env.APP_HTTP_REFERER,
          "X-Title": c.env.APP_TITLE || "Enhance Prompt",
        },
        body: JSON.stringify(validation.data),
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
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set(
      "Access-Control-Expose-Headers",
      "X-Usage-Count, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset"
    );
    headers.set("Access-Control-Allow-Methods", "OPTIONS, POST");
    headers.set("Access-Control-Allow-Headers", "Content-Type, X-User-Token");
    headers.set("Access-Control-Max-Age", "86400");
    headers.set("Cache-Control", "no-store");
    headers.set("Vary", "Origin");

    return new Response(response.body, {
      status: response.status,
      headers,
    });
  } catch {
    return jsonError(c, 500, "INTERNAL_ERROR", "Internal Server Error", origin);
  }
});

export default app;
