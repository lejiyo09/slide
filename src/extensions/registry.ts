/**
 * 확장 개체 인터페이스. 새 개체 종류(3D 모델 등)를 편집기 본체를 고치지 않고 붙인다.
 *
 * 확장이 제공하는 것:
 *  - View: 편집 화면·슬라이드 쇼에서 그리는 React 구성 요소 (지연 로딩 가능). 썸네일·인쇄·PDF·비디오는 대체 그림(posterId)
 *  - insert: 리본 [삽입]에서 새 개체 만들기 (파일 선택 등)
 *  - Properties: 서식 창에 붙는 설정 (선택)
 *  - refreshPoster: 설정이 바뀐 뒤 대체 그림 다시 만들기 (선택)
 *  - describe: 접근성·비교·보고서에 쓰는 설명
 * PPTX: 가져온 원본 XML이 있으면(바꾸지 않았으면) 그대로, 아니면 대체 그림으로 저장한다 (pptxExport).
 */
import type { ComponentType, LazyExoticComponent, ReactNode } from 'react';
import type { Asset, ExtensionObject, Presentation } from '../types/model';

export interface ExtensionViewProps {
  obj: ExtensionObject;
  assets: Record<string, Asset>;
  mode: 'edit' | 'show';
  /** 그리는 중(불러오기 전)에 보여 줄 것 */
  fallback: ReactNode;
}

export interface ExtensionInsertResult {
  obj: ExtensionObject;
  /** 문서에 추가할 자산 */
  assets: Asset[];
}

export interface ObjectExtension {
  kind: string;
  /** 사용자에게 보이는 이름 (예: '3D 모델') */
  name: string;
  View: ComponentType<ExtensionViewProps> | LazyExoticComponent<ComponentType<ExtensionViewProps>>;
  Properties?: ComponentType<{ obj: ExtensionObject }> | LazyExoticComponent<ComponentType<{ obj: ExtensionObject }>>;
  insert?: (doc: Presentation) => Promise<ExtensionInsertResult | null>;
  refreshPoster?: (obj: ExtensionObject, doc: Presentation) => Promise<string | null>;
  describe?: (obj: ExtensionObject) => string;
  /** 리본 단추 */
  ribbon?: { label: string; title: string; icon: ComponentType<{ size?: number }> };
}

const registry = new Map<string, ObjectExtension>();

export function registerExtension(ext: ObjectExtension) {
  registry.set(ext.kind, ext);
}

export const getExtension = (kind: string) => registry.get(kind);
export const listExtensions = () => [...registry.values()];
