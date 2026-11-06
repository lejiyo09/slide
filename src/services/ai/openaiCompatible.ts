/**
 * 범용 제공자: OpenAI 호환 HTTP API (/chat/completions, /images/generations).
 * 특정 업체에 묶이지 않도록, 같은 형식을 제공하는 서버(로컬 Ollama·LM Studio·사내 게이트웨이 등)를 주소만 바꿔 연결한다.
 * 텍스트 작업은 LLMProvider의 공통 지시문·스키마를 그대로 쓴다.
 */
import type { CallOptions, ImageProvider } from './types';
import { AIError } from './types';
import { LLMProvider, SYSTEM_PROMPT, parseJSONText, type JSONRequest } from './llm';

const trimSlash = (u: string) => u.replace(/\/+$/, '');

async function http(url: string, body: unknown, key: string | undefined, call?: CallOptions, extra: Record<string, string> = {}): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}), ...extra },
      body: JSON.stringify(body),
      signal: call?.signal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw new AIError('취소했습니다.', 'aborted');
    throw new AIError(`${new URL(url).host}에 연결할 수 없습니다. 주소와 CORS 허용 설정을 확인하세요.`, 'network');
  }
  if (res.status === 401 || res.status === 403) {
    const msg = await errorText(res);
    throw new AIError(`인증 실패 (${res.status})${msg ? `: ${msg}` : '. API 키를 확인하세요.'}`, 'auth');
  }
  if (res.status === 429) throw new AIError('요청이 너무 많습니다 (429). 잠시 후 다시 시도하세요.', 'rate');
  return res;
}

async function errorText(res: Response) {
  const t = await res.text().catch(() => '');
  try {
    return (JSON.parse(t) as { error?: { message?: string } }).error?.message ?? t.slice(0, 200);
  } catch {
    return t.slice(0, 200);
  }
}

export class OpenAICompatibleProvider extends LLMProvider {
  readonly id: 'gpt-proxy' | 'openai' | 'openai-compatible';
  readonly name: string;
  readonly readsPdf = false;

  constructor(
    private baseUrl: string,
    private model: string,
    private apiKey?: string,
    label?: string,
    private headers: Record<string, string> = {},
    id?: 'gpt-proxy',
  ) {
    super();
    if (!baseUrl || !model) throw new AIError('OpenAI 호환 엔드포인트의 주소와 모델 이름을 AI 설정에서 입력하세요.', 'config');
    this.id = id ?? (label ? 'openai' : 'openai-compatible');
    this.name = label ? `${label} (${model})` : `${model} (${new URL(baseUrl).host})`;
  }

  protected async completeJSON(req: JSONRequest, call?: CallOptions): Promise<unknown> {
    if (req.document?.pdfBase64 && !req.document.text) throw new AIError('이 제공자는 PDF를 직접 읽지 못합니다. 텍스트나 Word 문서를 사용하세요.', 'config');
    const url = `${trimSlash(this.baseUrl)}/chat/completions`;
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: req.user },
    ];
    // JSON 스키마 응답 형식 → 지원하지 않는 서버(400)는 스키마를 지시문에 넣어 다시 요청
    let res = await http(url, { model: this.model, messages, response_format: { type: 'json_schema', json_schema: { name: 'result', schema: req.schema, strict: true } } }, this.apiKey, call, this.headers);
    if (res.status === 400 || res.status === 422) {
      const withSchema = [messages[0], { role: 'user', content: `${req.user}\n\nRespond with a single JSON object that matches this JSON schema:\n${JSON.stringify(req.schema)}` }];
      res = await http(url, { model: this.model, messages: withSchema }, this.apiKey, call, this.headers);
    }
    if (!res.ok) throw new AIError(`AI 서버 오류 (${res.status}): ${await errorText(res)}`, 'other');
    const data = (await res.json()) as { choices?: { message?: { content?: string; refusal?: string }; finish_reason?: string }[] };
    const choice = data.choices?.[0];
    if (choice?.message?.refusal) throw new AIError('모델이 요청을 거절했습니다.', 'refusal');
    if (choice?.finish_reason === 'length') throw new AIError('응답이 너무 길어 끊겼습니다.', 'format');
    const text = choice?.message?.content ?? '';
    call?.onProgress?.({ chars: text.length });
    return parseJSONText(text);
  }
}

/** 이미지 생성: OpenAI 호환 /images/generations (b64_json 또는 url 응답) */
export class OpenAICompatibleImageProvider implements ImageProvider {
  readonly name: string;
  constructor(
    private baseUrl: string,
    private model: string,
    private apiKey?: string,
    private headers: Record<string, string> = {},
  ) {
    if (!baseUrl || !model) throw new AIError('이미지 생성 엔드포인트의 주소와 모델을 AI 설정에서 입력하세요.', 'config');
    this.name = `${model} (${new URL(baseUrl).host})`;
  }

  async generate(prompt: string, size: '1024x1024' | '1536x1024' | '1024x1536', call?: CallOptions): Promise<Blob> {
    const res = await http(`${trimSlash(this.baseUrl)}/images/generations`, { model: this.model, prompt, size, n: 1 }, this.apiKey, call, this.headers);
    if (!res.ok) throw new AIError(`이미지 생성 오류 (${res.status}): ${await errorText(res)}`, 'other');
    const data = (await res.json()) as { data?: { b64_json?: string; url?: string }[] };
    const item = data.data?.[0];
    if (item?.b64_json) {
      const bin = atob(item.b64_json);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new Blob([bytes], { type: 'image/png' });
    }
    if (item?.url) {
      const img = await fetch(item.url, { signal: call?.signal }).catch(() => null);
      if (img?.ok) return img.blob();
      throw new AIError('생성된 이미지를 내려받지 못했습니다 (CORS).', 'network');
    }
    throw new AIError('이미지 생성 응답에 이미지가 없습니다.', 'format');
  }
}
