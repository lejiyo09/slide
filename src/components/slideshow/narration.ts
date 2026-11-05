/**
 * 내레이션 녹음: 마이크 스트림 하나로 슬라이드마다 MediaRecorder 조각을 만든다.
 * 녹음이 끝나면 PowerPoint에서도 재생되는 WAV(16비트 PCM, 모노)로 변환한다.
 */
import { encodeWav } from '../../engines/show/wav';

export class NarrationRecorder {
  private stream: MediaStream | null = null;
  private rec: MediaRecorder | null = null;
  private segSlide: string | null = null;
  private done: Promise<void> = Promise.resolve();
  private paused = false;
  readonly clips: Record<string, Blob> = {};

  /** 마이크 사용 권한을 얻고 첫 슬라이드 녹음 시작. 실패하면 false (시간만 기록) */
  async start(slideId: string): Promise<boolean> {
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') return false;
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.begin(slideId);
      return true;
    } catch {
      this.stream = null;
      return false;
    }
  }

  /** 이 슬라이드의 녹음 조각 시작 (이미 이 슬라이드면 그대로) */
  begin(slideId: string) {
    if (!this.stream || this.segSlide === slideId) return;
    this.cut(this.segSlide ?? undefined);
    const rec = new MediaRecorder(this.stream);
    const chunks: Blob[] = [];
    this.segSlide = slideId;
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const finished = new Promise<void>((resolve) => {
      rec.onstop = () => {
        // 같은 슬라이드를 다시 녹음하면 마지막 녹음으로 바꿈
        if (chunks.length) this.clips[slideId] = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
        resolve();
      };
    });
    this.done = Promise.all([this.done, finished]).then(() => {});
    rec.start();
    if (this.paused) rec.pause();
    this.rec = rec;
  }

  /** 현재 조각 끝내기 (슬라이드를 떠날 때) */
  cut(slideId?: string) {
    if (!this.rec || (slideId && slideId !== this.segSlide)) return;
    if (this.rec.state !== 'inactive') this.rec.stop();
    this.rec = null;
    this.segSlide = null;
  }

  pause() {
    this.paused = true;
    if (this.rec?.state === 'recording') this.rec.pause();
  }
  resume() {
    this.paused = false;
    if (this.rec?.state === 'paused') this.rec.resume();
  }
  setMuted(muted: boolean) {
    this.stream?.getAudioTracks().forEach((t) => (t.enabled = !muted));
  }

  /** 녹음을 끝내고 슬라이드별 WAV 반환 */
  async stop(): Promise<Record<string, Blob>> {
    this.cut();
    await this.done;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    const out: Record<string, Blob> = {};
    for (const [id, blob] of Object.entries(this.clips)) out[id] = await toWav(blob);
    return out;
  }
}

/** 브라우저 녹음 형식(webm/ogg) → WAV. 해석에 실패하면 원본 유지 */
async function toWav(blob: Blob): Promise<Blob> {
  try {
    const Ctx = window.OfflineAudioContext;
    if (!Ctx) return blob;
    const data = await blob.arrayBuffer();
    const decoded = await new AudioContext().decodeAudioData(data);
    const rate = 22050;
    const len = Math.max(1, Math.ceil(decoded.duration * rate));
    const off = new Ctx(1, len, rate);
    const src = off.createBufferSource();
    src.buffer = decoded;
    src.connect(off.destination);
    src.start();
    const rendered = await off.startRendering();
    return encodeWav(rendered.getChannelData(0), rate);
  } catch {
    return blob;
  }
}
