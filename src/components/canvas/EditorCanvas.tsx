import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useEditor, useActiveSlide } from '../../core/store/editorStore';
import { SlideView } from '../../engines/rendering/SlideView';
import { TextEditor } from '../../editors/text/TextEditor';
import * as C from '../../core/commands/commands';
import * as A from '../../core/commands/actions';
import type { ImageObject, ShapeObject, SlideObject, TextObject } from '../../types/model';
import { rectsIntersect, rotatedBounds, rotatePoint, unionRects, type Point, type Rect } from '../../utils/geometry';
import { collectTargets, snapRect, type Guide } from './snapping';
import { SelectionOverlay, type HandleId } from './SelectionOverlay';
import { CanvasContextMenu, type MenuState } from './ContextMenu';
import { setPendingCaretPoint } from '../../editors/text/caret';

const PAD = 48; // 캔버스 여백 (화면 px)

type Drag =
  | { kind: 'move'; start: Point; origin: Map<string, { x: number; y: number }>; started: boolean; duplicate: boolean }
  | { kind: 'resize'; handle: HandleId; start: Point; origin: Map<string, SlideObject>; box: Rect & { rotation: number }; single: boolean }
  | { kind: 'rotate'; center: Point; origin: Map<string, SlideObject>; startAngle: number; groupBox: Rect | null }
  | { kind: 'marquee'; start: Point; current: Point; additive: boolean; base: string[] }
  | { kind: 'draw'; start: Point; current: Point }
  | { kind: 'lineEnd'; id: string; end: 'start' | 'end'; other: Point }
  | { kind: 'crop'; handle: HandleId; start: Point; origin: ImageObject };

export function EditorCanvas() {
  const slide = useActiveSlide();
  const doc = useEditor((s) => s.doc);
  const zoom = useEditor((s) => s.zoom);
  const fitMode = useEditor((s) => s.fitMode);
  const selectedIds = useEditor((s) => s.selectedIds);
  const editingTextId = useEditor((s) => s.editingTextId);
  const insertTool = useEditor((s) => s.insertTool);
  const showGrid = useEditor((s) => s.showGrid);
  const formatPainter = useEditor((s) => s.formatPainter);
  const cropId = useEditor((s) => s.cropId);
  const viewportRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const [guides, setGuides] = useState<Guide[]>([]);
  const [marquee, setMarquee] = useState<Rect | null>(null);
  const [drawRect, setDrawRect] = useState<{ a: Point; b: Point } | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [dropActive, setDropActive] = useState(false);
  const W = doc.size.width;
  const H = doc.size.height;

  /* ───── 창에 맞춤 ───── */
  useLayoutEffect(() => {
    const vp = viewportRef.current;
    if (!vp || !fitMode) return;
    const fit = () => {
      const z = Math.min((vp.clientWidth - PAD * 2) / W, (vp.clientHeight - PAD * 2) / H);
      useEditor.setState({ zoom: Math.max(0.05, Math.round(z * 1000) / 1000) });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(vp);
    return () => ro.disconnect();
  }, [fitMode, W, H]);

  /* ───── Ctrl+휠 확대/축소 ───── */
  useEffect(() => {
    const vp = viewportRef.current!;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const s = useEditor.getState();
      const next = Math.max(0.1, Math.min(4, s.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
      s.set({ zoom: Math.round(next * 100) / 100, fitMode: false });
    };
    vp.addEventListener('wheel', onWheel, { passive: false });
    return () => vp.removeEventListener('wheel', onWheel);
  }, []);

  const toSlide = useCallback(
    (clientX: number, clientY: number): Point => {
      const r = stageRef.current!.getBoundingClientRect();
      return { x: (clientX - r.left) / zoom, y: (clientY - r.top) / zoom };
    },
    [zoom],
  );

  const getObj = (id: string) => slide.objects.find((o) => o.id === id);

  /* ───── 포인터 시작 ───── */
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button === 2) return; // 컨텍스트 메뉴는 onContextMenu에서
    if (e.button !== 0) return;
    setMenu(null);
    const s = useEditor.getState();
    const p = toSlide(e.clientX, e.clientY);

    // 삽입 도구
    if (s.insertTool) {
      e.preventDefault();
      if (s.editingTextId) s.setEditingText(null);
      dragRef.current = { kind: 'draw', start: p, current: p };
      setDrawRect({ a: p, b: p });
      capture(e);
      return;
    }

    const target = (e.target as HTMLElement).closest('[data-obj-id]') as HTMLElement | null;
    const hitId = target?.dataset.objId ?? null;
    const hit = hitId ? getObj(hitId) : undefined;

    if (s.editingTextId && hitId !== s.editingTextId) s.setEditingText(null);
    if (s.cropId && hitId !== s.cropId) s.set({ cropId: null });

    if (hit) {
      if (s.formatPainter) {
        A.applyFormatPainterTo(hit.id);
        return;
      }
      let ids = s.selectedIds;
      if (e.shiftKey || e.ctrlKey || e.metaKey) {
        s.toggleSelect(hit.id);
        ids = useEditor.getState().selectedIds;
        if (!ids.includes(hit.id)) return;
      } else if (!ids.includes(hit.id)) {
        s.select([hit.id]);
        ids = [hit.id];
      }
      const movable = ids.map(getObj).filter((o): o is SlideObject => !!o && !o.locked);
      if (!movable.length) return;
      dragRef.current = {
        kind: 'move',
        start: p,
        origin: new Map(movable.map((o) => [o.id, { x: o.x, y: o.y }])),
        started: false,
        duplicate: false,
      };
      capture(e);
    } else {
      // 빈 영역: 영역 선택
      const additive = e.shiftKey || e.ctrlKey || e.metaKey;
      if (!additive) s.select([]);
      dragRef.current = { kind: 'marquee', start: p, current: p, additive, base: additive ? s.selectedIds : [] };
      capture(e);
    }
  };

  const capture = (e: React.PointerEvent) => {
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  /** 핸들(크기/회전/끝점/자르기)에서 시작 */
  const onHandleDown = (e: React.PointerEvent, handle: HandleId) => {
    e.stopPropagation();
    e.preventDefault();
    const s = useEditor.getState();
    const p = toSlide(e.clientX, e.clientY);
    const objs = s.selectedIds.map(getObj).filter((o): o is SlideObject => !!o && !o.locked);
    if (!objs.length) return;
    const origin = new Map(objs.map((o) => [o.id, o]));
    if (handle === 'start' || handle === 'end') {
      const o = objs[0];
      const ep = C.lineEndpoints(o);
      dragRef.current = { kind: 'lineEnd', id: o.id, end: handle, other: handle === 'start' ? { x: ep.x2, y: ep.y2 } : { x: ep.x1, y: ep.y1 } };
    } else if (s.cropId && objs.length === 1 && objs[0].type === 'image' && handle !== 'rotate') {
      dragRef.current = { kind: 'crop', handle, start: p, origin: objs[0] };
    } else if (handle === 'rotate') {
      const box = objs.length === 1 ? objs[0] : unionRects(objs.map((o) => rotatedBounds(o, o.rotation)))!;
      const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      dragRef.current = {
        kind: 'rotate',
        center,
        origin,
        startAngle: (Math.atan2(p.y - center.y, p.x - center.x) * 180) / Math.PI,
        groupBox: objs.length > 1 ? (box as Rect) : null,
      };
    } else {
      const single = objs.length === 1;
      const box = single ? { ...objs[0] } : { ...unionRects(objs.map((o) => rotatedBounds(o, o.rotation)))!, rotation: 0 };
      dragRef.current = { kind: 'resize', handle, start: p, origin, box: { x: box.x, y: box.y, width: box.width, height: box.height, rotation: single ? objs[0].rotation : 0 }, single };
    }
    s.beginGesture(handle === 'rotate' ? '회전' : s.cropId ? '자르기' : '크기 조정');
    // 포인터 캡처 후 이벤트는 뷰포트의 onPointerMove/onPointerUp으로 버블링된다
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  /* ───── 포인터 이동 ───── */
  const onMove = (e: PointerEvent | React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const s = useEditor.getState();
    const p = toSlide(e.clientX, e.clientY);
    const snapOn = s.snapEnabled && !e.altKey;
    const th = 6 / zoom;

    switch (d.kind) {
      case 'move': {
        let dx = p.x - d.start.x;
        let dy = p.y - d.start.y;
        if (!d.started) {
          if (Math.hypot(dx, dy) * zoom < 3) return;
          d.started = true;
          // Ctrl+드래그: 복제 후 이동 (PowerPoint와 동일)
          if (e.ctrlKey || e.metaKey) {
            s.beginGesture('복제');
            let newIds: string[] = [];
            s.updateGesture((doc) => void (newIds = C.duplicateObjects(doc, slide.id, [...d.origin.keys()], 0)));
            const map = new Map<string, { x: number; y: number }>();
            [...d.origin.values()].forEach((v, i) => map.set(newIds[i], v));
            d.origin = map;
            d.duplicate = true;
            useEditor.setState({ selectedIds: newIds });
          } else s.beginGesture('이동');
        }
        if (e.shiftKey) {
          if (Math.abs(dx) > Math.abs(dy)) dy = 0;
          else dx = 0;
        }
        const ids = [...d.origin.keys()];
        let g: Guide[] = [];
        if (snapOn) {
          const curSlide = useEditor.getState().doc.slides.find((x) => x.id === slide.id)!;
          const moving = ids.map((id) => curSlide.objects.find((o) => o.id === id)!).filter(Boolean);
          const rects = moving.map((o) => {
            const org = d.origin.get(o.id)!;
            return rotatedBounds({ ...o, x: org.x + dx, y: org.y + dy }, o.rotation);
          });
          const box = unionRects(rects);
          if (box) {
            const targets = collectTargets(curSlide.objects, ids, W, H);
            const r = snapRect(box, targets, th, W, H);
            dx += r.dx;
            dy += r.dy;
            g = r.guides;
          }
        }
        setGuides(s.showGuides ? g : []);
        s.updateGesture((doc) =>
          C.updateObjects(doc, slide.id, ids, (o) => {
            const org = d.origin.get(o.id)!;
            o.x = org.x + dx;
            o.y = org.y + dy;
          }),
        );
        break;
      }
      case 'resize': {
        const res = computeResize(d, p, e.shiftKey, th, snapOn ? collectTargets(slide.objects, [...d.origin.keys()], W, H) : null, W, H);
        setGuides(s.showGuides ? res.guides : []);
        s.updateGesture((doc) =>
          C.updateObjects(doc, slide.id, [...d.origin.keys()], (o) => {
            const org = d.origin.get(o.id)!;
            if (d.single) {
              o.x = res.box.x;
              o.y = res.box.y;
              resizeFromOrigin(o, org, res.box.width, res.box.height);
            } else {
              // 여러 개체: 선택 상자 기준 비례 조정
              const sx = res.box.width / d.box.width;
              const sy = res.box.height / d.box.height;
              o.x = res.box.x + (org.x - d.box.x) * sx;
              o.y = res.box.y + (org.y - d.box.y) * sy;
              resizeFromOrigin(o, org, Math.max(1, org.width * sx), Math.max(1, org.height * sy));
            }
          }),
        );
        break;
      }
      case 'rotate': {
        const ang = (Math.atan2(p.y - d.center.y, p.x - d.center.x) * 180) / Math.PI;
        const delta = ang - d.startAngle;
        s.updateGesture((doc) =>
          C.updateObjects(doc, slide.id, [...d.origin.keys()], (o) => {
            const org = d.origin.get(o.id)!;
            let r = org.rotation + delta;
            if (e.shiftKey) r = Math.round(r / 15) * 15;
            else {
              const near = Math.round(r / 90) * 90;
              if (Math.abs(r - near) < 3) r = near;
            }
            r = ((r % 360) + 360) % 360;
            if (d.groupBox) {
              // 여러 개체: 공통 중심 기준 회전
              const c0 = { x: org.x + org.width / 2, y: org.y + org.height / 2 };
              const c1 = rotatePoint(c0, d.center, r - org.rotation);
              o.x = c1.x - org.width / 2;
              o.y = c1.y - org.height / 2;
            }
            o.rotation = Math.round(r * 10) / 10;
          }),
        );
        break;
      }
      case 'marquee': {
        d.current = p;
        const r = normRect(d.start, p);
        setMarquee(r);
        const hits = slide.objects.filter((o) => !o.hidden && !o.locked && containsRect(r, rotatedBounds(o, o.rotation))).map((o) => o.id);
        const ids = d.additive ? [...new Set([...d.base, ...hits])] : hits;
        useEditor.setState({ selectedIds: ids });
        break;
      }
      case 'draw': {
        let q = p;
        if (e.shiftKey) {
          const dx = p.x - d.start.x, dy = p.y - d.start.y;
          if (s.insertTool?.kind === 'line') {
            const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
            const len = Math.hypot(dx, dy);
            q = { x: d.start.x + Math.cos(ang) * len, y: d.start.y + Math.sin(ang) * len };
          } else {
            const m = Math.max(Math.abs(dx), Math.abs(dy));
            q = { x: d.start.x + Math.sign(dx || 1) * m, y: d.start.y + Math.sign(dy || 1) * m };
          }
        }
        d.current = q;
        setDrawRect({ a: d.start, b: q });
        break;
      }
      case 'lineEnd': {
        let q = p;
        if (e.shiftKey) {
          const dx = p.x - d.other.x, dy = p.y - d.other.y;
          const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
          const len = Math.hypot(dx, dy);
          q = { x: d.other.x + Math.cos(ang) * len, y: d.other.y + Math.sin(ang) * len };
        } else if (snapOn) {
          const t = collectTargets(slide.objects, [d.id], W, H);
          const r = snapRect({ x: q.x, y: q.y, width: 0, height: 0 }, t, th, W, H, { x: ['start'], y: ['start'] });
          q = { x: q.x + r.dx, y: q.y + r.dy };
          setGuides(s.showGuides ? r.guides : []);
        }
        s.updateGesture((doc) =>
          C.updateObjects(doc, slide.id, [d.id], (o) => {
            if (d.end === 'start') C.setLineEndpoints(o, q.x, q.y, d.other.x, d.other.y);
            else C.setLineEndpoints(o, d.other.x, d.other.y, q.x, q.y);
          }),
        );
        break;
      }
      case 'crop': {
        const res = computeCrop(d.origin, d.handle, p);
        s.updateGesture((doc) =>
          C.updateObjects(doc, slide.id, [d.origin.id], (o) => {
            if (o.type !== 'image') return;
            Object.assign(o, res);
          }),
        );
        break;
      }
    }
  };

  /* ───── 포인터 끝 ───── */
  const onUp = (e: PointerEvent | React.PointerEvent) => {
    const d = dragRef.current;
    dragRef.current = null;
    setGuides([]);
    const s = useEditor.getState();
    if (!d) return;
    if (d.kind === 'marquee') setMarquee(null);
    if (d.kind === 'draw') {
      setDrawRect(null);
      const tool = s.insertTool;
      s.set({ insertTool: null });
      if (!tool) return;
      const r = normRect(d.start, d.current);
      const clicked = r.width * zoom < 4 && r.height * zoom < 4;
      if (tool.kind === 'text') A.insertTextBoxAt(d.start.x, d.start.y, clicked ? undefined : Math.max(40, r.width));
      else if (tool.kind === 'shape') {
        if (clicked) A.insertShapeAt(tool.shape, d.start.x - 50, d.start.y - 50, 100, 100);
        else A.insertShapeAt(tool.shape, r.x, r.y, Math.max(4, r.width), Math.max(4, r.height));
      } else if (tool.kind === 'line') {
        const end = clicked ? { x: d.start.x + 150, y: d.start.y } : d.current;
        A.insertLine(d.start.x, d.start.y, end.x, end.y, tool.arrow);
      }
      return;
    }
    if (d.kind === 'move' && !d.started) {
      // 클릭만: 이미 선택된 텍스트 개체를 다시 클릭하면 편집 모드 (PowerPoint와 동일)
      return;
    }
    s.endGesture();
    void e;
  };

  /* ───── 더블클릭: 텍스트 편집 ───── */
  const onDoubleClick = (e: React.MouseEvent) => {
    // 포인터 캡처 때문에 e.target이 무대(stage)로 바뀌므로 좌표로 개체를 찾는다
    const target = hitTest(e.clientX, e.clientY);
    const o = target ? getObj(target.dataset.objId!) : undefined;
    if (!o || o.locked) return;
    if (o.type === 'text' || o.type === 'shape') {
      setPendingCaretPoint({ x: e.clientX, y: e.clientY });
      useEditor.getState().setEditingText(o.id);
    } else if (o.type === 'image') {
      useEditor.getState().set({ cropId: o.id, selectedIds: [o.id] });
    } else if (o.type === 'group') {
      useEditor.getState().toast('그룹 안의 개체를 편집하려면 그룹을 해제하세요 (Ctrl+Shift+G).');
    }
  };

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const s = useEditor.getState();
    const target = (e.target as HTMLElement).closest('[data-obj-id]') as HTMLElement | null;
    const id = target?.dataset.objId;
    if (id && !s.selectedIds.includes(id)) s.select([id]);
    if (!id && s.selectedIds.length) s.select([]);
    setMenu({ x: e.clientX, y: e.clientY, onObject: !!id });
  };

  /* ───── 파일 드롭 ───── */
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDropActive(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length) void A.insertImageFiles(files, toSlide(e.clientX, e.clientY));
  };

  const renderEditor = useCallback((obj: TextObject | ShapeObject) => <TextEditor obj={obj} slideId={slide.id} />, [slide.id]);

  const cursor = insertTool ? 'crosshair' : formatPainter ? 'copy' : undefined;
  const stageW = W * zoom;
  const stageH = H * zoom;
  const selectedObjs = slide.objects.filter((o) => selectedIds.includes(o.id));

  return (
    <div
      ref={viewportRef}
      className={`canvas-viewport ${dropActive ? 'is-drop' : ''}`}
      onPointerDown={(e) => {
        // 슬라이드 바깥 회색 영역 클릭 시 선택 해제
        if (e.target === e.currentTarget || (e.target as HTMLElement).classList.contains('canvas-scroller')) {
          const s = useEditor.getState();
          if (s.insertTool) return onPointerDown(e);
          s.setEditingText(null);
          s.select([]);
          setMenu(null);
          dragRef.current = { kind: 'marquee', start: toSlide(e.clientX, e.clientY), current: toSlide(e.clientX, e.clientY), additive: false, base: [] };
          capture(e);
        }
      }}
      onPointerMove={(e) => dragRef.current && onMove(e)}
      onPointerUp={(e) => dragRef.current && onUp(e)}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setDropActive(true);
        }
      }}
      onDragLeave={() => setDropActive(false)}
      onDrop={onDrop}
      style={{ cursor }}
    >
      <div className="canvas-scroller" style={{ width: Math.max(stageW + PAD * 2, 0), height: Math.max(stageH + PAD * 2, 0), padding: PAD }}>
        <div
          ref={stageRef}
          className="stage"
          style={{ width: stageW, height: stageH, cursor }}
          onPointerDown={onPointerDown}
          onDoubleClick={onDoubleClick}
          onContextMenu={onContextMenu}
          data-testid="slide-stage"
        >
          <div className="stage-inner" style={{ width: W, height: H, transform: `scale(${zoom})` }}>
            <SlideView slide={slide} doc={doc} editingTextId={editingTextId} renderEditor={renderEditor} interactive />
            {showGrid && <GridOverlay w={W} h={H} />}
          </div>
          <SelectionOverlay
            objects={selectedObjs}
            zoom={zoom}
            editingTextId={editingTextId}
            cropId={cropId}
            onHandleDown={onHandleDown}
          />
          <svg className="overlay-svg" width={stageW} height={stageH}>
            {guides.map((g, i) =>
              g.axis === 'x' ? (
                <line key={i} x1={g.pos * zoom} x2={g.pos * zoom} y1={g.from * zoom - 8} y2={g.to * zoom + 8} className="guide" />
              ) : (
                <line key={i} y1={g.pos * zoom} y2={g.pos * zoom} x1={g.from * zoom - 8} x2={g.to * zoom + 8} className="guide" />
              ),
            )}
            {marquee && <rect className="marquee" x={marquee.x * zoom} y={marquee.y * zoom} width={marquee.width * zoom} height={marquee.height * zoom} />}
            {drawRect && <DrawPreview a={drawRect.a} b={drawRect.b} zoom={zoom} line={insertTool?.kind === 'line'} />}
          </svg>
        </div>
      </div>
      {menu && <CanvasContextMenu state={menu} onClose={() => setMenu(null)} />}
      {insertTool && <div className="canvas-hint">슬라이드를 클릭하거나 드래그하여 그리세요 · Shift: 비율 고정 · Esc: 취소</div>}
      {formatPainter && <div className="canvas-hint">서식을 적용할 개체를 클릭하세요 · Esc: 취소</div>}
      {cropId && <div className="canvas-hint">자르기 핸들을 드래그하세요 · Enter/Esc: 완료</div>}
    </div>
  );
}

/* ───────────── 계산 도우미 ───────────── */

function hitTest(clientX: number, clientY: number): HTMLElement | null {
  for (const el of document.elementsFromPoint(clientX, clientY)) {
    const hit = (el as HTMLElement).closest?.('[data-obj-id]') as HTMLElement | null;
    if (hit) return hit;
  }
  return null;
}

function normRect(a: Point, b: Point): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) };
}

function containsRect(outer: Rect, inner: Rect) {
  // PowerPoint와 동일: 개체 전체가 영역 안에 들어와야 선택 (빈 영역 클릭과 구분하기 위해 교차도 확인)
  return rectsIntersect(outer, inner) && inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;
}

const HANDLE_DIR: Record<string, [number, number]> = {
  nw: [-1, -1], n: [0, -1], ne: [1, -1], e: [1, 0], se: [1, 1], s: [0, 1], sw: [-1, 1], w: [-1, 0],
};

/** 회전된 사각형의 크기 조정: 반대쪽 모서리를 고정 */
export function resizeBox(box: Rect & { rotation: number }, handle: string, p: Point, keepRatio: boolean, minSize = 4) {
  const [hx, hy] = HANDLE_DIR[handle];
  const c0 = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const lp = rotatePoint(p, c0, -box.rotation);
  const lx = lp.x - c0.x;
  const ly = lp.y - c0.y;
  const ax = -hx * (box.width / 2);
  const ay = -hy * (box.height / 2);
  let nw = hx ? Math.max(minSize, (lx - ax) * hx) : box.width;
  let nh = hy ? Math.max(minSize, (ly - ay) * hy) : box.height;
  if (keepRatio && hx && hy) {
    const s = Math.max(nw / box.width, nh / box.height);
    nw = box.width * s;
    nh = box.height * s;
  }
  const ncx = hx ? ax + (hx * nw) / 2 : 0;
  const ncy = hy ? ay + (hy * nh) / 2 : 0;
  const wc = rotatePoint({ x: c0.x + ncx, y: c0.y + ncy }, c0, box.rotation);
  return { x: wc.x - nw / 2, y: wc.y - nh / 2, width: nw, height: nh };
}

function computeResize(
  d: Extract<Drag, { kind: 'resize' }>,
  p: Point,
  shift: boolean,
  th: number,
  targets: ReturnType<typeof collectTargets> | null,
  W: number,
  H: number,
) {
  const first = [...d.origin.values()][0];
  // 그림은 모서리 핸들에서 기본적으로 비율 유지 (Shift로 해제), 나머지는 Shift로 비율 유지
  const isImage = d.single && first.type === 'image';
  const keep = isImage ? !shift : shift;
  let box = resizeBox(d.box, d.handle, p, keep);
  let guides: Guide[] = [];
  if (targets && d.box.rotation === 0 && !keep) {
    const [hx, hy] = HANDLE_DIR[d.handle];
    const r = snapRect(box, targets, th, W, H, { x: hx < 0 ? ['start'] : hx > 0 ? ['end'] : [], y: hy < 0 ? ['start'] : hy > 0 ? ['end'] : [] });
    if (r.dx || r.dy) {
      const adj = { x: p.x + r.dx, y: p.y + r.dy };
      box = resizeBox(d.box, d.handle, adj, false);
    }
    guides = r.guides;
  }
  return { box, guides };
}

function resizeFromOrigin(o: SlideObject, org: SlideObject, w: number, h: number) {
  if (o.type === 'group' && org.type === 'group') {
    // 원본 자식 기준으로 스케일 (누적 오차 방지)
    o.children = structuredClone(org.children);
    o.width = org.width;
    o.height = org.height;
    C.resizeGroup(o, w, h);
  } else {
    o.width = w;
    o.height = h;
  }
}

function computeCrop(org: ImageObject, handle: string, p: Point): Partial<ImageObject> {
  if (!(handle in HANDLE_DIR)) return {};
  const c = org.crop;
  const iw = org.width / (1 - c.left - c.right);
  const ih = org.height / (1 - c.top - c.bottom);
  const nb = resizeBox({ ...org }, handle, p, false, 8);
  // 원래 중심 기준 로컬 좌표
  const c0 = { x: org.x + org.width / 2, y: org.y + org.height / 2 };
  const ncWorld = { x: nb.x + nb.width / 2, y: nb.y + nb.height / 2 };
  const nc = rotatePoint(ncWorld, c0, -org.rotation);
  const fl = -org.width / 2 - c.left * iw; // 전체 이미지 왼쪽 (로컬)
  const ft = -org.height / 2 - c.top * ih;
  let l = nc.x - c0.x - nb.width / 2;
  let t = nc.y - c0.y - nb.height / 2;
  let r = l + nb.width;
  let b = t + nb.height;
  l = Math.max(fl, l);
  t = Math.max(ft, t);
  r = Math.min(fl + iw, r);
  b = Math.min(ft + ih, b);
  const w = Math.max(8, r - l);
  const h = Math.max(8, b - t);
  const centerLocal = { x: c0.x + l + w / 2, y: c0.y + t + h / 2 };
  const cw = rotatePoint(centerLocal, c0, org.rotation);
  return {
    x: cw.x - w / 2,
    y: cw.y - h / 2,
    width: w,
    height: h,
    crop: {
      left: (l - fl) / iw,
      top: (t - ft) / ih,
      right: (fl + iw - (l + w)) / iw,
      bottom: (ft + ih - (t + h)) / ih,
    },
  };
}

function DrawPreview({ a, b, zoom, line }: { a: Point; b: Point; zoom: number; line: boolean }) {
  if (line) return <line x1={a.x * zoom} y1={a.y * zoom} x2={b.x * zoom} y2={b.y * zoom} className="draw-preview" />;
  const r = normRect(a, b);
  return <rect x={r.x * zoom} y={r.y * zoom} width={r.width * zoom} height={r.height * zoom} className="draw-preview" />;
}

function GridOverlay({ w, h }: { w: number; h: number }) {
  // 1cm 간격 눈금
  const step = 96 / 2.54;
  return (
    <svg className="grid-overlay" width={w} height={h} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      <defs>
        <pattern id="sl-grid" width={step} height={step} patternUnits="userSpaceOnUse">
          <path d={`M ${step} 0 L 0 0 0 ${step}`} fill="none" stroke="rgba(120,120,120,0.35)" strokeWidth={0.6} />
        </pattern>
      </defs>
      <rect width={w} height={h} fill="url(#sl-grid)" />
      <line x1={w / 2} x2={w / 2} y1={0} y2={h} stroke="rgba(120,120,120,0.55)" strokeDasharray="4 4" />
      <line y1={h / 2} y2={h / 2} x1={0} x2={w} stroke="rgba(120,120,120,0.55)" strokeDasharray="4 4" />
    </svg>
  );
}
