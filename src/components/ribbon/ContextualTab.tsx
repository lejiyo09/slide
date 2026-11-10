import { Crop, ImageUp, RotateCcw, LayoutTemplate, RotateCw, FlipHorizontal2, FlipVertical2, Group, Ungroup, Spline } from 'lucide-react';
import { MergeShapesMenu } from './MergeShapesMenu';
import { startEditPoints } from '../../core/commands/editPoints';
import { RibbonButton, DropdownButton, RibbonGroup } from '../common/Buttons';
import { ArrangeMenu } from './ArrangeMenu';
import { useEditor, getActiveSlide, useSelectedObjects } from '../../core/store/editorStore';
import * as A from '../../core/commands/actions';
import * as C from '../../core/commands/commands';
import { round } from '../../utils/units';
import { NumberField } from '../properties/fields';

/** 개체를 선택했을 때 나타나는 상황별 탭 (도형 서식 / 그림 서식) */
export function ContextualTab() {
  const objs = useSelectedObjects();
  const cropId = useEditor((s) => s.cropId);
  const editPointsId = useEditor((s) => s.editPointsId);
  if (!objs.length) return null;
  const first = objs[0];
  const isImage = objs.length === 1 && first.type === 'image';
  const setSize = (key: 'width' | 'height', v: number) => {
    const s = useEditor.getState();
    s.commit('크기', (d) =>
      C.updateObjects(d, getActiveSlide().id, s.selectedIds, (o) => {
        const w = key === 'width' ? v : o.width;
        const h = key === 'height' ? v : o.height;
        C.resizeGroup(o, Math.max(1, w), Math.max(1, h));
      }),
    );
  };
  return (
    <>
      {isImage && (
        <RibbonGroup label="조정">
          <RibbonButton size="large" icon={<ImageUp size={26} />} label="그림 바꾸기" title="그림 바꾸기 (크기·위치 유지)" onClick={A.replaceSelectedImage} />
          <RibbonButton
            size="large"
            icon={<RotateCcw size={26} />}
            label="원래대로"
            title="자르기·대칭·투명도·회전 초기화"
            onClick={() =>
              useEditor.getState().commit('그림 원래대로', (d) =>
                C.updateObjects(d, getActiveSlide().id, [first.id], (o) => {
                  if (o.type !== 'image') return;
                  o.crop = { left: 0, top: 0, right: 0, bottom: 0 };
                  o.flipH = o.flipV = false;
                  o.rotation = 0;
                  o.opacity = 1;
                  o.height = o.width * (o.naturalHeight / o.naturalWidth);
                }),
              )
            }
          />
        </RibbonGroup>
      )}
      {!isImage && (
        <RibbonGroup label="도형 편집">
          <MergeShapesMenu objs={objs} />
          <RibbonButton
            size="large"
            icon={<Spline size={26} />}
            label="점 편집"
            title="도형의 꼭짓점과 곡선 조절점을 끌어 모양 바꾸기 (Esc로 끝)"
            disabled={objs.length !== 1 || (first.type !== 'shape' && first.type !== 'text') || !!first.locked}
            active={editPointsId === first.id}
            onClick={() => void startEditPoints(first.id)}
          />
        </RibbonGroup>
      )}
      <RibbonGroup label="정렬">
        <DropdownButton size="large" icon={<LayoutTemplate size={26} />} label="정렬" title="맞춤·순서·그룹">
          {(close) => <ArrangeMenu close={close} />}
        </DropdownButton>
        <div className="rb-col">
          <RibbonButton icon={<RotateCw size={15} />} label="90° 회전" title="오른쪽으로 90도 회전" onClick={() => A.rotateSelection(90)} />
          <RibbonButton icon={<FlipHorizontal2 size={15} />} label="좌우 대칭" title="좌우 대칭" onClick={() => A.flipSelection('h')} />
          <RibbonButton icon={<FlipVertical2 size={15} />} label="상하 대칭" title="상하 대칭" onClick={() => A.flipSelection('v')} />
        </div>
        <div className="rb-col">
          <RibbonButton icon={<Group size={15} />} label="그룹" title="그룹" shortcut="Ctrl+G" disabled={objs.length < 2} onClick={A.group} />
          <RibbonButton icon={<Ungroup size={15} />} label="그룹 해제" title="그룹 해제" shortcut="Ctrl+Shift+G" disabled={!objs.some((o) => o.type === 'group')} onClick={A.ungroup} />
        </div>
      </RibbonGroup>
      <RibbonGroup label="크기">
        {isImage && (
          <RibbonButton
            size="large"
            icon={<Crop size={26} />}
            label="자르기"
            title="자르기 핸들을 드래그해 그림 자르기 (Enter/Esc로 완료)"
            active={cropId === first.id}
            onClick={() => useEditor.getState().set({ cropId: cropId === first.id ? null : first.id })}
          />
        )}
        <div className="rb-col size-fields">
          <NumberField label="높이" unit="cm" value={round((first.height / 96) * 2.54, 2)} step={0.1} onChange={(v) => setSize('height', (v / 2.54) * 96)} />
          <NumberField label="너비" unit="cm" value={round((first.width / 96) * 2.54, 2)} step={0.1} onChange={(v) => setSize('width', (v / 2.54) * 96)} />
        </div>
      </RibbonGroup>
    </>
  );
}
