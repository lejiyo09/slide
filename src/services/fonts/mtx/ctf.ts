/*
 * MTX의 CTF(Compact Table Format) → TrueType 재구성 — libeot(src/ctf/{parseCTF,parseTTF,SFNTContainer}.c, src/util/stream.c)를 옮김.
 * Original: Copyright (c) 2013 Brennan T. Vincent, libeot, Mozilla Public License 2.0.
 * This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0.
 * If a copy of the MPL was not distributed with this file, You can obtain one at https://mozilla.org/MPL/2.0/.
 * 원본처럼 hdmx·VDMX 표는 복원하지 않고 뺀다(선택 표).
 */
import { TRIPLETS } from './triplets';
import { MtxError } from './lzcomp';

const i16 = (v: number) => (v << 16) >> 16;

/** 원본 Stream과 같은 의미의 읽기/쓰기 스트림 (size = 쓴 최대 위치, reserved = 확보한 크기) */
class Stream {
  buf: Uint8Array;
  size: number;
  reserved: number;
  pos = 0;
  bitPos = 0;
  constructor(buf?: Uint8Array, size?: number) {
    this.buf = buf ?? new Uint8Array(0);
    this.size = size ?? this.buf.length;
    this.reserved = this.buf.length;
  }
  reserve(n: number) {
    if (this.reserved >= n) return;
    const b = new Uint8Array(n);
    b.set(this.buf.subarray(0, Math.min(this.buf.length, n)));
    this.buf = b;
    this.reserved = n;
  }
  private need(n: number) {
    if (this.bitPos !== 0) throw new MtxError('off byte boundary');
    if (this.pos + n > this.size) throw new MtxError('not enough data');
  }
  u8() {
    this.need(1);
    return this.buf[this.pos++];
  }
  peekU8() {
    this.need(1);
    return this.buf[this.pos];
  }
  u16() {
    this.need(2);
    const v = (this.buf[this.pos] << 8) | this.buf[this.pos + 1];
    this.pos += 2;
    return v;
  }
  s16() {
    return i16(this.u16());
  }
  u24() {
    this.need(3);
    const v = (this.buf[this.pos] << 16) | (this.buf[this.pos + 1] << 8) | this.buf[this.pos + 2];
    this.pos += 3;
    return v;
  }
  u32() {
    this.need(4);
    const v = ((this.buf[this.pos] << 24) | (this.buf[this.pos + 1] << 16) | (this.buf[this.pos + 2] << 8) | this.buf[this.pos + 3]) >>> 0;
    this.pos += 4;
    return v;
  }
  /** 끝의 1~3바이트는 0으로 채워 32비트로 */
  restAsU32(): number | null {
    if (this.pos >= this.size) return null;
    const left = this.size - this.pos;
    if (left === 1) return (this.u8() << 24) >>> 0;
    if (left === 2) return (this.u16() << 16) >>> 0;
    if (left === 3) return (this.u24() << 8) >>> 0;
    return this.u32();
  }
  private room(n: number) {
    if (this.bitPos !== 0) throw new MtxError('off byte boundary');
    if (this.pos + n > this.reserved) throw new MtxError('out of reserved space');
  }
  private fix() {
    if (this.pos > this.size) this.size = this.pos;
  }
  w8(v: number) {
    this.room(1);
    this.buf[this.pos++] = v & 0xff;
    this.fix();
  }
  w16(v: number) {
    this.room(2);
    this.buf[this.pos++] = (v >> 8) & 0xff;
    this.buf[this.pos++] = v & 0xff;
    this.fix();
  }
  w32(v: number) {
    this.room(4);
    this.buf[this.pos++] = (v >>> 24) & 0xff;
    this.buf[this.pos++] = (v >>> 16) & 0xff;
    this.buf[this.pos++] = (v >>> 8) & 0xff;
    this.buf[this.pos++] = v & 0xff;
    this.fix();
  }
  seek(p: number) {
    if (p > this.size) throw new MtxError('seek past end');
    this.pos = p;
  }
  seekRel(n: number) {
    this.seek(this.pos + n);
  }
  /** 확보한 영역 안에서 이동 (나중에 채울 자리 건너뛰기) */
  seekThroughReserve(p: number) {
    if (p > this.reserved) throw new MtxError('seek past reserve');
    this.pos = p;
  }
  copyTo(out: Stream, n: number) {
    if (this.pos + n > this.size) throw new MtxError('not enough data');
    if (out.pos + n > out.reserved) throw new MtxError('out of reserved space');
    out.buf.set(this.buf.subarray(this.pos, this.pos + n), out.pos);
    out.pos += n;
    this.pos += n;
    out.fix();
  }
  bits(n: number): number {
    const masks = [0x80, 0x40, 0x20, 0x10, 0x08, 0x04, 0x02, 0x01];
    let out = 0;
    for (let i = 0; i < n; i++) {
      if (this.pos >= this.size) throw new MtxError('not enough data');
      if (this.buf[this.pos] & masks[this.bitPos]) out |= 1 << (n - i - 1);
      if (++this.bitPos === 8) {
        this.bitPos = 0;
        this.pos++;
      }
    }
    return out >>> 0;
  }
}

/* ───────────── 값 부호화 ───────────── */

function read255UShort(s: Stream): number {
  const code = s.u8();
  if (code === 253) return s.u16();
  if (code === 255) return 253 + s.u8();
  if (code === 254) return 506 + s.u8();
  return code;
}

function read255Short(s: Stream): number {
  let code = s.u8();
  if (code === 253) return s.s16();
  let sign = 1;
  if (code === 250) {
    sign = -1;
    code = s.u8();
  }
  let v: number;
  if (code === 255) v = 250 + s.u8();
  else if (code === 254) v = 500 + s.u8();
  else v = code;
  return i16(v * sign);
}

function unpackCVT(sIn: Stream, offset: number): Uint8Array {
  sIn.seek(offset);
  const n = sIn.u16();
  const out = new Stream();
  out.reserve(n * 2);
  out.size = 0;
  let last = 0;
  for (let i = 0; i < n; i++) {
    const code = sIn.u8();
    let val: number;
    if (code >= 248) val = 238 * (code - 247) + sIn.u8();
    else if (code >= 239) val = -(238 * (code - 239) + sIn.u8());
    else if (code === 238) val = sIn.s16();
    else val = code;
    last = i16(last + val);
    out.w16(last);
  }
  return out.buf.slice(0, out.size);
}

/* ───────────── 밀어넣기(push) 명령 복원 ───────────── */

function decodePushInstructions(sIn: Stream, out: Stream, pushCount: number) {
  const NPUSHB = 0x40, NPUSHW = 0x41, PUSHB = 0xb0, PUSHW = 0xb8;
  const data = new Int16Array(Math.max(1, pushCount));
  let dataIndex = 0;
  let lastByte = true;
  let lastCount = 0;
  const dump = () => {
    if (lastCount <= 0) return;
    if (lastCount < 8) out.w8((lastByte ? PUSHB : PUSHW) | (lastCount - 1));
    else {
      out.w8(lastByte ? NPUSHB : NPUSHW);
      out.w8(lastCount);
    }
    for (let i = 0; i < lastCount; i++) {
      const v = data[dataIndex - lastCount + i];
      if (lastByte) out.w8(v);
      else out.w16(v);
    }
  };
  const put = (value: number) => {
    const isByte = value >= 0 && value < 256;
    if (isByte !== lastByte || lastCount === 255) {
      dump();
      lastByte = isByte;
      lastCount = 0;
    }
    data[dataIndex++] = value;
    lastCount++;
  };
  let remaining = pushCount;
  while (remaining) {
    const code = sIn.peekU8();
    if (code === 0xfb || code === 0xfc) {
      const need = code === 0xfb ? 3 : 5;
      if (remaining < need || dataIndex < 2) throw new MtxError('corrupt hop code');
      remaining -= need;
      const prev = data[dataIndex - 2];
      sIn.u8();
      put(prev);
      put(read255Short(sIn));
      put(prev);
      if (code === 0xfc) {
        put(read255Short(sIn));
        put(prev);
      }
    } else {
      put(read255Short(sIn));
      remaining--;
    }
  }
  dump();
}

/* ───────────── 글리프 ───────────── */

function makeFlags(x: number, y: number, onCurve: boolean, first: boolean): number {
  let r = onCurve ? 0x01 : 0;
  if (!first && x === 0) r |= 0x10;
  else if (-256 < x && x < 0) r |= 0x02;
  else if (0 <= x && x < 256) r |= 0x02 | 0x10;
  if (!first && y === 0) r |= 0x20;
  else if (-256 < y && y < 0) r |= 0x04;
  else if (0 <= y && y < 256) r |= 0x04 | 0x20;
  return r;
}

function decodeSimpleGlyph(numContours: number, streams: Stream[], out: Stream, calcBox: boolean, box: [number, number, number, number]) {
  if (numContours === 0) return;
  const inp = streams[0];
  out.w16(numContours);
  let boxLoc = 0;
  let [minX, minY, maxX, maxY] = box;
  if (calcBox) {
    boxLoc = out.pos;
    out.seekThroughReserve(out.pos + 8);
    minX = 32767;
    minY = 32767;
    maxX = -32768;
    maxY = -32768;
  } else {
    out.w16(minX);
    out.w16(minY);
    out.w16(maxX);
    out.w16(maxY);
  }
  let total = 0;
  for (let i = 0; i < numContours; i++) {
    if (i === 0) total = 1;
    total += read255UShort(inp);
    out.w16(total - 1);
  }
  const flags = new Uint8Array(total);
  const xs = new Int16Array(total);
  const ys = new Int16Array(total);
  for (let i = 0; i < total; i++) flags[i] = inp.u8();
  let currX = 0;
  let currY = 0;
  for (let i = 0; i < total; i++) {
    const enc = TRIPLETS[flags[i] & 0x7f];
    const more = enc.byteCount - 1;
    if (inp.pos + more > inp.size) throw new MtxError('corrupt glyph');
    const c = new Stream(inp.buf.subarray(inp.pos, inp.pos + more));
    const dx = c.bits(enc.xBits);
    const dy = c.bits(enc.yBits);
    if (c.pos !== c.size || c.bitPos !== 0) throw new MtxError('triplet length');
    inp.seekRel(more);
    xs[i] = i16(enc.xSign * (dx + enc.deltaX));
    ys[i] = i16(enc.ySign * (dy + enc.deltaY));
    currX = (currX + xs[i]) >>> 0;
    currY = (currY + ys[i]) >>> 0;
    minX = Math.min(minX, i16(currX));
    maxX = Math.max(maxX, i16(currX));
    minY = Math.min(minY, i16(currY));
    maxY = Math.max(maxY, i16(currY));
  }
  const codeSizeLoc = out.pos;
  out.seekThroughReserve(out.pos + 2);
  decodePushInstructions(streams[1], out, read255UShort(inp));
  streams[2].copyTo(out, read255UShort(inp));
  const unpacked = out.pos - (codeSizeLoc + 2);
  for (let i = 0; i < total; i++) out.w8(makeFlags(xs[i], ys[i], !(flags[i] & 0x80), i === 0));
  for (const arr of [xs, ys])
    for (let i = 0; i < total; i++) {
      let v = arr[i];
      if (i === 0 || v !== 0) {
        if (-256 < v && v < 0) v = -v;
        if (0 <= v && v < 256) out.w8(v);
        else out.w16(v);
      }
    }
  const cur = out.pos;
  out.seekThroughReserve(codeSizeLoc);
  out.w16(unpacked);
  out.seekThroughReserve(cur);
  if (calcBox) {
    const end = out.pos;
    out.seekThroughReserve(boxLoc);
    out.w16(minX);
    out.w16(minY);
    out.w16(maxX);
    out.w16(maxY);
    out.seekThroughReserve(end);
  }
}

function decodeCompositeGlyph(streams: Stream[], out: Stream) {
  const ARGS_WORDS = 0x1, HAVE_SCALE = 0x8, MORE = 0x20, XY_SCALE = 0x40, TWO_BY_TWO = 0x80, HAVE_INSTR = 0x100;
  const inp = streams[0];
  out.w16(-1);
  for (let k = 0; k < 4; k++) out.w16(inp.s16());
  let flags: number;
  do {
    flags = inp.u16();
    out.w16(flags);
    inp.copyTo(out, 2);
    inp.copyTo(out, flags & ARGS_WORDS ? 4 : 2);
    inp.copyTo(out, flags & TWO_BY_TWO ? 8 : flags & XY_SCALE ? 4 : flags & HAVE_SCALE ? 2 : 0);
  } while (flags & MORE);
  if (flags & HAVE_INSTR) {
    const loc = out.pos;
    out.seekThroughReserve(out.pos + 2);
    decodePushInstructions(streams[1], out, read255UShort(inp));
    streams[2].copyTo(out, read255UShort(inp));
    const n = out.pos - (loc + 2);
    if (n > 0) {
      const cur = out.pos;
      out.seekThroughReserve(loc);
      out.w16(n);
      out.seekThroughReserve(cur);
    }
  }
}

function decodeGlyph(streams: Stream[], out: Stream) {
  const inp = streams[0];
  let n = inp.s16();
  if (n < 0) return decodeCompositeGlyph(streams, out);
  let box: [number, number, number, number] = [0, 0, 0, 0];
  let calc = true;
  if (n === 0x7fff) {
    n = inp.s16();
    box = [inp.s16(), inp.s16(), inp.s16(), inp.s16()];
    calc = false;
  }
  decodeSimpleGlyph(n, streams, out, calc, box);
}

/* ───────────── 표 조립 ───────────── */

interface Table {
  tag: string;
  offset: number;
  size: number;
  data?: Uint8Array;
}

/** CTF 스트림 3개 → TrueType 글꼴 바이트 */
export function ctfToTtf(ctfs: [Uint8Array, Uint8Array, Uint8Array]): Uint8Array {
  const streams = ctfs.map((b) => new Stream(b));
  const s0 = streams[0];
  s0.u32(); // scalarType
  const numTables = s0.u16();
  s0.seekRel(6);
  const tables: Table[] = [];
  for (let i = 0; i < numTables; i++) {
    const tag = String.fromCharCode(s0.u8(), s0.u8(), s0.u8(), s0.u8());
    if (tag === 'hdmx' || tag === 'VDMX') {
      s0.seekRel(12);
      continue;
    }
    s0.seekRel(4); // checksum
    tables.push({ tag, offset: s0.u32(), size: s0.u32() });
  }
  const find = (t: string) => tables.find((x) => x.tag === t);
  for (const t of tables) {
    if (t.tag === 'loca' || t.tag === 'glyf') continue;
    if (t.tag === 'cvt ') {
      t.data = unpackCVT(s0, t.offset);
      continue;
    }
    s0.seek(t.offset);
    if (t.offset + t.size > s0.size) throw new MtxError(`table ${t.tag} out of range`);
    t.data = s0.buf.slice(t.offset, t.offset + t.size);
    if (t.tag === 'head') {
      if (t.data.length < 12) throw new MtxError('malformed head');
      t.data.fill(0, 8, 12);
    }
  }
  let glyf = find('glyf');
  let loca = find('loca');
  if (glyf && !loca) tables.push((loca = { tag: 'loca', offset: 0, size: 0 }));
  const maxp = find('maxp');
  const head = find('head');
  if (!maxp?.data || !head?.data || !find('hmtx')) throw new MtxError('missing maxp/head/hmtx');
  const hd = new DataView(head.data.buffer, head.data.byteOffset, head.data.byteLength);
  if (head.data.length < 52) throw new MtxError('short head');
  const indexToLocFormat = hd.getInt16(50);
  const md = new DataView(maxp.data.buffer, maxp.data.byteOffset, maxp.data.byteLength);
  const numGlyphs = md.getUint16(4);
  const v1 = md.getUint32(0) === 0x00010000;
  const maxPoints = v1 ? md.getUint16(6) : 0;
  const maxContours = v1 ? md.getUint16(8) : 0;
  const maxSizeOfInstructions = v1 ? md.getUint16(26) : 0;

  if (glyf && loca) {
    s0.seek(glyf.offset);
    streams[1].seek(0);
    streams[2].seek(0);
    const maxSimple = 10 + 2 * maxContours + 2 + maxSizeOfInstructions + maxPoints * 5;
    const maxCompound = 26 + maxSizeOfInstructions;
    const out = new Stream();
    out.reserve(Math.max(64, numGlyphs * Math.max(maxSimple, maxCompound)));
    out.size = 0;
    const short = !indexToLocFormat;
    const lo = new Stream();
    lo.reserve((short ? 2 : 4) * (numGlyphs + 1));
    lo.size = 0;
    if (short) lo.w16(0);
    else lo.w32(0);
    for (let g = 0; g < numGlyphs; g++) {
      decodeGlyph(streams, out);
      if (out.pos % 2) out.w8(0);
      if (short) lo.w16(out.pos / 2);
      else lo.w32(out.pos);
    }
    glyf.data = out.buf.slice(0, out.size);
    loca.data = lo.buf.slice(0, lo.size);
    glyf = glyf;
  }
  return dumpTables(tables);
}

function dumpTables(tables: Table[]): Uint8Array {
  const n = tables.length;
  let size = 12 + 16 * n;
  for (const t of tables) size += Math.ceil((t.data?.length ?? 0) / 4) * 4;
  const out = new Stream(new Uint8Array(size), 0);
  let maxpw = 1;
  let lg = 0;
  for (let k = n; k > 1; k = Math.floor(k / 2)) {
    maxpw *= 2;
    lg++;
  }
  out.w32(0x00010000);
  out.w16(n);
  out.w16(maxpw * 16);
  out.w16(lg);
  out.w16(n * 16 - maxpw * 16);
  const dirOffset = out.pos;
  out.seekThroughReserve(out.pos + 16 * n);
  let total = 0;
  let headOffset = -1;
  const sums: number[] = [];
  const offsets: number[] = [];
  for (const t of tables) {
    const data = t.data ?? new Uint8Array(0);
    if (t.tag === 'head') headOffset = out.pos;
    offsets.push(out.pos);
    const s = new Stream(data);
    let sum = 0;
    for (let v = s.restAsU32(); v !== null; v = s.restAsU32()) {
      sum = (sum + v) >>> 0;
      out.w32(v);
    }
    sums.push(sum);
    total = (total + sum) >>> 0;
  }
  const end = out.pos;
  out.seekThroughReserve(dirOffset);
  tables.forEach((t, i) => {
    for (let k = 0; k < 4; k++) out.w8(t.tag.charCodeAt(k));
    out.w32(sums[i]);
    out.w32(offsets[i]);
    out.w32(t.data?.length ?? 0);
  });
  const header = new Stream(out.buf.subarray(0, out.pos));
  for (let v = header.restAsU32(); v !== null; v = header.restAsU32()) total = (total + v) >>> 0;
  if (headOffset < 0) throw new MtxError('no head');
  out.seekThroughReserve(headOffset + 8);
  out.w32((0xb1b0afba - total) >>> 0);
  return out.buf.slice(0, Math.max(end, out.size));
}
