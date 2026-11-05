/** 16비트 PCM 모노 WAV 인코더 (RIFF) */
export function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + samples.length * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true); // fmt 크기
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // 모노
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true); // 초당 바이트
  v.setUint16(32, 2, true); // 블록 정렬
  v.setUint16(34, 16, true); // 비트
  str(36, 'data');
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}
