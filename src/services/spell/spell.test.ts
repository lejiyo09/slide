// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { produce } from 'immer';
import { loadModule } from 'hunspell-asm';
import { applyFix, checkDocument, replaceInParagraph, tokenize, type Speller, type SpellLang } from './spell';
import { checkKorean } from './korean';
import { checkParticles, numberFinal, particleAgreement } from './particles';
import { aiIssues, listParagraphs } from './spell';
import { createPresentation } from '../../core/document/factory';
import type { Paragraph, TextObject } from '../../types/model';

const spellers = new Map<SpellLang, Speller>();
beforeAll(async () => {
  const f = await loadModule();
  for (const [lang, pkg] of [['ko', 'dictionary-ko'], ['en', 'dictionary-en']] as const) {
    const h = f.create(f.mountBuffer(readFileSync(`node_modules/${pkg}/index.aff`), `${lang}.aff`), f.mountBuffer(readFileSync(`node_modules/${pkg}/index.dic`), `${lang}.dic`));
    spellers.set(lang, { spell: (w) => h.spell(w), suggest: (w) => h.suggest(w) });
  }
}, 60000);

describe('낱말 나누기', () => {
  it('한국어·영어, 숫자·URL·대문자 약어·문장 부호 제외', () => {
    const t = tokenize('“Hello,” 세계! 2026년 www.example.com NASA don’t (test) a@b.com');
    expect(t.map((x) => [x.word, x.lang])).toEqual([
      ['Hello', 'en'],
      ['세계', 'ko'],
      ["don't", 'en'],
      ['test', 'en'],
    ]);
    expect(t[1]).toMatchObject({ start: 9, end: 11 });
  });
});

describe('한국어 규칙 (국립국어원 규범)', () => {
  const fixes = (s: string) => checkKorean(s).map((i) => `${i.found}→${i.fix}`);
  it('되/돼, 안/않, 어미', () => {
    expect(fixes('그렇게 되요')).toEqual(['되요→돼요']);
    expect(fixes('이러면 안되요')).toEqual(['안되요→안 돼요']);
    expect(fixes('그건 않되')).toEqual(['않되→안 돼']);
    expect(fixes('내일 할께요')).toEqual(['할께요→할게요']);
    expect(fixes('감사하였읍니다')).toEqual(['였읍니다→였습니다']);
    expect(fixes('잘 됬다')).toEqual(['됬→됐']);
  });
  it('의존 명사 띄어쓰기: 수·때·것 (받침 ㄹ 확인)', () => {
    expect(fixes('누구나 할수있다')).toEqual(['할수있→할 수 있']);
    expect(fixes('먹을수 없다')).toEqual(['을수 없→을 수 없']);
    expect(fixes('발표할때 주의')).toEqual(['할때→할 때']);
    expect(fixes('중요한것은 연습')).toEqual(['중요한것→중요한 것']);
    // 받침 ㄹ이 아니면 그대로 (예: '하수 있음'은 고치지 않음, '그것'은 그대로)
    expect(fixes('그것은 하수있다')).toEqual([]);
  });
  it('자주 틀리는 낱말', () => {
    expect(fixes('몇일 뒤 금새 오랫만에 역활')).toEqual(['몇일→며칠', '금새→금세', '오랫만→오랜만', '역활→역할']);
    expect(fixes('일일히 꼼꼼이')).toEqual(['일일히→일일이', '꼼꼼이→꼼꼼히']);
    expect(fixes('올바른 문장입니다.')).toEqual([]);
  });
});

describe('문서 검사 (Hunspell 사전)', () => {
  function doc() {
    return produce(createPresentation('맞춤법'), (d) => {
      const t = d.slides[0].objects[0] as TextObject;
      t.text.paragraphs = [{ runs: [{ text: 'This presentaion is is ' }, { text: 'about recieve.', bold: true }] } as Paragraph, { runs: [{ text: '누구나 할수있다. 몇일 뒤에 발표합니다.' }] } as Paragraph];
      d.slides[0].notes = 'Speaker notse 안녕하세요';
    });
  }
  const opts = (includeNotes = true) => ({ speller: (l: SpellLang) => spellers.get(l)!, ignore: new Set<string>(), includeNotes });

  it('철자·반복·한국어 규칙·노트', () => {
    const issues = checkDocument(doc(), opts());
    expect(issues.map((i) => [i.kind, i.word, i.objectId === 'notes' ? 'notes' : 'obj'])).toEqual([
      ['spelling', 'presentaion', 'obj'],
      ['repeat', 'is is', 'obj'],
      ['spelling', 'recieve', 'obj'],
      ['grammar', '할수있', 'obj'],
      ['grammar', '몇일', 'obj'],
      ['spelling', 'notse', 'notes'],
    ]);
    expect(spellers.get('en')!.suggest('presentaion')[0]).toBe('presentation');
    expect(checkDocument(doc(), opts(false)).some((i) => i.objectId === 'notes')).toBe(false);
    // 모두 무시
    expect(checkDocument(doc(), { ...opts(), ignore: new Set(['presentaion', '몇일']) }).map((i) => i.word)).not.toContain('presentaion');
  });

  it('바꾸기: 여러 글자 묶음에 걸쳐도 서식 유지, 노트도', () => {
    let d = doc();
    const issues = checkDocument(d, opts());
    d = produce(d, (x) => {
      for (const i of [...issues].reverse()) applyFix(x, i, i.kind === 'spelling' ? spellers.get(i.objectId === 'notes' ? 'en' : 'en')!.suggest(i.word)[0] : i.suggestions[0]);
    });
    const t = d.slides[0].objects[0] as TextObject;
    expect(t.text.paragraphs[0].runs.map((r) => r.text)).toEqual(['This presentation is ', 'about receive.']);
    expect(t.text.paragraphs[0].runs[1].bold).toBe(true);
    expect(t.text.paragraphs[1].runs[0].text).toBe('누구나 할 수 있다. 며칠 뒤에 발표합니다.');
    expect(d.slides[0].notes).toBe('Speaker notes 안녕하세요');
    expect(checkDocument(d, opts())).toEqual([]);
  });

  it('글자가 바뀐 뒤의 오래된 이슈는 적용하지 않음', () => {
    const d = doc();
    const [first] = checkDocument(d, opts());
    const changed = produce(d, (x) => void ((x.slides[0].objects[0] as TextObject).text.paragraphs[0].runs[0].text = 'Different text'));
    let ok = true;
    produce(changed, (x) => void (ok = applyFix(x, first, 'presentation')));
    expect(ok).toBe(false);
  });

  it('여러 묶음에 걸친 교체', () => {
    const p = { runs: [{ text: 'ab' }, { text: 'cd' }, { text: 'ef' }] } as Paragraph;
    replaceInParagraph(p, 1, 5, 'XY');
    expect(p.runs.map((r) => r.text)).toEqual(['aXY', '', 'f']);
  });
});

describe('조사 받침 맞춤 (문맥)', () => {
  const ko = () => spellers.get('ko')!;
  it('hunspell이 틀렸다고 한 낱말 → 조사만 바꾸면 맞는 말이면 문법 오류', () => {
    const fix = (w: string) => particleAgreement(w, (x) => ko().spell(x))?.fix ?? null;
    expect(['학교을', '책를', '사과은', '책는', '서울으로', '집로', '연필으로', '친구이', '자료과', '계획로'].map(fix)).toEqual(['학교를', '책을', '사과는', '책은', '서울로', '집으로', '연필로', '친구가', '자료와', '계획으로']);
    // 동사 '먹는'·'있는'은 hunspell이 맞다고 하므로 여기까지 오지 않음, 진짜 철자 오류는 조사로 고칠 수 없음
    expect(ko().spell('먹는') && ko().spell('있는')).toBe(true);
    expect(fix('발퓨를')).toBeNull();
    expect(particleAgreement('학교을', (x) => ko().spell(x))!.why).toContain("받침이 없으면 '를'");
  });

  it('숫자·대문자 약어 + 조사: 읽는 소리로 판단', () => {
    const fixes = (s: string) => checkParticles(s).map((i) => `${i.found}→${i.fix}`);
    expect(fixes('2을 더하고 3를 빼고 10를 곱한다')).toEqual(['을→를', '를→을', '를→을']);
    expect(fixes('1으로 나누고 6로 나눈다')).toEqual(['으로→로', '로→으로']);
    expect(fixes('3을, 2를, 10을, 1로, 6으로, 100은, 1000이, 20000을')).toEqual([]);
    expect(fixes('API을 쓰고 SQL으로 묻고 HTML를 고친다')).toEqual(['을→를', '으로→로', '를→을']);
    expect(fixes('API를, SQL로, HTML을, RAM이, CPU가')).toEqual([]);
    // 조사가 아닌 경우: 2가지, 3이다, 버전 2.0은
    expect(fixes('2가지 방법, 정답은 3이다, 2.5는')).toEqual([]);
    expect(numberFinal('1,000')).toEqual(['other', '천']);
    expect(numberFinal('3.7')).toEqual(['rieul', '칠']);
    // R은 '알/아르'로 갈려 판단하지 않음
    expect(fixes('CSR을 CSR를')).toEqual([]);
  });

  it('문서 검사에 함께: 조사는 문법(맞춤법이 아님)으로, 고치면 사라짐', () => {
    const d = produce(createPresentation('조사'), (x) => {
      (x.slides[0].objects[0] as TextObject).text.paragraphs = [{ runs: [{ text: '학교을 지나 2을 더한 API을 씁니다.' }] } as Paragraph];
    });
    const opts = { speller: (l: SpellLang) => spellers.get(l)!, ignore: new Set<string>(), includeNotes: false };
    const issues = checkDocument(d, opts);
    expect(issues.map((i) => [i.kind, i.word, i.suggestions[0]])).toEqual([
      ['grammar', '학교을', '학교를'],
      ['grammar', '을', '를'],
      ['grammar', '을', '를'],
    ]);
    const fixed = produce(d, (x) => {
      for (const i of [...issues].reverse()) applyFix(x, i, i.suggestions[0]);
    });
    expect((fixed.slides[0].objects[0] as TextObject).text.paragraphs[0].runs[0].text).toBe('학교를 지나 2를 더한 API를 씁니다.');
    expect(checkDocument(fixed, opts)).toEqual([]);
  });

  it('AI 고칠 부분 → 지금 글자 기준 이슈 (고친 뒤에는 사라짐)', () => {
    const d = produce(createPresentation('AI'), (x) => {
      (x.slides[0].objects[0] as TextObject).text.paragraphs = [{ runs: [{ text: '내일 회의를 참석합니다.' }] } as Paragraph];
    });
    const [p] = listParagraphs(d, false);
    const edits = [{ key: p.key, find: '회의를 참석', replace: '회의에 참석', reason: '참석하다는 -에' }];
    const [issue] = aiIssues(d, edits, false);
    expect(issue).toMatchObject({ kind: 'ai', start: 3, end: 9, word: '회의를 참석', suggestions: ['회의에 참석'] });
    const fixed = produce(d, (x) => void applyFix(x, issue, issue.suggestions[0]));
    expect((fixed.slides[0].objects[0] as TextObject).text.paragraphs[0].runs[0].text).toBe('내일 회의에 참석합니다.');
    expect(aiIssues(fixed, edits, false)).toEqual([]);
  });
});
