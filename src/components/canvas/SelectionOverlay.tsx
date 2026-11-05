import type { SlideObject } from '../../types/model';
import { lineEndpoints } from '../../core/commands/commands';
import { rotatedBounds, unionRects } from '../../utils/geometry';
import { RotateCw, Lock } from 'lucide-react';

export type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'rotate' | 'start' | 'end';

const HANDLES: { id: HandleId; x: number; y: number; cursor: string }[] = [
  { id: 'nw', x: 0, y: 0, cursor: 'nwse-resize' },
  { id: 'n', x: 0.5, y: 0, cursor: 'ns-resize' },
  { id: 'ne', x: 1, y: 0, cursor: 'nesw-resize' },
  { id: 'e', x: 1, y: 0.5, cursor: 'ew-resize' },
  { id: 'se', x: 1, y: 1, cursor: 'nwse-resize' },
  { id: 's', x: 0.5, y: 1, cursor: 'ns-resize' },
  { id: 'sw', x: 0, y: 1, cursor: 'nesw-resize' },
  { id: 'w', x: 0, y: 0.5, cursor: 'ew-resize' },
];

/** 회전 각도에 맞춰 커서 방향 보정 */
function rotatedCursor(base: string, rotation: number) {
  const order = ['ns-resize', 'nesw-resize', 'ew-resize', 'nwse-resize'];
  const i = order.indexOf(base);
  if (i < 0) return base;
  const steps = Math.round(rotation / 45);
  return order[(((i + steps) % 4) + 4) % 4];
}

interface Props {
  objects: SlideObject[];
  zoom: number;
  editingTextId: string | null;
  cropId: string | null;
  onHandleDown: (e: React.PointerEvent, h: HandleId) => void;
}

export function SelectionOverlay({ objects, zoom, editingTextId, cropId, onHandleDown }: Props) {
  if (!objects.length) return null;
  const single = objects.length === 1 ? objects[0] : null;

  // 선 개체: 끝점 핸들
  if (single && single.type === 'line') {
    const ep = lineEndpoints(single);
    return (
      <div className="sel-layer">
        {(['start', 'end'] as const).map((h) => {
          const x = (h === 'start' ? ep.x1 : ep.x2) * zoom;
          const y = (h === 'start' ? ep.y1 : ep.y2) * zoom;
          return (
            <div
              key={h}
              className="handle handle-end"
              style={{ left: x, top: y, cursor: single.locked ? 'default' : 'move' }}
              onPointerDown={(e) => !single.locked && onHandleDown(e, h)}
              data-handle={h}
            />
          );
        })}
      </div>
    );
  }

  if (single) {
    const o = single;
    const cropping = cropId === o.id && o.type === 'image';
    const frame = { left: o.x * zoom, top: o.y * zoom, width: o.width * zoom, height: o.height * zoom };
    return (
      <div className="sel-layer">
        {cropping && o.type === 'image' && <CropGhost obj={o} zoom={zoom} />}
        <div
          className={`sel-frame ${editingTextId === o.id ? 'is-editing' : ''} ${cropping ? 'is-cropping' : ''}`}
          style={{ ...frame, transform: o.rotation ? `rotate(${o.rotation}deg)` : undefined }}
        >
          {o.locked ? (
            <span className="lock-badge" title="잠긴 개체">
              <Lock size={11} />
            </span>
          ) : (
            <>
              {HANDLES.map((h) => (
                <div
                  key={h.id}
                  className={`handle ${cropping ? 'handle-crop' : ''} handle-${h.id}`}
                  data-handle={h.id}
                  style={{ left: `${h.x * 100}%`, top: `${h.y * 100}%`, cursor: rotatedCursor(h.cursor, o.rotation) }}
                  onPointerDown={(e) => onHandleDown(e, h.id)}
                />
              ))}
              {!cropping && (
                <div className="handle-rotate" data-handle="rotate" title="회전 (Shift: 15° 단위)" onPointerDown={(e) => onHandleDown(e, 'rotate')}>
                  <RotateCw size={11} />
                </div>
              )}
            </>
          )}
        </div>
      </div>
    );
  }

  // 여러 개체
  const box = unionRects(objects.map((o) => rotatedBounds(o, o.rotation)))!;
  const anyLocked = objects.some((o) => o.locked);
  return (
    <div className="sel-layer">
      {objects.map((o) => (
        <div
          key={o.id}
          className="sel-frame sel-frame-sub"
          style={{ left: o.x * zoom, top: o.y * zoom, width: o.width * zoom, height: o.height * zoom, transform: o.rotation ? `rotate(${o.rotation}deg)` : undefined }}
        />
      ))}
      <div className="sel-frame sel-frame-group" style={{ left: box.x * zoom, top: box.y * zoom, width: box.width * zoom, height: box.height * zoom }}>
        {!anyLocked && (
          <>
            {HANDLES.map((h) => (
              <div key={h.id} className={`handle handle-${h.id}`} data-handle={h.id} style={{ left: `${h.x * 100}%`, top: `${h.y * 100}%`, cursor: h.cursor }} onPointerDown={(e) => onHandleDown(e, h.id)} />
            ))}
            <div className="handle-rotate" data-handle="rotate" title="회전" onPointerDown={(e) => onHandleDown(e, 'rotate')}>
              <RotateCw size={11} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** 자르기 모드: 잘려 나간 영역까지 포함한 원본 이미지 윤곽 */
function CropGhost({ obj, zoom }: { obj: Extract<SlideObject, { type: 'image' }>; zoom: number }) {
  const c = obj.crop;
  const iw = obj.width / (1 - c.left - c.right);
  const ih = obj.height / (1 - c.top - c.bottom);
  return (
    <div
      className="crop-frame-outer"
      style={{
        left: obj.x * zoom,
        top: obj.y * zoom,
        width: obj.width * zoom,
        height: obj.height * zoom,
        transform: obj.rotation ? `rotate(${obj.rotation}deg)` : undefined,
      }}
    >
      <div className="crop-ghost" style={{ left: -c.left * iw * zoom, top: -c.top * ih * zoom, width: iw * zoom, height: ih * zoom }} />
    </div>
  );
}
