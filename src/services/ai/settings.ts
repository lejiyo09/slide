/**
 * AI 설정과 제공자 선택.
 * API 키는 문서(.slidelab/.pptx)나 IndexedDB 문서에 넣지 않고, 이 브라우저의 저장소에만 둔다:
 * '이 브라우저에 기억'을 끄면 sessionStorage(탭을 닫으면 삭제), 켜면 localStorage.
 */
import type { AIProvider, ImageProvider, ProviderId } from './types';
import { AIError } from './types';
import { OfflineProvider } from './offline/provider';
import { DEFAULT_GPT_IMAGE_MODEL, DEFAULT_GPT_MODEL, OPENAI_BASE_URL, type Effort } from './models';

export interface AISettings {
  provider: ProviderId;
  /** OpenAI GPT (api.openai.com) */
  gpt: { model: string };
  anthropic: { model: string; effort: Effort };
  openai: { baseUrl: string; model: string };
  /** source 'gpt': GPT 키로 OpenAI 이미지 API 사용 / 'custom': 별도 엔드포인트 */
  image: { enabled: boolean; source: 'gpt' | 'custom'; baseUrl: string; model: string };
  /** 키를 이 브라우저에 기억 (localStorage) */
  rememberKeys: boolean;
}

export interface AIKeys {
  gpt?: string;
  anthropic?: string;
  openai?: string;
  image?: string;
}

export const DEFAULT_AI_SETTINGS: AISettings = {
  provider: 'offline',
  gpt: { model: DEFAULT_GPT_MODEL },
  anthropic: { model: 'claude-opus-5-5', effort: 'medium' },
  openai: { baseUrl: 'http://localhost:11434/v1', model: '' },
  image: { enabled: false, source: 'gpt', baseUrl: '', model: DEFAULT_GPT_IMAGE_MODEL },
  rememberKeys: false,
};

const SETTINGS_KEY = 'slidelab.ai.settings';
const KEYS_KEY = 'slidelab.ai.keys';

const safe = <T>(fn: () => T, fallback: T): T => {
  try {
    return fn();
  } catch {
    return fallback;
  }
};

export function loadAISettings(): AISettings {
  const raw = safe(() => localStorage.getItem(SETTINGS_KEY), null);
  if (!raw) return structuredClone(DEFAULT_AI_SETTINGS);
  const v = safe(() => JSON.parse(raw) as Partial<AISettings>, {});
  return {
    ...DEFAULT_AI_SETTINGS,
    ...v,
    gpt: { ...DEFAULT_AI_SETTINGS.gpt, ...v.gpt },
    anthropic: { ...DEFAULT_AI_SETTINGS.anthropic, ...v.anthropic },
    openai: { ...DEFAULT_AI_SETTINGS.openai, ...v.openai },
    image: { ...DEFAULT_AI_SETTINGS.image, ...v.image },
  };
}

export function loadAIKeys(): AIKeys {
  const raw = safe(() => sessionStorage.getItem(KEYS_KEY), null) ?? safe(() => localStorage.getItem(KEYS_KEY), null);
  return raw ? safe(() => JSON.parse(raw) as AIKeys, {}) : {};
}

export function saveAISettings(s: AISettings, keys: AIKeys) {
  safe(() => localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)), undefined);
  const json = JSON.stringify(keys);
  safe(() => sessionStorage.removeItem(KEYS_KEY), undefined);
  safe(() => localStorage.removeItem(KEYS_KEY), undefined);
  if (Object.values(keys).some(Boolean)) safe(() => (s.rememberKeys ? localStorage : sessionStorage).setItem(KEYS_KEY, json), undefined);
}

/** 키를 화면에 보여 줄 때: 앞뒤 일부만 */
export const maskKey = (k?: string) => (k ? (k.length > 12 ? `${k.slice(0, 7)}…${k.slice(-4)}` : '••••') : '');

const offline = new OfflineProvider();
export const offlineProvider = () => offline;

/** 설정된 제공자 (Claude SDK는 사용할 때만 불러옴) */
export async function getProvider(s: AISettings = loadAISettings(), keys: AIKeys = loadAIKeys()): Promise<AIProvider> {
  if (s.provider === 'openai') {
    if (!keys.gpt) throw new AIError('OpenAI API 키가 없습니다. AI 설정에서 입력하세요.', 'config');
    const { OpenAICompatibleProvider } = await import('./openaiCompatible');
    return new OpenAICompatibleProvider(OPENAI_BASE_URL, s.gpt.model || DEFAULT_GPT_MODEL, keys.gpt, 'GPT');
  }
  if (s.provider === 'anthropic') {
    const { AnthropicProvider } = await import('./anthropic');
    return new AnthropicProvider(keys.anthropic ?? '', s.anthropic.model, s.anthropic.effort);
  }
  if (s.provider === 'openai-compatible') {
    const { OpenAICompatibleProvider } = await import('./openaiCompatible');
    return new OpenAICompatibleProvider(s.openai.baseUrl, s.openai.model, keys.openai);
  }
  return offline;
}

export async function getImageProvider(s: AISettings = loadAISettings(), keys: AIKeys = loadAIKeys()): Promise<ImageProvider> {
  if (!s.image.enabled) throw new AIError('이미지 생성 제공자가 설정되지 않았습니다. AI 설정 › 이미지 생성에서 연결하세요.', 'config');
  const { OpenAICompatibleImageProvider } = await import('./openaiCompatible');
  if (s.image.source === 'gpt') {
    if (!keys.gpt) throw new AIError('이미지 생성에 쓸 OpenAI API 키가 없습니다. AI 설정에서 입력하세요.', 'config');
    return new OpenAICompatibleImageProvider(OPENAI_BASE_URL, s.image.model || DEFAULT_GPT_IMAGE_MODEL, keys.gpt);
  }
  return new OpenAICompatibleImageProvider(s.image.baseUrl, s.image.model, keys.image);
}
