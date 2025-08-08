import { Hono } from 'hono';
import { z } from 'zod';
import type { KVNamespace } from '@cloudflare/workers-types';

export interface Env {
    REQUEST_COUNT: KVNamespace;
    OPENROUTER_API_KEY: string;
    APP_HTTP_REFERER: string;
    ALLOWED_ORIGINS?: string;
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

const RATE_LIMIT_PER_DAY = 100;
const MAX_BODY_BYTES = 48 * 1024;
const MAX_PROMPT_CHARS = 4000;
const REQUEST_TIMEOUT_MS = 15000;

function resolveAllowedOrigin(originHeader: string | null | undefined, env: Env): string | null {
    const requestedOrigin = (originHeader?.trim() || '') as string;
    if (requestedOrigin.startsWith('chrome-extension://')) {
        return requestedOrigin;
    }
    const configured = (env.ALLOWED_ORIGINS || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    let fallbackOrigin = '';
    try {
        fallbackOrigin = new URL(env.APP_HTTP_REFERER).origin;
    } catch {}

    const defaultAllowed: string[] = [];
    if (fallbackOrigin) defaultAllowed.push(fallbackOrigin);
    defaultAllowed.push('null', 'chrome-extension://*');

    const allowed = configured.length > 0 ? configured : defaultAllowed;
    if (allowed.includes('*')) return requestedOrigin || '*';

    if (requestedOrigin.startsWith('chrome-extension://')) {
        const configuredAllowsChrome = configured.length === 0
            || allowed.includes('chrome-extension://*')
            || allowed.includes(requestedOrigin)
            || allowed.includes('null');
        if (configuredAllowsChrome) {
            return requestedOrigin;
        }
    }

    if (requestedOrigin && allowed.includes(requestedOrigin)) return requestedOrigin;
    if (configured.length === 0 && (requestedOrigin.startsWith('https://') || requestedOrigin.startsWith('http://'))) {
        try {
            const url = new URL(requestedOrigin);
            const host = url.hostname;
            const allowedHosts = ['claude.ai', 'chat.openai.com', 'chatgpt.com', 'gemini.google.com', 'grok.com'];
            if (allowedHosts.some((suffix) => host === suffix || host.endsWith(`.${suffix}`))) {
                return requestedOrigin;
            }
        } catch {}
    }
    if (!requestedOrigin && allowed.includes('null')) return 'null';
    return null;
}

function buildBaseHeaders(origin: string, extra: Record<string, string> = {}): Record<string, string> {
    return {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'OPTIONS, POST',
        'Access-Control-Allow-Headers': 'Content-Type, X-User-Token',
        'Access-Control-Max-Age': '86400',
        'Access-Control-Expose-Headers': 'X-Usage-Count, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset',
        'Cache-Control': 'no-store',
        Vary: 'Origin',
        ...extra,
    };
}

function jsonError(c: any, status: number, code: string, message: string, origin: string, details?: unknown) {
    const payload: Record<string, unknown> = { code, message };
    if (details !== undefined) payload.details = details;
    return c.json(payload, status, buildBaseHeaders(origin));
}

 
const apiRequestSchema = z.object({
    model: z.string().optional().default('google/gemini-2.0-flash-exp:free'),
    messages: z
        .array(
            z.object({
                role: z.string(),
                content: z.string(),
            })
        )
        .min(1),
    max_tokens: z.number().optional().default(500),
    temperature: z.number().optional().default(0.7),
});

app.use('/api/enhance', async (c, next) => {
    const incomingOrigin = c.req.header('Origin');
    if (!incomingOrigin) {
        c.set('corsOrigin', '*');
    } else {
        const origin = resolveAllowedOrigin(incomingOrigin, c.env);
        if (!origin) {
            return jsonError(c, 403, 'CORS_ORIGIN_FORBIDDEN', 'Origin not allowed', 'null');
        }
        c.set('corsOrigin', origin);
    }

    if (c.req.method === 'OPTIONS') {
        const reqAllowedHeaders = c.req.header('Access-Control-Request-Headers');
        const preflightOrigin = (c.get('corsOrigin') as string) || '*';
        const headers = buildBaseHeaders(preflightOrigin);
        if (reqAllowedHeaders) {
            headers['Access-Control-Allow-Headers'] = reqAllowedHeaders;
        }
        return new Response(null, { status: 204, headers: headers });
    }

    const userToken = c.req.header('X-User-Token');
    if (!userToken) {
        const errOrigin = (c.get('corsOrigin') as string) || '*';
        return jsonError(c, 401, 'UNAUTHORIZED', 'Missing X-User-Token', errOrigin);
    }

    const ip = c.req.header('CF-Connecting-IP') || 'unknown';
    const rateLimitKey = `rate_limit:${userToken}:${ip}`;

    const stored = (await c.env.REQUEST_COUNT.get(rateLimitKey, 'json')) as
        | { count: number; timestamp: number }
        | null;
    const now = Date.now();

    let count = stored?.count || 0;
    let timestamp = stored?.timestamp || now;

    if (now - timestamp > 24 * 60 * 60 * 1000) {
        count = 0;
        timestamp = now;
    }

    if (count >= RATE_LIMIT_PER_DAY) {
        const reset = Math.floor((timestamp + 24 * 60 * 60 * 1000) / 1000);
        const rateOrigin = (c.get('corsOrigin') as string) || '*';
        const headers = buildBaseHeaders(rateOrigin, {
            'X-RateLimit-Limit': String(RATE_LIMIT_PER_DAY),
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': String(reset),
        });
        return c.json({ code: 'RATE_LIMIT_EXCEEDED', message: 'Rate limit exceeded' }, 429, headers);
    }

    const newCount = count + 1;
    await c.env.REQUEST_COUNT.put(
        rateLimitKey,
        JSON.stringify({ count: newCount, timestamp }),
        { expirationTtl: 86400 }
    );

    const reset = Math.floor((timestamp + 24 * 60 * 60 * 1000) / 1000);
    c.set('usageCount', newCount);
    c.set('rateLimit', {
        limit: RATE_LIMIT_PER_DAY,
        remaining: Math.max(0, RATE_LIMIT_PER_DAY - newCount),
        reset,
    });

    await next();
});

app.options('/api/enhance', (c) => {
    const origin = c.get('corsOrigin');
    return new Response(null, { status: 204, headers: buildBaseHeaders(origin) });
});

app.post('/api/enhance', async (c) => {
    const origin = c.get('corsOrigin');
    try {
        const contentLengthHeader = c.req.header('Content-Length');
        if (contentLengthHeader && Number(contentLengthHeader) > MAX_BODY_BYTES) {
            return jsonError(c, 413, 'PAYLOAD_TOO_LARGE', 'Request body too large', origin);
        }

        const rawText = await c.req.text();
        const rawBytes = new TextEncoder().encode(rawText).length;
        if (rawBytes > MAX_BODY_BYTES) {
            return jsonError(c, 413, 'PAYLOAD_TOO_LARGE', 'Request body too large', origin);
        }

        let body: unknown;
        try {
            body = JSON.parse(rawText || '{}');
        } catch {
            return jsonError(c, 400, 'INVALID_JSON', 'Malformed JSON body', origin);
        }

        const validation = apiRequestSchema.safeParse(body);
        if (!validation.success) {
            return c.json(
                { code: 'INVALID_BODY', message: 'Invalid request body', details: validation.error.flatten() },
                400,
                buildBaseHeaders(origin)
            );
        }

        const totalPromptChars = validation.data.messages.reduce((sum, m) => sum + m.content.length, 0);
        if (totalPromptChars > MAX_PROMPT_CHARS) {
            return jsonError(c, 413, 'PROMPT_TOO_LARGE', 'Prompt length exceeds limit', origin);
        }

        if (!c.env.OPENROUTER_API_KEY) {
            return jsonError(c, 500, 'SERVER_MISCONFIGURED', 'Missing OPENROUTER_API_KEY', origin);
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

        let response: Response;
        try {
            response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${c.env.OPENROUTER_API_KEY}`,
                    'HTTP-Referer': c.env.APP_HTTP_REFERER,
                    'X-Title': 'Enhance Prompt',
                },
                body: JSON.stringify(validation.data),
                signal: controller.signal,
            });
        } catch (err: any) {
            if (err?.name === 'AbortError') {
                clearTimeout(timeoutId);
                return jsonError(c, 504, 'UPSTREAM_TIMEOUT', 'Upstream request timed out', origin);
            }
            clearTimeout(timeoutId);
            return jsonError(c, 502, 'UPSTREAM_UNAVAILABLE', 'Upstream request failed', origin);
        }
        clearTimeout(timeoutId);

        const usageCount = c.get('usageCount') as number;
        const rate = c.get('rateLimit') as { limit: number; remaining: number; reset: number };

        if (!response.ok) {
            let upstreamPayload: unknown = null;
            const ct = response.headers.get('content-type') || '';
            try {
                if (ct.includes('application/json')) {
                    upstreamPayload = await response.json();
                } else {
                    const txt = await response.text();
                    upstreamPayload = txt.slice(0, 2000);
                }
            } catch {}
            const headers = buildBaseHeaders(origin, {
                'Content-Type': 'application/json',
                'X-Usage-Count': String(usageCount),
                'X-RateLimit-Limit': String(rate.limit),
                'X-RateLimit-Remaining': String(rate.remaining),
                'X-RateLimit-Reset': String(rate.reset),
            });
            return new Response(
                JSON.stringify({
                    code: 'UPSTREAM_ERROR',
                    message: 'Upstream error',
                    status: response.status,
                    upstream: upstreamPayload,
                }),
                { status: response.status, headers: new Headers(headers) }
            );
        }

        const headers = new Headers(response.headers);
        headers.set('X-Usage-Count', String(usageCount));
        headers.set('X-RateLimit-Limit', String(rate.limit));
        headers.set('X-RateLimit-Remaining', String(rate.remaining));
        headers.set('X-RateLimit-Reset', String(rate.reset));
        headers.set('Access-Control-Allow-Origin', origin);
        headers.set(
            'Access-Control-Expose-Headers',
            'X-Usage-Count, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset'
        );
        headers.set('Access-Control-Allow-Methods', 'OPTIONS, POST');
        headers.set('Access-Control-Allow-Headers', 'Content-Type, X-User-Token');
        headers.set('Access-Control-Max-Age', '86400');
        headers.set('Cache-Control', 'no-store');
        headers.set('Vary', 'Origin');

        return new Response(response.body, {
            status: response.status,
            headers,
        });
    } catch {
        return jsonError(c, 500, 'INTERNAL_ERROR', 'Internal Server Error', origin);
    }
});

export default app;


