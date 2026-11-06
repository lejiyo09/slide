import { useEffect } from 'react';
import { useEditor } from '../core/store/editorStore';
import { fontsUsed } from '../services/fonts/docFonts';
import { ensureWebFont, fontStatus, initFonts, useFonts } from '../services/fonts/library';
import { isWebFont } from '../services/fonts/catalog';

/**
 * 문서에 쓰인 글꼴 준비: 사용자 글꼴 등록(앱 시작 시 한 번), 웹 글꼴 내려받기,
 * 이 브라우저에 없는 (알려지지 않은) 글꼴 목록 갱신 → 상태 표시줄에 "글꼴 N개 없음"
 */
export function useDocFonts() {
  const doc = useEditor((s) => s.doc);
  const ready = useFonts((s) => s.ready);
  const webOn = useFonts((s) => s.webFonts);
  const userFonts = useFonts((s) => s.userFonts);
  useEffect(() => {
    void initFonts();
  }, []);
  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(() => {
      const used = [...fontsUsed(doc).keys()];
      for (const f of used) if (isWebFont(f)) void ensureWebFont(f);
      const missing = used.filter((f) => {
        const st = fontStatus(f);
        return st.source === 'unknown' && st.available === false;
      });
      const cur = useFonts.getState().missing;
      if (missing.join('\n') !== cur.join('\n')) useFonts.setState({ missing });
    }, 300);
    return () => clearTimeout(t);
  }, [doc, ready, webOn, userFonts]);
}
