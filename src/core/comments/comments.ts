/**
 * 메모 (PowerPoint: 검토 › 메모). 순수 명령 + 사용자 이름(파일 › 옵션 › 사용자 이름) 보관.
 */
import type { Presentation, SlideComment } from '../../types/model';
import { newId } from '../../utils/id';

const USER_KEY = 'slidelab.user';

export interface UserInfo {
  name: string;
  initials: string;
}

export function initialsOf(name: string): string {
  const t = name.trim();
  if (!t) return '';
  // 한글 이름은 첫 글자, 영문은 단어 첫 글자
  if (/^[가-힣]/.test(t)) return t.slice(0, Math.min(2, t.length));
  return t
    .split(/\s+/)
    .map((w) => w[0]!.toUpperCase())
    .join('')
    .slice(0, 3);
}

export function getUser(): UserInfo | null {
  try {
    const v = JSON.parse(localStorage.getItem(USER_KEY) ?? 'null') as UserInfo | null;
    return v?.name ? { name: v.name, initials: v.initials || initialsOf(v.name) } : null;
  } catch {
    return null;
  }
}

export function setUser(name: string): UserInfo {
  const u = { name: name.trim(), initials: initialsOf(name) };
  try {
    localStorage.setItem(USER_KEY, JSON.stringify(u));
  } catch {
    /* 저장 불가 */
  }
  return u;
}

const findSlide = (d: Presentation, slideId: string) => d.slides.find((s) => s.id === slideId);

export function addComment(d: Presentation, slideId: string, c: Omit<SlideComment, 'id' | 'replies' | 'created'> & { created?: string }): string {
  const s = findSlide(d, slideId);
  if (!s) return '';
  const id = newId();
  (s.comments ??= []).push({ ...c, id, created: c.created ?? new Date().toISOString(), replies: [] });
  return id;
}

export function replyToComment(d: Presentation, slideId: string, commentId: string, r: { author: string; initials: string; text: string }): string {
  const c = findSlide(d, slideId)?.comments?.find((x) => x.id === commentId);
  if (!c) return '';
  const id = newId();
  c.replies.push({ ...r, id, created: new Date().toISOString() });
  // 답글을 달면 다시 열림 (PowerPoint와 같음)
  c.resolved = false;
  return id;
}

export function editCommentText(d: Presentation, slideId: string, commentId: string, text: string, replyId?: string) {
  const c = findSlide(d, slideId)?.comments?.find((x) => x.id === commentId);
  if (!c) return;
  if (replyId) {
    const r = c.replies.find((x) => x.id === replyId);
    if (r) r.text = text;
  } else c.text = text;
}

export function setResolved(d: Presentation, slideId: string, commentId: string, resolved: boolean) {
  const c = findSlide(d, slideId)?.comments?.find((x) => x.id === commentId);
  if (c) c.resolved = resolved;
}

export function deleteComment(d: Presentation, slideId: string, commentId: string, replyId?: string) {
  const s = findSlide(d, slideId);
  if (!s?.comments) return;
  if (replyId) {
    const c = s.comments.find((x) => x.id === commentId);
    if (c) c.replies = c.replies.filter((r) => r.id !== replyId);
  } else s.comments = s.comments.filter((x) => x.id !== commentId);
  if (!s.comments.length) delete s.comments;
}

/** 모든 메모 삭제: 슬라이드 하나 / 문서 전체 */
export function deleteAllComments(d: Presentation, slideId?: string): number {
  let n = 0;
  for (const s of d.slides) {
    if (slideId && s.id !== slideId) continue;
    n += s.comments?.length ?? 0;
    delete s.comments;
  }
  return n;
}

/** 이전/다음 메모: 문서 순서 (슬라이드 → 메모 순) */
export function adjacentComment(d: Presentation, current: { slideId: string; commentId: string | null }, dir: 1 | -1): { slideId: string; commentId: string } | null {
  const all = d.slides.flatMap((s) => (s.comments ?? []).map((c) => ({ slideId: s.id, commentId: c.id })));
  if (!all.length) return null;
  let i = all.findIndex((x) => x.slideId === current.slideId && x.commentId === current.commentId);
  if (i < 0) {
    // 지금 슬라이드 기준으로 앞/뒤 첫 메모
    const si = d.slides.findIndex((s) => s.id === current.slideId);
    const idxOf = (x: { slideId: string }) => d.slides.findIndex((s) => s.id === x.slideId);
    const cand = dir === 1 ? all.find((x) => idxOf(x) >= si) : [...all].reverse().find((x) => idxOf(x) <= si);
    return cand ?? all[dir === 1 ? 0 : all.length - 1];
  }
  i = (i + dir + all.length) % all.length;
  return all[i];
}

/** "3분 전" 같은 표시 */
export function relativeTime(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return '';
  const s = Math.round((now - t) / 1000);
  if (s < 60) return '방금';
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}일 전`;
  return new Date(t).toLocaleDateString('ko-KR');
}
