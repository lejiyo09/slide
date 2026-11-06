// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from './src/worker.js';

const ENV = { OPENAI_API_KEY: 'sk-server-secret', ACCESS_CODE: 'code123', ALLOWED_ORIGINS: 'https://lejiyo09.github.io', ALLOWED_MODELS: 'gpt-5, gpt-image-1' };
const req = (path, { method = 'POST', origin = 'https://lejiyo09.github.io', code = 'code123', body = { model: 'gpt-5', messages: [] }, headers = {} } = {}) =>
  new Request(`https://slidelab-ai-proxy.example.workers.dev${path}`, {
    method,
    headers: { ...(origin ? { Origin: origin } : {}), ...(code ? { 'x-slidelab-access': code } : {}), 'content-type': 'application/json', ...headers },
    ...(method === 'POST' ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
  });

afterEach(() => vi.unstubAllGlobals());

function stubUpstream() {
  const calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({ choices: [{ message: { content: '{}' } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }),
  );
  return calls;
}

describe('AI 중계 서버 (Cloudflare Worker)', () => {
  it('허용한 사이트 + 접근 코드 → 서버 키로 OpenAI에 전달, 클라이언트 인증 헤더는 버림', async () => {
    const calls = stubUpstream();
    const res = await worker.fetch(req('/v1/chat/completions', { headers: { authorization: 'Bearer stolen' } }), ENV);
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('https://lejiyo09.github.io');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.openai.com/v1/chat/completions');
    expect(new Headers(calls[0].init.headers).get('authorization')).toBe('Bearer sk-server-secret');
    expect(JSON.parse(calls[0].init.body).model).toBe('gpt-5');
  });

  it('사전 요청(OPTIONS)과 상태 확인 — 키 값은 내보내지 않음', async () => {
    const pre = await worker.fetch(req('/v1/chat/completions', { method: 'OPTIONS' }), ENV);
    expect(pre.status).toBe(204);
    expect(pre.headers.get('access-control-allow-headers')).toContain('x-slidelab-access');
    const h = await worker.fetch(req('/health', { method: 'GET' }), ENV);
    const body = await h.text();
    expect(JSON.parse(body)).toEqual({ ok: true, keyConfigured: true, accessCodeRequired: true });
    expect(body).not.toContain('sk-server');
  });

  it('거절: 다른 사이트, 접근 코드 틀림, 다른 경로, 허용 안 한 모델, 큰 요청, 잘못된 JSON', async () => {
    const calls = stubUpstream();
    expect((await worker.fetch(req('/v1/chat/completions', { origin: 'https://evil.example' }), ENV)).status).toBe(403);
    expect((await worker.fetch(req('/v1/chat/completions', { origin: '' }), ENV)).status).toBe(403);
    expect((await worker.fetch(req('/v1/chat/completions', { code: 'wrong' }), ENV)).status).toBe(401);
    expect((await worker.fetch(req('/v1/models'), ENV)).status).toBe(404);
    expect((await worker.fetch(req('/v1/files'), ENV)).status).toBe(404);
    const bad = await worker.fetch(req('/v1/chat/completions', { body: { model: 'gpt-4.5-expensive' } }), ENV);
    expect(bad.status).toBe(400);
    expect((await bad.json()).error.message).toContain('허용하지 않은 모델');
    expect((await worker.fetch(req('/v1/chat/completions', { body: 'x'.repeat(2 * 1024 * 1024 + 10) }), ENV)).status).toBe(413);
    expect((await worker.fetch(req('/v1/chat/completions', { body: '{not json' }), ENV)).status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it('이미지 생성 경로 전달, 접근 코드 "none"이면 확인 안 함, 키 없으면 500', async () => {
    const calls = stubUpstream();
    const r = await worker.fetch(req('/v1/images/generations', { code: '', body: { model: 'gpt-image-1', prompt: 'x' } }), { ...ENV, ACCESS_CODE: 'none' });
    expect(r.status).toBe(200);
    expect(calls[0].url).toBe('https://api.openai.com/v1/images/generations');
    expect((await worker.fetch(req('/v1/chat/completions'), { ...ENV, OPENAI_API_KEY: '' })).status).toBe(500);
  });

  it('OpenAI 오류 상태와 본문을 그대로 돌려줌', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":{"message":"quota"}}', { status: 429, headers: { 'content-type': 'application/json' } })));
    const r = await worker.fetch(req('/v1/chat/completions'), ENV);
    expect(r.status).toBe(429);
    expect(await r.text()).toContain('quota');
  });
});
