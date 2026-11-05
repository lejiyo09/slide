import {
  AlignStartVertical, AlignCenterVertical, AlignEndVertical, AlignStartHorizontal, AlignCenterHorizontal, AlignEndHorizontal,
  AlignHorizontalSpaceAround, AlignVerticalSpaceAround, BringToFront, SendToBack, ArrowUp, ArrowDown, Group, Ungroup,
  RotateCw, RotateCcw, FlipHorizontal2, FlipVertical2,
} from 'lucide-react';
import { MenuItem, MenuSeparator } from '../common/Buttons';
import * as A from '../../core/commands/actions';
import { useEditor, getSelectedObjects } from '../../core/store/editorStore';

export function ArrangeMenu({ close }: { close: () => void }) {
  const n = useEditor((s) => s.selectedIds.length);
  const hasGroup = getSelectedObjects().some((o) => o.type === 'group');
  const run = (fn: () => void) => () => (fn(), close());
  return (
    <div className="menu arrange-menu">
      <div className="menu-title">개체 순서</div>
      <MenuItem icon={<BringToFront size={15} />} label="맨 앞으로 가져오기" shortcut="Ctrl+Shift+]" onClick={run(() => A.reorder('front'))} />
      <MenuItem icon={<SendToBack size={15} />} label="맨 뒤로 보내기" shortcut="Ctrl+Shift+[" onClick={run(() => A.reorder('back'))} />
      <MenuItem icon={<ArrowUp size={15} />} label="앞으로 가져오기" onClick={run(() => A.reorder('forward'))} />
      <MenuItem icon={<ArrowDown size={15} />} label="뒤로 보내기" onClick={run(() => A.reorder('backward'))} />
      <MenuSeparator />
      <div className="menu-title">개체 그룹화</div>
      <MenuItem icon={<Group size={15} />} label="그룹" shortcut="Ctrl+G" disabled={n < 2} onClick={run(A.group)} />
      <MenuItem icon={<Ungroup size={15} />} label="그룹 해제" shortcut="Ctrl+Shift+G" disabled={!hasGroup} onClick={run(A.ungroup)} />
      <MenuSeparator />
      <div className="menu-title">맞춤 {n === 1 ? '(슬라이드 기준)' : '(선택한 개체 기준)'}</div>
      <MenuItem icon={<AlignStartVertical size={15} />} label="왼쪽 맞춤" onClick={run(() => A.align('left'))} />
      <MenuItem icon={<AlignCenterVertical size={15} />} label="가운데 맞춤" onClick={run(() => A.align('center'))} />
      <MenuItem icon={<AlignEndVertical size={15} />} label="오른쪽 맞춤" onClick={run(() => A.align('right'))} />
      <MenuItem icon={<AlignStartHorizontal size={15} />} label="위쪽 맞춤" onClick={run(() => A.align('top'))} />
      <MenuItem icon={<AlignCenterHorizontal size={15} />} label="중간 맞춤" onClick={run(() => A.align('middle'))} />
      <MenuItem icon={<AlignEndHorizontal size={15} />} label="아래쪽 맞춤" onClick={run(() => A.align('bottom'))} />
      <MenuItem icon={<AlignHorizontalSpaceAround size={15} />} label="가로 간격을 동일하게" disabled={n < 3} onClick={run(() => A.align('distributeH'))} />
      <MenuItem icon={<AlignVerticalSpaceAround size={15} />} label="세로 간격을 동일하게" disabled={n < 3} onClick={run(() => A.align('distributeV'))} />
      <MenuSeparator />
      <div className="menu-title">회전</div>
      <MenuItem icon={<RotateCw size={15} />} label="오른쪽으로 90도 회전" onClick={run(() => A.rotateSelection(90))} />
      <MenuItem icon={<RotateCcw size={15} />} label="왼쪽으로 90도 회전" onClick={run(() => A.rotateSelection(-90))} />
      <MenuItem icon={<FlipHorizontal2 size={15} />} label="좌우 대칭" onClick={run(() => A.flipSelection('h'))} />
      <MenuItem icon={<FlipVertical2 size={15} />} label="상하 대칭" onClick={run(() => A.flipSelection('v'))} />
    </div>
  );
}
