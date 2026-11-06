/**
 * 오프라인 텍스트 처리 (한국어/영어): 문장 나누기, 핵심어, 추출 요약.
 * 생성형 모델이 아니라 통계 규칙이므로 "원문 문장을 골라 줄이는" 수준이다.
 */

const KO_PARTICLES = [
  '으로부터', '에서부터', '이라는', '이라고', '에게서', '으로서', '으로써', '에서는', '에서도', '까지는', '부터는',
  '에서', '에게', '으로', '이다', '이며', '이고', '라는', '라고', '까지', '부터', '처럼', '보다', '마다', '하는', '하고', '하며', '했다', '한다', '합니다', '됩니다', '입니다', '있다', '없다',
  '은', '는', '이', '가', '을', '를', '의', '에', '와', '과', '도', '만', '로', '께', '며', '고',
];
const STOP = new Set([
  '그리고', '그러나', '하지만', '또한', '또는', '및', '등', '것', '수', '때', '더', '각', '이런', '그런', '저런', '이번', '우리', '저희', '여러분', '대한', '위한', '통해', '대해', '있는', '없는', '되는', '하는', '있습니다', '합니다', '입니다', '같은', '매우', '모든', '가장',
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'is', 'are', 'was', 'were', 'be', 'with', 'as', 'by', 'at', 'it', 'this', 'that', 'from', 'we', 'you', 'our', 'your',
]);

/** 문장 나누기: 마침표/물음표/느낌표/줄바꿈, 한국어 종결 어미(다./요.) 기준 */
export function splitSentences(text: string): string[] {
  return text
    .replace(/\r/g, '')
    .split(/\n+|(?<=[.!?。！？])\s+/)
    .map((s) => s.trim().replace(/^[-*•·▪◦]\s*/, ''))
    .filter((s) => s.length > 1);
}

/** 어근 비슷하게: 조사/어미 떼기 */
export function stem(word: string): string {
  let w = word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  if (/^[a-z]+$/.test(w)) return w.replace(/(ies|es|s)$/, (m) => (m === 'ies' ? 'y' : '')).replace(/(ing|ed)$/, '');
  for (const p of KO_PARTICLES) {
    if (w.length > p.length + 1 && w.endsWith(p)) {
      w = w.slice(0, -p.length);
      break;
    }
  }
  return w;
}

export function tokens(text: string): string[] {
  return text
    .split(/[^\p{L}\p{N}]+/u)
    .map(stem)
    .filter((w) => w.length >= 2 && !STOP.has(w) && !/^\d+$/.test(w));
}

/** 빈도 기반 핵심어 (긴 단어·앞에 나온 단어 가산) */
export function keywords(text: string, max = 8): string[] {
  const freq = new Map<string, number>();
  const first = new Map<string, number>();
  tokens(text).forEach((t, i) => {
    freq.set(t, (freq.get(t) ?? 0) + 1);
    if (!first.has(t)) first.set(t, i);
  });
  return [...freq.entries()]
    .map(([t, f]) => [t, f * (1 + Math.min(t.length, 6) / 6) + 1 / (1 + (first.get(t) ?? 0) / 20)] as const)
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([t]) => t);
}

/** 추출 요약: 핵심어 점수가 높은 문장을 원래 순서대로 */
export function extractiveSummary(text: string, maxSentences: number): string[] {
  const sents = splitSentences(text);
  if (sents.length <= maxSentences) return sents;
  const freq = new Map<string, number>();
  for (const t of tokens(text)) freq.set(t, (freq.get(t) ?? 0) + 1);
  const scored = sents.map((s, i) => {
    const ts = tokens(s);
    const score = ts.reduce((a, t) => a + (freq.get(t) ?? 0), 0) / Math.sqrt(ts.length + 1) + (i === 0 ? 1.5 : 0) + (i < 3 ? 0.5 : 0);
    return { s, i, score };
  });
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, maxSentences)
    .sort((a, b) => a.i - b.i)
    .map((x) => x.s);
}

/** 글머리 기호용으로 줄이기: 끝 마침표 제거, 너무 길면 자름 */
export function toBullet(sentence: string, max = 70): string {
  let s = sentence.trim().replace(/[.。]$/, '');
  if (s.length > max) {
    const cut = s.slice(0, max);
    const sp = cut.lastIndexOf(' ');
    s = `${(sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[,，、\s]+$/, '')}…`;
  }
  return s;
}

/** 한국어 발표 속도 기준 예상 시간 (공백 제외 약 5자/초) */
export function speakingSeconds(script: string): number {
  const chars = script.replace(/\s/g, '').length;
  const latinWords = (script.match(/[A-Za-z]+/g) ?? []).length;
  return Math.round(chars / 5 + latinWords * 0.1);
}

/** 대본에 핵심어가 나오는지 (어근 비교) */
export function covers(scriptTokens: Set<string>, keyword: string): boolean {
  if (scriptTokens.has(keyword)) return true;
  for (const t of scriptTokens) if (t.length >= 2 && (t.startsWith(keyword) || keyword.startsWith(t)) && Math.min(t.length, keyword.length) >= 2) return true;
  return false;
}
