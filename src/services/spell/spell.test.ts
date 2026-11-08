// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { produce } from 'immer';
import { loadModule } from 'hunspell-asm';
import { applyFix, checkDocument, replaceInParagraph, tokenize, type Speller, type SpellLang } from './spell';
import { checkKorean } from './korean';
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
