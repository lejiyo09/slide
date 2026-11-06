/** Claude 모델 목록 (SDK를 불러오지 않고 설정 화면에서 쓰도록 분리) */
export const CLAUDE_MODELS = [
  { id: 'claude-opus-5-5', name: 'Claude Opus 5.5 (기본)' },
  { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5' },
  { id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5' },
  { id: 'claude-fable-5-1', name: 'Claude Fable 5.1' },
];
export const DEFAULT_CLAUDE_MODEL = 'claude-opus-5-5';
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

/** OpenAI (GPT) — 모델 이름은 자주 바뀌므로 목록은 제안일 뿐, 설정에서 직접 입력할 수 있다 */
export const OPENAI_BASE_URL = 'https://api.openai.com/v1';
export const GPT_MODEL_SUGGESTIONS = ['gpt-5', 'gpt-5-mini', 'gpt-4.1', 'gpt-4o'];
export const DEFAULT_GPT_MODEL = 'gpt-5';
export const DEFAULT_GPT_IMAGE_MODEL = 'gpt-image-1';
