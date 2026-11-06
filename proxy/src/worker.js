/**
 * SlideLab AI 중계 서버 (Cloudflare Worker).
 * - OpenAI API 키(OPENAI_API_KEY)는 Worker 비밀 값으로만 보관: 공개 사이트(GitHub Pages) 파일에는 들어가지 않는다.
 * - 정해진 두 경로만 api.openai.com으로 전달 (열린 프록시가 되지 않도록):
 *     POST /v1/chat/completions, POST /v1/images/generations
 * - 허용한 사이트(ALLOWED_ORIGINS)에서 온 요청만 받고, 접근 코드(ACCESS_CODE)를 확인한다.
 * - 선택: ALLOWED_MODELS(쉼표 구분, '*'면 제한 없음)로 쓸 수 있는 모델을 제한한다.
 */
const UPSTREAM = 'https://api.openai.com';
const PATHS = new Set(['/v1/chat/completions', '/v1/images/generations']);
const MAX_BODY = 2 * 1024 * 1024; // 2MB (긴 문서 요청 허용, 그 이상은 거절)

const list = (v) =>
  String(v ?? '')
    .split(/[\s,]+/)
    .map((x) => x.trim().replace(/\/+$/, ''))
    .filter(Boolean);

function json(status, body, headers) {
  return new Response(JSON.stringify(body), { status, headers: { ...headers, 'content-type': 'application/json; charset=utf-8' } });
}
const err = (status, message, headers) => json(status, { error: { message } }, headers);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') ?? '';
    const allowed = list(env.ALLOWED_ORIGINS);
    const originOk = !!origin && (allowed.includes('*') || allowed.includes(origin));
    const cors = {
      'Access-Control-Allow-Origin': originOk ? origin : 'null',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'content-type, x-slidelab-access',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    };

    // 상태 확인 (키 값은 절대 내보내지 않음)
    if (request.method === 'GET' && url.pathname === '/health') {
      return json(200, { ok: true, keyConfigured: !!env.OPENAI_API_KEY, accessCodeRequired: !!env.ACCESS_CODE && env.ACCESS_CODE !== 'none' }, originOk ? cors : {});
    }
    if (request.method === 'OPTIONS') return new Response(null, { status: originOk ? 204 : 403, headers: cors });
    if (!originOk) return err(403, '허용되지 않은 사이트에서 온 요청입니다.', cors);
    if (request.method !== 'POST' || !PATHS.has(url.pathname)) return err(404, '지원하지 않는 경로입니다.', cors);
    if (env.ACCESS_CODE && env.ACCESS_CODE !== 'none' && request.headers.get('x-slidelab-access') !== env.ACCESS_CODE) {
      return err(401, '접근 코드가 올바르지 않습니다. AI 설정에서 접근 코드를 확인하세요.', cors);
    }
    if (!env.OPENAI_API_KEY) return err(500, '중계 서버에 OPENAI_API_KEY가 설정되지 않았습니다.', cors);

    const length = Number(request.headers.get('content-length') ?? 0);
    if (length > MAX_BODY) return err(413, '요청이 너무 큽니다.', cors);
    const text = await request.text();
    if (text.length > MAX_BODY) return err(413, '요청이 너무 큽니다.', cors);
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      return err(400, 'JSON 요청이 아닙니다.', cors);
    }
    const models = list(env.ALLOWED_MODELS);
    if (models.length && !models.includes('*') && !models.includes(String(body?.model ?? ''))) {
      return err(400, `이 중계 서버에서 허용하지 않은 모델입니다: ${body?.model}. 허용: ${models.join(', ')}`, cors);
    }

    // 클라이언트가 보낸 인증 헤더는 쓰지 않고 서버의 키로만 호출
    const upstream = await fetch(UPSTREAM + url.pathname, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${env.OPENAI_API_KEY}` },
      body: text,
    });
    return new Response(upstream.body, {
      status: upstream.status,
      headers: { ...cors, 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
    });
  },
};
