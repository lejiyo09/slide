/**
 * Claude 제공자 (공식 Anthropic TypeScript SDK, Apache-2.0).
 * - 정적 사이트라 서버가 없으므로 사용자가 입력한 자신의 API 키로 브라우저에서 직접 호출 (dangerouslyAllowBrowser)
 * - 구조화 출력(output_config.format = JSON 스키마) + 스트리밍(긴 응답의 시간 초과 방지, 진행 표시)
 * - 거절(refusal) 시 서버 측 대체 모델로 자동 재시도 (fallbacks: "default")
 */
import Anthropic from '@anthropic-ai/sdk';
import type { CallOptions } from './types';
import { AIError } from './types';
import { LLMProvider, SYSTEM_PROMPT, parseJSONText, type JSONRequest } from './llm';

import { DEFAULT_CLAUDE_MODEL, type Effort } from './models';
export { CLAUDE_MODELS, DEFAULT_CLAUDE_MODEL, type Effort } from './models';

/** 서버 측 대체 모델("default" 형식)을 지원하는 모델 */
const FALLBACK_MODELS = new Set(['claude-opus-5-5', 'claude-opus-5', 'claude-fable-5-1', 'claude-sonnet-5-5']);

export class AnthropicProvider extends LLMProvider {
  readonly id = 'anthropic' as const;
  readonly name: string;
  readonly readsPdf = true;
  private client: Anthropic;

  constructor(
    apiKey: string,
    private model: string = DEFAULT_CLAUDE_MODEL,
    private effort: Effort = 'medium',
    fetchImpl?: typeof fetch,
  ) {
    super();
    if (!apiKey) throw new AIError('Claude API 키가 없습니다. AI 설정에서 입력하세요.', 'config');
    this.name = `Claude (${model})`;
    // 사용자 본인의 키를 그 사용자의 브라우저에서만 사용 (SlideLab 서버로 보내지 않음)
    this.client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 2, ...(fetchImpl ? { fetch: fetchImpl } : {}) });
  }

  protected async completeJSON(req: JSONRequest, call?: CallOptions): Promise<unknown> {
    const content: Anthropic.Beta.BetaContentBlockParam[] = [];
    if (req.document?.pdfBase64) content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: req.document.pdfBase64 }, title: req.document.name });
    content.push({ type: 'text', text: req.user });
    const fallback = FALLBACK_MODELS.has(this.model);
    let msg: Anthropic.Beta.BetaMessage;
    try {
      const stream = this.client.beta.messages.stream(
        {
          model: this.model,
          max_tokens: 32000,
          ...(fallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
          system: SYSTEM_PROMPT,
          output_config: { effort: this.effort, format: { type: 'json_schema', schema: req.schema } },
          messages: [{ role: 'user', content }],
        },
        { signal: call?.signal },
      );
      stream.on('text', (_delta, snapshot) => call?.onProgress?.({ chars: snapshot.length }));
      msg = await stream.finalMessage();
    } catch (e) {
      throw toAIError(e);
    }
    if (msg.stop_reason === 'refusal') throw new AIError('Claude가 이 요청을 처리하지 않았습니다(안전 정책). 내용을 바꿔 다시 시도하세요.', 'refusal');
    if (msg.stop_reason === 'max_tokens') throw new AIError('응답이 너무 길어 중간에 끊겼습니다. 슬라이드 수를 줄이거나 내용을 나눠 요청하세요.', 'format');
    const text = msg.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
    return parseJSONText(text);
  }
}

export function toAIError(e: unknown): AIError {
  if (e instanceof AIError) return e;
  if (e instanceof Anthropic.APIUserAbortError) return new AIError('취소했습니다.', 'aborted');
  if (e instanceof Anthropic.AuthenticationError) return new AIError('API 키가 올바르지 않습니다 (401). AI 설정에서 키를 확인하세요.', 'auth');
  if (e instanceof Anthropic.PermissionDeniedError) return new AIError('이 키로는 선택한 모델을 사용할 수 없습니다 (403).', 'auth');
  if (e instanceof Anthropic.RateLimitError) return new AIError('요청이 너무 많습니다 (429). 잠시 후 다시 시도하세요.', 'rate');
  if (e instanceof Anthropic.BadRequestError) return new AIError(`요청 오류 (400): ${e.message}`, 'other');
  if (e instanceof Anthropic.APIConnectionError) return new AIError('Claude API에 연결할 수 없습니다. 인터넷 연결을 확인하세요.', 'network');
  if (e instanceof Anthropic.APIError) return new AIError(`Claude API 오류 (${e.status ?? '?'}): ${e.message}`, 'other');
  if (e instanceof DOMException && e.name === 'AbortError') return new AIError('취소했습니다.', 'aborted');
  return new AIError(e instanceof Error ? e.message : String(e), 'other');
}
