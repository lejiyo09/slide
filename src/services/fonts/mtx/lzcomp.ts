/*
 * MicroType Express(MTX) LZCOMP 압축 해제 — libeot(src/lzcomp/{bitio,ahuff,lzcomp,liblzcomp}.c)의 복원 부분을 TypeScript로 옮김.
 * Original: Monotype (MTX License) / Copyright (c) 2013 Brennan T. Vincent, libeot, Mozilla Public License 2.0.
 * This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
 * If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
 * 이 파일의 동작(비트 순서, 허프만 트리 초기화, 사전 적재 데이터)은 원본과 같게 유지해야 한다.
 */

export class MtxError extends Error {
  constructor(message: string) {
    super(`MTX: ${message}`);
  }
}

/* ───────────── BITIO (읽기 전용) ───────────── */

class BitIn {
  private index = 0;
  private count = 0;
  private buffer = 0;
  constructor(private bytes: Uint8Array) {}
  bit(): boolean {
    if (this.count-- === 0) {
      if (this.index >= this.bytes.length) throw new MtxError('end of data');
      this.buffer = this.bytes[this.index++];
      this.count = 7;
    }
    this.buffer = (this.buffer << 1) & 0x1ff;
    return (this.buffer & 0x100) !== 0;
  }
  value(bits: number): number {
    let v = 0;
    for (let i = bits - 1; i >= 0; i--) {
      v = v * 2 + (this.bit() ? 1 : 0);
    }
    return v;
  }
}

/* ───────────── AHUFF (적응형 허프만, 복호화) ───────────── */

function bitsUsed(x: number): number {
  let n = 1;
  while (n < 32 && x >= 2 ** n) n++;
  return n;
}

class AHuff {
  private up: Int32Array;
  private left: Int32Array;
  private right: Int32Array;
  private code: Int32Array;
  private weight: Float64Array;
  private symbolIndex: Int32Array;

  constructor(
    private bio: BitIn,
    range: number,
  ) {
    const n = 2 * range;
    this.up = new Int32Array(n);
    this.left = new Int32Array(n);
    this.right = new Int32Array(n);
    this.code = new Int32Array(n);
    this.weight = new Float64Array(n);
    this.symbolIndex = new Int32Array(range);
    let bitCount2 = 0;
    if (range > 256 && range < 512) bitCount2 = bitsUsed(range - 256 - 1) + 1;
    for (let i = 2; i < n; i++) {
      this.up[i] = i >> 1;
      this.weight[i] = 1;
    }
    for (let i = 1; i < range; i++) {
      this.left[i] = 2 * i;
      this.right[i] = 2 * i + 1;
    }
    for (let i = 0; i < range; i++) {
      this.code[i] = -1;
      this.code[range + i] = i;
      this.left[range + i] = -1;
      this.right[range + i] = -1;
      this.symbolIndex[i] = range + i;
    }
    this.initWeight(1);
    if (bitCount2 !== 0) {
      this.updateWeight(this.symbolIndex[256]);
      this.updateWeight(this.symbolIndex[257]);
      for (let i = 0; i < 12; i++) this.updateWeight(this.symbolIndex[range - 3]); // DUP2
      for (let i = 0; i < 6; i++) this.updateWeight(this.symbolIndex[range - 2]); // DUP4
    } else {
      for (let j = 0; j < 2; j++) for (let i = 0; i < range; i++) this.updateWeight(this.symbolIndex[i]);
    }
  }

  private initWeight(a: number): number {
    if (this.code[a] < 0) this.weight[a] = this.initWeight(this.left[a]) + this.initWeight(this.right[a]);
    return this.weight[a];
  }

  private swapNodes(a: number, b: number) {
    const upa = this.up[a];
    const upb = this.up[b];
    // 노드 a와 b의 내용 교환 (up은 자리 기준이라 유지)
    let t = this.left[a];
    this.left[a] = this.left[b];
    this.left[b] = t;
    t = this.right[a];
    this.right[a] = this.right[b];
    this.right[b] = t;
    t = this.code[a];
    this.code[a] = this.code[b];
    this.code[b] = t;
    const w = this.weight[a];
    this.weight[a] = this.weight[b];
    this.weight[b] = w;
    this.up[a] = upa;
    this.up[b] = upb;
    for (const x of [a, b]) {
      const c = this.code[x];
      if (c < 0) {
        this.up[this.left[x]] = x;
        this.up[this.right[x]] = x;
      } else this.symbolIndex[c] = x;
    }
  }

  private updateWeight(a: number) {
    const ROOT = 1;
    for (; a !== ROOT; a = this.up[a]) {
      let weightA = this.weight[a];
      let b = a - 1;
      if (this.weight[b] === weightA) {
        do {
          b--;
        } while (this.weight[b] === weightA);
        b++;
        if (b > ROOT) {
          this.swapNodes(a, b);
          a = b;
        }
      }
      this.weight[a] = ++weightA;
    }
    this.weight[a]++;
  }

  read(): number {
    let a = 1;
    let symbol: number;
    do {
      a = this.bio.bit() ? this.right[a] : this.left[a];
      symbol = this.code[a];
    } while (symbol < 0);
    this.updateWeight(a);
    return symbol;
  }
}

/* ───────────── LZCOMP ───────────── */

const PRELOAD = 2 * 32 * 96 + 4 * 256;
const MAX_2BYTE_DIST = 512;
const LEN_WIDTH = 3;
const DIST_WIDTH = 3;
const BIT_RANGE = LEN_WIDTH - 1;

function unpackBlock(data: Uint8Array, version: number): Uint8Array {
  const bio = new BitIn(data);
  const usingRunLength = version === 1 ? false : bio.bit();
  const distCoder = new AHuff(bio, 1 << DIST_WIDTH);
  const lenCoder = new AHuff(bio, 1 << LEN_WIDTH);
  const outLen = bio.value(24);
  // SetDistRange
  let numDistRanges = 1;
  let distMax = 1 + (1 << (DIST_WIDTH * numDistRanges)) - 1;
  while (distMax < outLen) {
    numDistRanges++;
    distMax = 1 + 2 ** (DIST_WIDTH * numDistRanges) - 1;
  }
  const DUP2 = 256 + (1 << LEN_WIDTH) * numDistRanges;
  const DUP4 = DUP2 + 1;
  const DUP6 = DUP4 + 1;
  const NUM_SYMS = DUP6 + 1;
  const ptr = new Uint8Array(outLen + PRELOAD);
  // 사전 적재 (InitializeModel, decompress)
  let i = 0;
  for (let k = 0; k < 32; k++)
    for (let j = 0; j < 96; j++) {
      ptr[i++] = k;
      ptr[i++] = j;
    }
  for (let j = 0; i < PRELOAD && j < 256; j++) {
    ptr[i++] = j;
    ptr[i++] = j;
    ptr[i++] = j;
    ptr[i++] = j;
  }
  const symCoder = new AHuff(bio, NUM_SYMS);

  let out = new Uint8Array(Math.max(16, outLen));
  let index = 0;
  // 런 길이 복원 상태
  const INITIAL = 100, NORMAL = 0, SEEN_ESCAPE = 1, NEED_BYTE = 2;
  let rlState = INITIAL;
  let rlEscape = 0;
  let rlCount = 0;
  const push = (v: number) => {
    if (index >= out.length) {
      const bigger = new Uint8Array(out.length + (out.length >> 1) + 16);
      bigger.set(out);
      out = bigger;
    }
    out[index++] = v;
  };
  const save = (v: number) => {
    if (!usingRunLength) return push(v);
    if (rlState === NORMAL) {
      if (v === rlEscape) rlState = SEEN_ESCAPE;
      else push(v);
    } else if (rlState === SEEN_ESCAPE) {
      rlCount = v;
      if (rlCount === 0) {
        push(rlEscape);
        rlState = NORMAL;
      } else rlState = NEED_BYTE;
    } else if (rlState === NEED_BYTE) {
      for (let c = rlCount; c > 0; c--) push(v);
      rlState = NORMAL;
    } else {
      rlEscape = v;
      rlState = NORMAL;
    }
  };

  const decodeLength = (symbol: number): [number, number] => {
    const mask = 1 << BIT_RANGE;
    let value = 0;
    let first = true;
    let ranges = 0;
    let done: boolean;
    do {
      let bits: number;
      if (first) {
        bits = symbol - 256;
        first = false;
        ranges = Math.floor(bits / (1 << LEN_WIDTH)) + 1;
        bits = bits % (1 << LEN_WIDTH);
      } else bits = lenCoder.read();
      done = (bits & mask) === 0;
      bits &= ~mask;
      value = (value << BIT_RANGE) | bits;
    } while (!done);
    return [value + 2, ranges];
  };
  const decodeDistance = (ranges: number) => {
    let value = 0;
    for (let r = ranges; r > 0; r--) value = value * (1 << DIST_WIDTH) + distCoder.read();
    return value + 1;
  };

  for (let pos = 0; pos < outLen; ) {
    const symbol = symCoder.read();
    let value: number;
    if (symbol < 256) value = symbol;
    else if (symbol === DUP2) value = ptr[PRELOAD + pos - 2];
    else if (symbol === DUP4) value = ptr[PRELOAD + pos - 4];
    else if (symbol === DUP6) value = ptr[PRELOAD + pos - 6];
    else {
      let [length, ranges] = decodeLength(symbol);
      const distance = decodeDistance(ranges);
      if (distance >= MAX_2BYTE_DIST) length++;
      const start = pos - distance - length + 1;
      for (let j = 0; j < length; j++) {
        const v = ptr[PRELOAD + start + j];
        ptr[PRELOAD + pos++] = v;
        save(v);
      }
      continue;
    }
    ptr[PRELOAD + pos++] = value;
    save(value);
  }
  return out.slice(0, index);
}

/** MTX 압축 데이터 → CTF 스트림 3개 (글꼴 표 / 밀어넣기 데이터 / 명령어) */
export function unpackMtx(data: Uint8Array): [Uint8Array, Uint8Array, Uint8Array] {
  if (data.length < 10) throw new MtxError('header too short');
  const version = data[0];
  const u24 = (o: number) => (data[o] << 16) | (data[o + 1] << 8) | data[o + 2];
  // 헤더: version(1) copyLimit(3) 둘째 블록 위치(3) 셋째 블록 위치(3)
  const offsets = [10, u24(4), u24(7)];
  const sizes = [offsets[1] - offsets[0], offsets[2] - offsets[1], data.length - offsets[2]];
  const out: Uint8Array[] = [];
  for (let k = 0; k < 3; k++) {
    if (sizes[k] < 0 || offsets[k] + sizes[k] > data.length) throw new MtxError('bad block offsets');
    out.push(unpackBlock(data.subarray(offsets[k], offsets[k] + sizes[k]), version));
  }
  return out as [Uint8Array, Uint8Array, Uint8Array];
}
