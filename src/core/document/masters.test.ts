import { beforeEach, describe, expect, it } from 'vitest';
import { useEditor } from '../store/editorStore';
import { createPresentation } from './factory';
import { addSlide, updateObjects } from '../commands/commands';
import { ensureMasters } from './masters';
import { resolveColor } from '../../utils/themeColor';
import type { Presentation, TextObject } from '../../types/model';

const st = () => useEditor.getState();
const ph = (objs: { type: string; ph?: { type: string } }[], type: string) => objs.find((o) => o.type === 'text' && o.ph?.type === type) as TextObject;

describe('슬라이드 마스터 / 레이아웃', () => {
  beforeEach(() => st().loadDocument(createPresentation()));

  it('새 문서: 마스터 + 기본 레이아웃 6개, 슬라이드는 레이아웃 개체 틀로 생성', () => {
    const d = st().doc;
    expect(d.master?.kind).toBe('master');
    expect(d.layoutOrder).toHaveLength(6);
    const t = ph(d.slides[0].objects, 'ctrTitle');
    expect(t.placeholder).toBe('제목을 입력하십시오');
    expect(t.text.paragraphs[0].runs[0]).toMatchObject({ text: '', fontFamily: '@heading', color: '@dark1' });
    st().commit('add', (doc) => void addSlide(doc, doc.slides[0].id));
    const s2 = st().doc.slides[1];
    expect(s2.layout).toBe('titleContent'); // 제목 슬라이드 다음은 '제목 및 내용'
    expect(ph(s2.objects, 'body').text.paragraphs[0].bullet).toBe('bullet');
  });

  it('레이아웃 개체 틀 서식·위치 변경 → 바꾸지 않은 슬라이드에만 전파', () => {
    st().commit('add', (doc) => {
      addSlide(doc, doc.slides[0].id, 'titleContent');
      addSlide(doc, doc.slides[1].id, 'titleContent');
    });
    const b = st().doc.slides[2];
    // b의 제목은 사용자가 직접 옮기고 크기를 바꿈
    st().commit('custom', (doc) =>
      updateObjects(doc, b.id, [ph(b.objects, 'title').id], (o) => {
        o.x += 100;
        if (o.type === 'text') o.text.paragraphs[0].runs[0].fontSize = 60;
      }),
    );
    const layoutTitle = ph(st().doc.layouts!.titleContent.objects, 'title');
    st().commit('layout edit', (doc) =>
      updateObjects(doc, 'titleContent', [layoutTitle.id], (o) => {
        o.y += 50;
        if (o.type === 'text') {
          o.text.paragraphs[0].runs[0].fontSize = 32;
          o.text.paragraphs[0].runs[0].color = '@accent2';
        }
      }),
    );
    const doc = st().doc;
    const ta = ph(doc.slides[1].objects, 'title');
    const tb = ph(doc.slides[2].objects, 'title');
    expect(ta.y).toBeCloseTo(layoutTitle.y + 50);
    expect(ta.text.paragraphs[0].runs[0]).toMatchObject({ fontSize: 32, color: '@accent2' });
    expect(tb.y).toBeCloseTo(ph(b.objects, 'title').y); // 직접 옮긴 슬라이드는 위치 유지
    expect(tb.text.paragraphs[0].runs[0].fontSize).toBe(60); // 직접 바꾼 크기 유지
    expect(tb.text.paragraphs[0].runs[0].color).toBe('@accent2'); // 바꾸지 않은 색은 전파
    // 한 번의 실행 취소로 레이아웃 + 슬라이드 모두 복원
    st().undo();
    expect(ph(st().doc.slides[1].objects, 'title').text.paragraphs[0].runs[0].fontSize).toBe(40);
  });

  it('마스터 제목 서식 → 레이아웃 → 슬라이드로 연쇄 전파', () => {
    st().commit('add', (doc) => void addSlide(doc, doc.slides[0].id, 'titleOnly'));
    const mt = ph(st().doc.master!.objects, 'title');
    st().commit('master', (doc) =>
      updateObjects(doc, 'master', [mt.id], (o) => {
        if (o.type === 'text') o.text.paragraphs[0].runs[0].fontFamily = 'Georgia';
      }),
    );
    const doc = st().doc;
    expect(ph(doc.layouts!.titleOnly.objects, 'title').text.paragraphs[0].runs[0].fontFamily).toBe('Georgia');
    expect(ph(doc.layouts!.title.objects, 'ctrTitle').text.paragraphs[0].runs[0].fontFamily).toBe('Georgia'); // 가운데 제목도 서식 상속
    expect(ph(doc.slides[1].objects, 'title').text.paragraphs[0].runs[0].fontFamily).toBe('Georgia');
    expect(ph(doc.slides[0].objects, 'ctrTitle').text.paragraphs[0].runs[0].fontFamily).toBe('Georgia');
  });

  it('테마 변경 시 토큰 색이 새 테마 색으로 해석', () => {
    const d = st().doc;
    const t = ph(d.slides[0].objects, 'ctrTitle');
    const theme2 = { ...d.theme, colors: { ...d.theme.colors, dark1: '#112233' } };
    expect(resolveColor(t.text.paragraphs[0].runs[0].color, d.theme)).toBe(d.theme.colors.dark1);
    expect(resolveColor(t.text.paragraphs[0].runs[0].color, theme2)).toBe('#112233');
    expect(resolveColor('@accent1~0.5', { ...d.theme, colors: { ...d.theme.colors, accent1: '#808080' } })).toBe('#404040');
    expect(resolveColor('@accent1^0.5', { ...d.theme, colors: { ...d.theme.colors, accent1: '#000000' } })).toBe('#808080');
  });

  it('이전 버전 문서 마이그레이션: 마스터/레이아웃 생성, 개체 틀 연결', () => {
    const old = JSON.parse(JSON.stringify(createPresentation())) as Presentation;
    delete old.master;
    delete old.layouts;
    delete old.layoutOrder;
    old.slides[0].layout = 'titleContent';
    old.slides[0].objects = [{ ...old.slides[0].objects[0], name: '제목', ph: undefined } as TextObject];
    ensureMasters(old);
    expect(old.master).toBeTruthy();
    expect((old.layouts as Record<string, unknown> | undefined)?.titleContent).toBeTruthy();
    expect((old.slides[0].objects[0] as TextObject).ph?.type).toBe('title');
  });
});

describe('테마 적용', () => {
  beforeEach(() => st().loadDocument(createPresentation()));
  it('고정 색(현재 테마와 같은 값)은 토큰으로 바뀌어 새 테마를 따름, 다른 색은 유지', async () => {
    const { applyFullTheme, applyThemeColors } = await import('../commands/masterActions');
    const { THEMES } = await import('../../themes/themes');
    const accent = st().doc.theme.colors.accent1;
    st().commit('legacy', (d) => {
      const o = d.slides[0].objects[0];
      if (o.type === 'text') {
        o.text.paragraphs[0].runs[0].color = accent; // 가져온 문서처럼 hex
        o.text.paragraphs[0].runs.push({ text: 'x', color: '#123456' });
      }
    });
    applyFullTheme(THEMES.find((t) => t.id === 'forest')!);
    const runs = (st().doc.slides[0].objects[0] as TextObject).text.paragraphs[0].runs;
    expect(runs[0].color).toBe('@accent1');
    expect(runs[1].color).toBe('#123456');
    expect(resolveColor(runs[0].color, st().doc.theme)).toBe(THEMES.find((t) => t.id === 'forest')!.colors.accent1);
    applyThemeColors({ ...st().doc.theme.colors, accent1: '#ABCDEF' });
    expect(resolveColor((st().doc.slides[0].objects[0] as TextObject).text.paragraphs[0].runs[0].color, st().doc.theme)).toBe('#ABCDEF');
  });
});
