#!/usr/bin/env node
/** 테스트용 GLB: 면마다 색이 다른 정육면체 (glTF 2.0 바이너리, POSITION/NORMAL/COLOR_0/인덱스) */
import { writeFileSync } from 'node:fs';
const faces = [
  { n: [1, 0, 0], c: [0.9, 0.2, 0.2], v: [[1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1]] },
  { n: [-1, 0, 0], c: [0.2, 0.7, 0.3], v: [[-1, -1, 1], [-1, 1, 1], [-1, 1, -1], [-1, -1, -1]] },
  { n: [0, 1, 0], c: [0.2, 0.4, 0.9], v: [[-1, 1, -1], [-1, 1, 1], [1, 1, 1], [1, 1, -1]] },
  { n: [0, -1, 0], c: [0.95, 0.8, 0.1], v: [[-1, -1, 1], [-1, -1, -1], [1, -1, -1], [1, -1, 1]] },
  { n: [0, 0, 1], c: [0.6, 0.2, 0.8], v: [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]] },
  { n: [0, 0, -1], c: [0.1, 0.8, 0.8], v: [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]] },
];
const pos = [], nor = [], col = [], idx = [];
faces.forEach((f, i) => {
  for (const v of f.v) pos.push(...v), nor.push(...f.n), col.push(...f.c);
  const b = i * 4;
  idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
});
const f32 = (a) => Buffer.from(new Float32Array(a).buffer);
const bin = Buffer.concat([f32(pos), f32(nor), f32(col), Buffer.from(new Uint16Array(idx).buffer)]);
const pad = (b, ch) => Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4, ch)]);
const binP = pad(bin, 0);
const L = pos.length * 4;
const json = {
  asset: { version: '2.0', generator: 'SlideLab test fixture' },
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes: [{ mesh: 0, name: 'Cube' }],
  meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1, COLOR_0: 2 }, indices: 3, material: 0 }] }],
  materials: [{ pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 0.8 } }],
  buffers: [{ byteLength: binP.length }],
  bufferViews: [
    { buffer: 0, byteOffset: 0, byteLength: L, target: 34962 },
    { buffer: 0, byteOffset: L, byteLength: L, target: 34962 },
    { buffer: 0, byteOffset: 2 * L, byteLength: L, target: 34962 },
    { buffer: 0, byteOffset: 3 * L, byteLength: idx.length * 2, target: 34963 },
  ],
  accessors: [
    { bufferView: 0, componentType: 5126, count: 24, type: 'VEC3', min: [-1, -1, -1], max: [1, 1, 1] },
    { bufferView: 1, componentType: 5126, count: 24, type: 'VEC3' },
    { bufferView: 2, componentType: 5126, count: 24, type: 'VEC3' },
    { bufferView: 3, componentType: 5123, count: idx.length, type: 'SCALAR' },
  ],
};
const jsonB = pad(Buffer.from(JSON.stringify(json)), 0x20);
const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0); // 'glTF'
header.writeUInt32LE(2, 4);
header.writeUInt32LE(12 + 8 + jsonB.length + 8 + binP.length, 8);
const chunk = (type, data) => {
  const h = Buffer.alloc(8);
  h.writeUInt32LE(data.length, 0);
  h.writeUInt32LE(type, 4);
  return Buffer.concat([h, data]);
};
writeFileSync(process.argv[2] ?? 'cube.glb', Buffer.concat([header, chunk(0x4e4f534a, jsonB), chunk(0x004e4942, binP)]));
