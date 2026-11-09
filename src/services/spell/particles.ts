/**
 * 조사 받침 맞춤 (문맥 문법): 앞말의 끝소리에 받침이 있으면 '은·이·을·과·으로·이나·이랑', 없으면 '는·가·를·와·로·나·랑',
 * ㄹ 받침 뒤에는 '로'(으로 아님). (국립국어원 표준국어대사전의 각 조사 풀이)
 *
 * 1) 한글 낱말: hunspell(ko)이 틀렸다고 한 낱말 = 앞말 + 조사일 때, 조사를 받침에 맞게 바꾼 말을 hunspell이 맞다고 하면
 *    맞춤법 오류가 아니라 '조사 받침 맞춤' 문법 오류로 알려 준다 (예: 학교을 → 학교를, 서울으로 → 서울로).
 * 2) 숫자·대문자 약어 + 조사: 맞춤법 검사가 건너뛰는 부분이라 읽는 소리로 판단한다
 *    (2를 = '이를', 3을 = '삼을', 10을 = '십을', 1로 = '일로', SQL로 = '에스큐엘로', API를 = '에이피아이를').
 */

type Final = 'none' | 'rieul' | 'other';

/** [받침 있을 때, 받침 없을 때] — 긴 것부터 */
const PAIRS: [string, string][] = [
  ['으로써', '로써'],
  ['으로서', '로서'],
  ['으로', '로'],
  ['이나', '나'],
  ['이랑', '랑'],
  ['은', '는'],
  ['이', '가'],
  ['을', '를'],
  ['과', '와'],
];
const ALL = PAIRS.flat().sort((a, b) => b.length - a.length);

export function finalOfSyllable(ch: string): Final | null {
  const c = ch.charCodeAt(0) - 0xac00;
  if (c < 0 || c >= 11172) return null;
  const f = c % 28;
  return f === 0 ? 'none' : f === 8 ? 'rieul' : 'other';
}

/** 앞말 끝소리에 맞는 조사 */
export function particleFor(final: Final, particle: string): string {
  const pair = PAIRS.find((p) => p.includes(particle));
  if (!pair) return particle;
  const [withB, withoutB] = pair;
  // '(으)로' 계열: ㄹ 받침은 '로'
  if (withB.startsWith('으로')) return final === 'other' ? withB : withoutB;
  return final === 'none' ? withoutB : withB;
}

const why = (particle: string, fix: string, reading?: string) => {
  const pair = PAIRS.find((p) => p.includes(particle))!;
  const rule = pair[0].startsWith('으로')
    ? `받침이 있으면 '${pair[0]}', 받침이 없거나 ㄹ 받침이면 '${pair[1]}'`
    : `받침이 있으면 '${pair[0]}', 받침이 없으면 '${pair[1]}'`;
  return `조사는 앞말에 맞춰 씁니다: ${rule}${reading ? ` (${reading})` : ''}. → '${fix}'`;
};

export interface ParticleIssue {
  start: number;
  end: number;
  found: string;
  fix: string;
  why: string;
}

/** 1) hunspell이 틀렸다고 한 한글 낱말 → 조사만 바꾸면 맞는 말이면 고칠 말 */
export function particleAgreement(word: string, spell: (w: string) => boolean): { fix: string; why: string } | null {
  for (const p of ALL) {
    if (!word.endsWith(p) || word.length <= p.length) continue;
    const stem = word.slice(0, -p.length);
    const f = finalOfSyllable(stem[stem.length - 1]);
    if (!f) continue;
    const want = particleFor(f, p);
    if (want === p) continue;
    const fix = stem + want;
    if (spell(fix)) return { fix, why: why(p, fix) };
  }
  return null;
}

const DIGIT: Record<string, [Final, string]> = {
  '0': ['other', '영'],
  '1': ['rieul', '일'],
  '2': ['none', '이'],
  '3': ['other', '삼'],
  '4': ['none', '사'],
  '5': ['none', '오'],
  '6': ['other', '육'],
  '7': ['rieul', '칠'],
  '8': ['rieul', '팔'],
  '9': ['none', '구'],
};

/** 숫자를 읽을 때 끝소리 (10 = 십, 100 = 백, 1000 = 천, 1만 이상은 만·억·조 단위) */
export function numberFinal(num: string): [Final, string] {
  const [int, frac] = num.replace(/,/g, '').split('.');
  if (frac) return DIGIT[frac[frac.length - 1]];
  if (/^0+$/.test(int)) return DIGIT['0'];
  const zeros = int.length - int.replace(/0+$/, '').length;
  if (!zeros) return DIGIT[int[int.length - 1]];
  if (zeros === 1) return ['other', '십'];
  if (zeros === 2) return ['other', '백'];
  if (zeros === 3) return ['other', '천'];
  if (zeros < 8) return ['other', '만'];
  if (zeros < 12) return ['other', '억'];
  return ['none', '조'];
}

/** 영어 알파벳 이름의 끝소리 (R은 '알/아르'로 갈려 판단하지 않음) */
const LETTER: Record<string, [Final, string] | null> = {
  L: ['rieul', '엘'],
  M: ['other', '엠'],
  N: ['other', '엔'],
  R: null,
};
const letterFinal = (ch: string): [Final, string] | null => (ch in LETTER ? LETTER[ch] : ['none', '']);

/** 2) 숫자·대문자 약어 + 조사 */
export function checkParticles(text: string): ParticleIssue[] {
  const out: ParticleIssue[] = [];
  const re = new RegExp(`(?<![\\p{L}\\d.,])(\\d[\\d,]*(?:\\.\\d+)?|[A-Z]{2,6})(${ALL.join('|')})(?![가-힣])`, 'gu');
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const [, head, p] = m;
    const fin = /^\d/.test(head) ? numberFinal(head) : letterFinal(head[head.length - 1]);
    if (!fin) continue;
    const want = particleFor(fin[0], p);
    if (want === p) continue;
    const reading = /^\d/.test(head) ? `${head}의 끝소리 '${fin[1]}'` : fin[1] ? `${head[head.length - 1]} = '${fin[1]}'` : `${head[head.length - 1]}는 받침 없이 읽음`;
    out.push({ start: m.index + head.length, end: m.index + m[0].length, found: p, fix: want, why: why(p, `${head}${want}`, reading) });
  }
  return out;
}
