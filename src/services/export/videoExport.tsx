/**
 * 비디오로 내보내기 (PowerPoint: 파일 › 내보내기 › 비디오 만들기).
 * 프레임: SlideRasterizer로 그린 슬라이드(애니메이션 상태 포함). 정지 구간은 같은 그림을 재사용하고,
 * 전환은 앞뒤 슬라이드 그림 두 장을 캔버스에서 합성한다 (transitions.ts와 같은 진행 함수).
 * 인코딩: WebCodecs + mediabunny (MP4: H.264 우선, WebM: VP9 우선). 소리: 내레이션·자동 재생 오디오·동영상 소리를 섞음.
 * 자동 재생 동영상 개체: 슬라이드를 동영상 아래 층(배경 포함)과 위 층(투명)으로 나눠 그려 두고,
 * 프레임마다 그 사이에 동영상의 그 시각 프레임(mediabunny CanvasSink로 해독)을 합성한다.
 * 동영상은 전환이 끝나면 처음부터 재생, 끝나면 마지막 프레임에 멈춤(반복이면 반복), 다음 슬라이드로 넘어가면 멈춤.
 */
import { ALL_FORMATS, AudioBufferSource, BlobSource, BufferTarget, CanvasSink, CanvasSource, getFirstEncodableAudioCodec, getFirstEncodableVideoCodec, Input, Mp4OutputFormat, Output, QUALITY_HIGH, WebMOutputFormat, type AudioCodec, type VideoCodec } from 'mediabunny';
import type { MediaObject, Presentation, Slide, SlideObject } from '../../types/model';
import type { Frame } from '../../engines/animation/effects';
import { ObjectView } from '../../engines/rendering/ObjectView';
import { buildTimeline, frameStates } from '../../engines/animation/timeline';
import { transitionFrame, type TransitionFrame } from '../../engines/transition/transitions';
import { loadAssetUrl } from '../../hooks/useAssetUrl';
import { SlideRasterizer } from './rasterize';
import { planVideo, stateAt, stateKey, videoSize, type VideoPlan, type VideoTimingOptions } from './videoPlan';

export interface VideoExportOptions extends VideoTimingOptions {
  container: 'mp4' | 'webm';
  height: number;
  fps: number;
  onProgress?: (done: number, total: number, phase: string) => void;
  signal?: AbortSignal;
}

export interface VideoResult {
  blob: Blob;
  videoCodec: VideoCodec;
  audioCodec: AudioCodec | null;
  durationMs: number;
  frames: number;
  /** 새로 그린 프레임 수 (나머지는 재사용·합성) */
  rendered: number;
  width: number;
  height: number;
}

const SAMPLE_RATE = 48000;

/* ───────────── 전환 합성 ───────────── */

/** transitions.ts가 만드는 CSS(transform/opacity/clip-path)를 캔버스 그리기로 */
export function drawLayer(g: CanvasRenderingContext2D, img: CanvasImageSource, css: TransitionFrame['next'], w: number, h: number) {
  const opacity = css.opacity === undefined ? 1 : Number(css.opacity);
  if (opacity <= 0) return;
  g.save();
  g.globalAlpha = opacity;
  const clip = typeof css.clipPath === 'string' ? css.clipPath : '';
  let m: RegExpMatchArray | null;
  if ((m = clip.match(/^inset\(([\d.]+)%?\s+([\d.]+)%?\s+([\d.]+)%?\s+([\d.]+)%?\)$/))) {
    const [t, r, b, l] = m.slice(1).map((v) => Number(v) / 100);
    g.beginPath();
    g.rect(l * w, t * h, w * (1 - l - r), h * (1 - t - b));
    g.clip();
  } else if ((m = clip.match(/^circle\(([\d.]+)%/))) {
    // CSS circle(r%): 기준 = sqrt(w²+h²)/sqrt(2)
    const rad = (Number(m[1]) / 100) * Math.sqrt((w * w + h * h) / 2);
    g.beginPath();
    g.arc(w / 2, h / 2, rad, 0, Math.PI * 2);
    g.clip();
  }
  // transform: 가운데 기준 (CSS transform-origin 50% 50%)
  const tf = typeof css.transform === 'string' ? css.transform : '';
  g.translate(w / 2, h / 2);
  for (const part of tf.matchAll(/(\w+)\(([^)]*)\)/g)) {
    const [, fn, args] = part;
    const a = args.split(',').map((s) => s.trim());
    if (fn === 'translate') g.translate((parseFloat(a[0]) / 100) * w, (parseFloat(a[1] ?? '0') / 100) * h);
    else if (fn === 'scale') g.scale(parseFloat(a[0]), parseFloat(a[1] ?? a[0]));
    else if (fn === 'rotate') g.rotate((parseFloat(a[0]) * Math.PI) / 180);
    else if (fn === 'rotateY') g.scale(Math.max(0.001, Math.abs(Math.cos((parseFloat(a[0]) * Math.PI) / 180))), 1); // 원근 뒤집기 근사
  }
  g.drawImage(img, -w / 2, -h / 2, w, h);
  g.restore();
}

export function drawTransition(g: CanvasRenderingContext2D, w: number, h: number, prev: CanvasImageSource | null, next: CanvasImageSource, f: TransitionFrame) {
  g.fillStyle = '#000';
  g.fillRect(0, 0, w, h);
  const layers: [CanvasImageSource | null, TransitionFrame['prev']][] = f.prevOnTop ? [[next, f.next], [prev, f.prev]] : [[prev, f.prev], [next, f.next]];
  for (const [img, css] of layers) if (img) drawLayer(g, img, css, w, h);
  if (f.black) {
    g.fillStyle = `rgba(0,0,0,${Math.min(1, f.black)})`;
    g.fillRect(0, 0, w, h);
  }
}

/* ───────────── 동영상 개체 ───────────── */

/** 비디오에서 재생할 동영상 개체 (자동 재생, 쇼 중 숨기기 아님) */
export function playingVideos(slide: Slide): MediaObject[] {
  return slide.objects.filter((o): o is MediaObject => o.type === 'media' && o.kind === 'video' && !!o.autoPlay && !o.hideInShow);
}

/** 동영상 개체 사이사이의 층: [동영상 아래(배경 포함), 첫 동영상 위, …] — 개체 순서(z) 기준 */
export function videoLayers(slide: Slide, videos: MediaObject[]): SlideObject[][] {
  const ids = new Set(videos.map((v) => v.id));
  const layers: SlideObject[][] = [[]];
  for (const o of slide.objects) {
    if (ids.has(o.id)) layers.push([]);
    else layers[layers.length - 1].push(o);
  }
  return layers;
}

/** 슬라이드 시각(초) → 동영상 시각 (반복이면 되감기, 아니면 끝에서 멈춤) */
export function videoTime(t: number, duration: number, loop: boolean): number {
  if (!(duration > 0)) return 0;
  if (loop) return ((t % duration) + duration) % duration;
  return Math.min(Math.max(0, t), Math.max(0, duration - 1e-3));
}

interface VideoTrackSink {
  sink: CanvasSink;
  duration: number;
}

async function openVideo(doc: Presentation, o: MediaObject, w: number, h: number): Promise<VideoTrackSink | null> {
  try {
    const asset = doc.assets[o.assetId];
    const url = asset ? await loadAssetUrl(asset) : null;
    if (!url) return null;
    const blob = await (await fetch(url)).blob();
    const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
    const track = await input.getPrimaryVideoTrack();
    if (!track || !(await track.canDecode())) return null;
    const sink = new CanvasSink(track, { width: Math.max(2, Math.round(w)), height: Math.max(2, Math.round(h)), fit: 'fill', poolSize: 2 });
    return { sink, duration: await input.computeDuration() };
  } catch {
    return null;
  }
}

/** 동영상 프레임을 개체 자리에 (개체 회전 + 애니메이션 상태: 보임·불투명도·이동·크기·회전) */
function drawVideoFrame(g: CanvasRenderingContext2D, img: CanvasImageSource, o: MediaObject, frame: Frame | undefined, scale: number) {
  if (frame?.visible === false || (frame?.opacity ?? 1) <= 0) return;
  g.save();
  g.globalAlpha = frame?.opacity ?? 1;
  const cx = (o.x + o.width / 2 + (frame?.tx ?? 0)) * scale, cy = (o.y + o.height / 2 + (frame?.ty ?? 0)) * scale;
  g.translate(cx, cy);
  g.rotate((((o.rotation ?? 0) + (frame?.rotate ?? 0)) * Math.PI) / 180);
  g.scale(frame?.sx ?? 1, frame?.sy ?? 1);
  g.drawImage(img, (-o.width / 2) * scale, (-o.height / 2) * scale, o.width * scale, o.height * scale);
  g.restore();
}

/* ───────────── 소리 ───────────── */

function audioObjects(slide: Slide, narrationOnly: boolean): MediaObject[] {
  return slide.objects.filter((o): o is MediaObject => o.type === 'media' && ((o.kind === 'audio' && (o.narration ? true : !narrationOnly && !!o.autoPlay)) || (!narrationOnly && o.kind === 'video' && playingVideos(slide).includes(o))));
}

async function decode(ctx: BaseAudioContext, url: string): Promise<AudioBuffer | null> {
  try {
    const buf = await (await fetch(url)).arrayBuffer();
    return await ctx.decodeAudioData(buf);
  } catch {
    return null;
  }
}

/** 내레이션 길이 (계획 전에 필요) */
async function narrationLengths(doc: Presentation): Promise<{ ms: Record<string, number>; buffers: Map<string, AudioBuffer> }> {
  const ctx = new OfflineAudioContext(1, 1, SAMPLE_RATE);
  const ms: Record<string, number> = {};
  const buffers = new Map<string, AudioBuffer>();
  for (const s of doc.slides) {
    for (const o of audioObjects(s, false)) {
      const asset = doc.assets[o.assetId];
      const url = asset ? await loadAssetUrl(asset) : null;
      const b = url ? await decode(ctx, url) : null;
      if (!b) continue;
      buffers.set(o.id, b);
      if (o.narration) ms[s.id] = Math.max(ms[s.id] ?? 0, b.duration * 1000);
    }
  }
  return { ms, buffers };
}

async function mixAudio(plan: VideoPlan, buffers: Map<string, AudioBuffer>, useNarration: boolean): Promise<AudioBuffer | null> {
  const items: { buf: AudioBuffer; at: number; until: number; loop: boolean }[] = [];
  for (const sp of plan.slides) {
    const at = (sp.start + sp.transitionMs) / 1000;
    const until = (sp.start + sp.transitionMs + sp.holdMs) / 1000;
    for (const o of audioObjects(sp.slide, false)) {
      if (o.narration && !useNarration) continue;
      const b = buffers.get(o.id);
      if (b) items.push({ buf: b, at, until, loop: !!o.loop });
    }
  }
  if (!items.length) return null;
  const length = Math.ceil((plan.totalMs / 1000) * SAMPLE_RATE);
  const ctx = new OfflineAudioContext(2, Math.max(1, length), SAMPLE_RATE);
  for (const it of items) {
    const src = ctx.createBufferSource();
    src.buffer = it.buf;
    src.loop = it.loop;
    src.connect(ctx.destination);
    // 다음 슬라이드로 넘어가면 멈춤 (PowerPoint 기본: 슬라이드 넘기면 소리 정지)
    if (it.loop) {
      src.start(it.at);
      src.stop(it.until);
    } else src.start(it.at, 0, Math.max(0, it.until - it.at));
  }
  return ctx.startRendering();
}

/* ───────────── 내보내기 ───────────── */

export async function exportVideo(doc: Presentation, opts: VideoExportOptions): Promise<VideoResult> {
  if (typeof VideoEncoder === 'undefined') throw new Error('이 브라우저는 비디오 인코딩(WebCodecs)을 지원하지 않습니다. 최신 Chrome·Edge·Safari를 사용하세요.');
  const { width, height } = videoSize(doc, opts.height);
  const narr = await narrationLengths(doc);
  const plan = planVideo(doc, opts, narr.ms);
  if (!plan.slides.length) throw new Error('내보낼 슬라이드가 없습니다 (모든 슬라이드가 숨겨져 있음).');

  const videoCodec = await getFirstEncodableVideoCodec(opts.container === 'mp4' ? ['avc', 'vp9', 'av1'] : ['vp9', 'vp8', 'av1'], { width, height, quality: QUALITY_HIGH, frameRate: opts.fps });
  if (!videoCodec) throw new Error('이 브라우저에서 쓸 수 있는 비디오 코덱이 없습니다.');
  const audio = await mixAudio(plan, narr.buffers, opts.useRecorded);
  const audioCodec = audio ? await getFirstEncodableAudioCodec(opts.container === 'mp4' ? ['aac', 'opus'] : ['opus', 'vorbis'], { numberOfChannels: 2, sampleRate: SAMPLE_RATE }) : null;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext('2d')!;
  const output = new Output({ format: opts.container === 'mp4' ? new Mp4OutputFormat({ fastStart: 'in-memory' }) : new WebMOutputFormat(), target: new BufferTarget() });
  const video = new CanvasSource(canvas, { codec: videoCodec, quality: QUALITY_HIGH, keyFrameInterval: 2 });
  output.addVideoTrack(video, { frameRate: opts.fps });
  let audioSource: AudioBufferSource | null = null;
  if (audio && audioCodec) {
    audioSource = new AudioBufferSource({ codec: audioCodec, quality: QUALITY_HIGH });
    output.addAudioTrack(audioSource);
  }
  await output.start();

  const r = new SlideRasterizer(doc);
  const scale = width / doc.size.width;
  // 동영상 개체 (슬라이드 순서별): 열 수 없거나 해독할 수 없으면 표지 그림 그대로
  const videos = new Map<number, { obj: MediaObject; track: VideoTrackSink }[]>();
  for (let i = 0; i < plan.slides.length; i++) {
    const list: { obj: MediaObject; track: VideoTrackSink }[] = [];
    for (const o of playingVideos(plan.slides[i].slide)) {
      const track = await openVideo(doc, o, o.width * scale, o.height * scale);
      if (track) list.push({ obj: o, track });
    }
    if (list.length) videos.set(i, list);
  }
  const framesOf = (index: number, play: { done: number; t: number | null }) => {
    const slide = plan.slides[index].slide;
    return frameStates(slide.objects, buildTimeline(slide.animations), play, doc.size.width, doc.size.height);
  };
  /** 층 그림: 동영상이 없으면 [슬라이드], 있으면 [동영상 아래(배경 포함), 위 층(투명)…] */
  const renderLayers = async (index: number, play: { done: number; t: number | null }): Promise<{ layers: (HTMLCanvasElement | null)[]; frames: Map<string, Frame> }> => {
    const slide = plan.slides[index].slide;
    const frames = framesOf(index, play);
    const vids = videos.get(index);
    if (!vids) {
      await r.render(slide, frames);
      return { layers: [await r.capture({ scale }, slide.id)], frames };
    }
    const groups = videoLayers(slide, vids.map((v) => v.obj));
    const shown = new Set(vids.map((v) => v.obj.id));
    // 열지 못한 동영상(표지 그림)은 아래 층에 그대로 남도록 위에서 이미 빠져 있음 → 열린 것만 층을 나눔
    const layers: (HTMLCanvasElement | null)[] = [];
    await r.render({ ...slide, objects: groups[0].filter((o) => !shown.has(o.id)) }, frames);
    layers.push(await r.capture({ scale }, slide.id));
    for (const objs of groups.slice(1)) {
      if (!objs.length) {
        layers.push(null);
        continue;
      }
      await r.render(slide, frames, (
        <div style={{ position: 'absolute', left: 0, top: 0, width: doc.size.width, height: doc.size.height, overflow: 'hidden' }}>
          {objs.map((o) => <ObjectView key={o.id} obj={o} assets={doc.assets} theme={doc.theme} mode="thumb" frame={frames.get(o.id)} />)}
        </div>
      ));
      layers.push(await r.capture({ scale, background: null }, slide.id));
    }
    return { layers, frames };
  };
  /** 층 + 동영상 프레임(슬라이드 표시 후 t초) 합성 */
  const compose = async (target: CanvasRenderingContext2D, index: number, st: { layers: (HTMLCanvasElement | null)[]; frames: Map<string, Frame> }, t: number) => {
    const vids = videos.get(index);
    target.drawImage(st.layers[0]!, 0, 0, width, height);
    if (!vids) return;
    for (let k = 0; k < vids.length; k++) {
      const v = vids[k];
      const w = await v.track.sink.getCanvas(videoTime(t, v.track.duration, !!v.obj.loop));
      if (w) drawVideoFrame(target, w.canvas, v.obj, st.frames.get(v.obj.id), scale);
      const over = st.layers[k + 1];
      if (over) target.drawImage(over, 0, 0, width, height);
    }
  };
  // 슬라이드 그림 캐시: 전환에 쓰는 '처음 상태'/'끝 상태' (동영상은 처음/마지막 시각 프레임을 합성해 둠)
  const snapshots = new Map<string, HTMLCanvasElement>();
  const snapshot = async (index: number, which: 'first' | 'last') => {
    const key = `${index}:${which}`;
    let c = snapshots.get(key);
    if (!c) {
      const sp = plan.slides[index];
      const st = await renderLayers(index, which === 'first' ? { done: 0, t: null } : { done: sp.steps.length, t: null });
      c = document.createElement('canvas');
      c.width = width;
      c.height = height;
      await compose(c.getContext('2d')!, index, st, which === 'first' ? 0 : sp.holdMs / 1000);
      snapshots.set(key, c);
      // 오래된 그림은 버림 (메모리)
      for (const k of snapshots.keys()) if (Number(k.split(':')[0]) < index - 1) snapshots.delete(k);
    }
    return c;
  };
  let layerKey = '';
  let layerCache: Awaited<ReturnType<typeof renderLayers>> | null = null;

  const totalFrames = Math.max(1, Math.ceil((plan.totalMs / 1000) * opts.fps));
  let lastKey = '';
  let rendered = 0;
  try {
    for (let f = 0; f < totalFrames; f++) {
      if (opts.signal?.aborted) throw new DOMException('취소했습니다.', 'AbortError');
      const ms = (f * 1000) / opts.fps;
      const st = stateAt(plan, ms);
      if (st.kind === 'transition') {
        const sp = plan.slides[st.index];
        const prev = st.index > 0 ? await snapshot(st.index - 1, 'last') : null;
        const next = await snapshot(st.index, 'first');
        drawTransition(g, width, height, prev, next, transitionFrame(sp.slide.transition!, st.p));
        lastKey = '';
      } else {
        const key = stateKey(st, opts.fps);
        const sp = plan.slides[st.index];
        if (videos.has(st.index)) {
          // 동영상이 있는 슬라이드: 층은 상태가 바뀔 때만 새로 그리고, 동영상 프레임은 매 프레임 합성
          if (key !== layerKey || !layerCache) {
            layerCache = await renderLayers(st.index, st.play);
            layerKey = key;
            rendered++;
          }
          await compose(g, st.index, layerCache, (ms - sp.start - sp.transitionMs) / 1000);
          lastKey = '';
        } else if (key !== lastKey) {
          const img = st.play.t === null && st.play.done === 0 ? await snapshot(st.index, 'first') : st.play.t === null && st.play.done === sp.steps.length ? await snapshot(st.index, 'last') : (await renderLayers(st.index, st.play)).layers[0]!;
          g.drawImage(img, 0, 0, width, height);
          rendered++;
          lastKey = key;
        }
      }
      await video.add(f / opts.fps, 1 / opts.fps);
      opts.onProgress?.(f + 1, totalFrames, '프레임');
    }
    video.close();
    if (audioSource && audio) {
      opts.onProgress?.(totalFrames, totalFrames, '소리');
      await audioSource.add(audio);
      audioSource.close();
    }
    await output.finalize();
  } catch (e) {
    await output.cancel().catch(() => {});
    throw e;
  } finally {
    r.destroy();
  }
  const buffer = (output.target as BufferTarget).buffer!;
  return {
    blob: new Blob([buffer], { type: opts.container === 'mp4' ? 'video/mp4' : 'video/webm' }),
    videoCodec,
    audioCodec: audioSource ? audioCodec : null,
    durationMs: plan.totalMs,
    frames: totalFrames,
    rendered,
    width,
    height,
  };
}
