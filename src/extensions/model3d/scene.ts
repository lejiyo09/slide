/**
 * 3D 모델 그리기 (three.js r186, MIT). 브라우저마다 WebGL 문맥 수가 제한(약 16개)되므로
 * 화면 밖 렌더러 하나를 같이 쓰고, 각 개체는 그 결과를 자기 2D 캔버스에 복사한다.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export interface Model3DData {
  /** 회전 (도) */
  rotX: number;
  rotY: number;
  rotZ: number;
  /** 확대 (1 = 개체 상자에 맞춤) */
  zoom: number;
}

/** 원래 모델 단위(glTF는 미터)의 경계 상자 중심과 가장 긴 변 */
export interface ModelBox {
  cx: number;
  cy: number;
  cz: number;
  size: number;
}

export const DEFAULT_VIEW: Model3DData = { rotX: 15, rotY: -30, rotZ: 0, zoom: 1 };

export function viewOf(data: Record<string, unknown>): Model3DData {
  const n = (k: keyof Model3DData) => (typeof data[k] === 'number' && Number.isFinite(data[k]) ? (data[k] as number) : DEFAULT_VIEW[k]);
  return { rotX: n('rotX'), rotY: n('rotY'), rotZ: n('rotZ'), zoom: Math.max(0.1, Math.min(10, n('zoom'))) };
}

/** GLB/glTF(데이터 포함) 바이트 → 장면 (가운데로 옮기고 크기 1로 맞춤) */
export async function parseModel(bytes: ArrayBuffer): Promise<THREE.Object3D> {
  const gltf = await new GLTFLoader().parseAsync(bytes, '');
  const root = gltf.scene;
  const box = new THREE.Box3().setFromObject(root);
  if (box.isEmpty()) throw new Error('3D 모델에 그릴 도형이 없습니다.');
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const s = 1 / Math.max(size.x, size.y, size.z);
  // PPTX 3D(am3d) 내보내기용: 원래 모델 단위의 중심·가장 긴 변
  const bbox: ModelBox = { cx: center.x, cy: center.y, cz: center.z, size: Math.max(size.x, size.y, size.z) };
  const pivot = new THREE.Group();
  root.position.sub(center);
  const holder = new THREE.Group();
  holder.add(root);
  holder.scale.setScalar(s);
  pivot.add(holder);
  // 어느 방향으로 돌려도 상자 안에 들어가도록 경계 구 반지름을 기억
  pivot.userData.radius = new THREE.Box3().setFromObject(pivot).getBoundingSphere(new THREE.Sphere()).radius || 0.87;
  pivot.userData.bbox = bbox;
  return pivot;
}

const cache = new Map<string, Promise<THREE.Object3D>>();
/** 같은 모델은 한 번만 해석 */
export function loadModel(key: string, bytes: () => Promise<ArrayBuffer>): Promise<THREE.Object3D> {
  let p = cache.get(key);
  if (!p) {
    p = bytes().then(parseModel);
    cache.set(key, p);
    p.catch(() => cache.delete(key));
  }
  return p;
}

let shared: { renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera } | null = null;

function getShared() {
  if (!shared) {
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8890a0, 1.6));
    const key = new THREE.DirectionalLight(0xffffff, 1.8);
    key.position.set(2, 3, 4);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 0.6);
    fill.position.set(-3, -1, 2);
    scene.add(fill);
    const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 100);
    shared = { renderer, scene, camera };
  }
  return shared;
}

export const webglAvailable = (() => {
  let v: boolean | null = null;
  return () => {
    if (v === null) {
      try {
        const c = document.createElement('canvas');
        v = !!(c.getContext('webgl2') || c.getContext('webgl'));
      } catch {
        v = false;
      }
    }
    return v;
  };
})();

/** 모델을 w×h(픽셀)로 그려 대상 2D 캔버스에 복사 (대상이 없으면 렌더러 캔버스를 반환) */
export function renderModel(model: THREE.Object3D, view: Model3DData, w: number, h: number, target?: HTMLCanvasElement): HTMLCanvasElement {
  const { renderer, scene, camera } = getShared();
  renderer.setPixelRatio(1);
  renderer.setSize(Math.max(1, Math.round(w)), Math.max(1, Math.round(h)), false);
  camera.aspect = w / h;
  // 경계 구가 상자에 들어가는 거리 (세로·가로 시야각 중 좁은 쪽 기준, 약간 여백)
  const vfov = (camera.fov * Math.PI) / 180;
  const hfov = 2 * Math.atan(Math.tan(vfov / 2) * camera.aspect);
  const r = (model.userData.radius as number | undefined) ?? 0.87;
  camera.position.set(0, 0, (r / Math.sin(Math.min(vfov, hfov) / 2)) * 1.04 / view.zoom);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
  model.rotation.set(THREE.MathUtils.degToRad(view.rotX), THREE.MathUtils.degToRad(view.rotY), THREE.MathUtils.degToRad(view.rotZ), 'YXZ');
  scene.add(model);
  renderer.render(scene, camera);
  scene.remove(model);
  if (!target) return renderer.domElement;
  target.width = Math.max(1, Math.round(w));
  target.height = Math.max(1, Math.round(h));
  const g = target.getContext('2d')!;
  g.clearRect(0, 0, target.width, target.height);
  g.drawImage(renderer.domElement, 0, 0);
  return target;
}

/** 대체 그림 (PNG data URL) */
export function posterOf(model: THREE.Object3D, view: Model3DData, w: number, h: number, scale = 2): string {
  const c = document.createElement('canvas');
  renderModel(model, view, w * scale, h * scale, c);
  return c.toDataURL('image/png');
}
