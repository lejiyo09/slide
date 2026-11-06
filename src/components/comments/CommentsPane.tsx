/**
 * 메모 창 (PowerPoint: 검토 › 메모 표시 / 새 메모). 현재 슬라이드의 메모 스레드, 답글, 해결, 편집, 삭제.
 */
import { useEffect, useRef, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, MessageSquarePlus, Pencil, RotateCcw, Trash2, X } from 'lucide-react';
import { getActiveSlide, useEditor } from '../../core/store/editorStore';
import * as CM from '../../core/comments/comments';
import type { SlideComment } from '../../types/model';

const stop = (e: React.KeyboardEvent) => e.stopPropagation();

function useUser() {
  const [user, set] = useState(CM.getUser());
  return [user, (name: string) => set(CM.setUser(name))] as const;
}

export function goToComment(dir: 1 | -1) {
  const st = useEditor.getState();
  const next = CM.adjacentComment(st.doc, { slideId: st.activeSlideId, commentId: st.activeCommentId }, dir);
  if (!next) return st.toast('메모가 없습니다.', 'info');
  st.set({ commentsPane: true, activeCommentId: next.commentId });
  if (next.slideId !== st.activeSlideId) st.setActiveSlide(next.slideId);
}

/** 새 메모 시작: 선택한 개체의 오른쪽 위, 없으면 슬라이드 왼쪽 위 */
export function startNewComment() {
  const st = useEditor.getState();
  if (st.slideshow || st.masterView) return;
  st.set({ commentsPane: true, activeCommentId: 'new' });
}

export function CommentsPane() {
  const doc = useEditor((s) => s.doc);
  const slideId = useEditor((s) => s.activeSlideId);
  const active = useEditor((s) => s.activeCommentId);
  const [user, setUser] = useUser();
  const [nameDraft, setNameDraft] = useState('');
  const [showResolved, setShowResolved] = useState(true);
  const slide = doc.slides.find((s) => s.id === slideId);
  const comments = slide?.comments ?? [];
  const visible = comments.filter((c) => showResolved || !c.resolved);
  const close = () => useEditor.getState().set({ commentsPane: false, activeCommentId: null });

  return (
    <aside className="properties comments-pane" aria-label="메모" data-comments-pane="">
      <div className="pp-head">
        <span>메모</span>
        <span className="sb-spacer" />
        <button type="button" className="icon-btn" title="이전 메모" onClick={() => goToComment(-1)}>
          <ChevronLeft size={16} />
        </button>
        <button type="button" className="icon-btn" title="다음 메모" onClick={() => goToComment(1)}>
          <ChevronRight size={16} />
        </button>
        <button type="button" className="icon-btn" title="닫기" onClick={close}>
          <X size={16} />
        </button>
      </div>
      <div className="cm-body">
        {!user ? (
          <form
            className="cm-user"
            onSubmit={(e) => {
              e.preventDefault();
              if (nameDraft.trim()) setUser(nameDraft);
            }}
          >
            <label>
              메모에 표시할 이름 (파일 › 옵션의 사용자 이름)
              <input value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} onKeyDown={stop} placeholder="예: 김민지" data-cm-username="" autoFocus />
            </label>
            <button type="submit" className="btn btn-sm primary" disabled={!nameDraft.trim()}>
              확인
            </button>
          </form>
        ) : (
          <>
            <div className="cm-toolbar">
              <button type="button" className="btn btn-sm" onClick={startNewComment} data-cm-new="">
                <MessageSquarePlus size={14} /> 새 메모
              </button>
              <label className="fm-check">
                <input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} /> 해결된 메모 표시
              </label>
            </div>
            {active === 'new' && slide && <NewComment slideId={slide.id} user={user} />}
            {!visible.length && active !== 'new' && <p className="muted cm-empty">이 슬라이드에는 메모가 없습니다.</p>}
            {visible.map((c) => (
              <CommentCard key={c.id} slideId={slideId} c={c} user={user} active={c.id === active} />
            ))}
          </>
        )}
      </div>
    </aside>
  );
}

function Avatar({ initials, name }: { initials: string; name: string }) {
  // 이름별로 같은 색
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return (
    <span className="cm-avatar" style={{ background: `hsl(${h} 55% 45%)` }} aria-hidden>
      {initials || name.slice(0, 1)}
    </span>
  );
}

function NewComment({ slideId, user }: { slideId: string; user: CM.UserInfo }) {
  const [text, setText] = useState('');
  const post = () => {
    if (!text.trim()) return;
    const st = useEditor.getState();
    const sel = getActiveSlide().objects.find((o) => st.selectedIds.includes(o.id));
    const pos = sel ? { x: Math.min(st.doc.size.width - 24, sel.x + sel.width), y: Math.max(0, sel.y), objectId: sel.id } : { x: 10, y: 10 };
    let id = '';
    st.commit('메모 삽입', (d) => void (id = CM.addComment(d, slideId, { author: user.name, initials: user.initials, text: text.trim(), ...pos })));
    st.set({ activeCommentId: id });
  };
  return (
    <div className="cm-card is-active" data-cm-draft="">
      <div className="cm-head">
        <Avatar initials={user.initials} name={user.name} />
        <b>{user.name}</b>
      </div>
      <textarea
        autoFocus
        rows={3}
        value={text}
        placeholder="메모 입력… (Ctrl+Enter: 게시)"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          stop(e);
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) post();
          if (e.key === 'Escape') useEditor.getState().set({ activeCommentId: null });
        }}
        data-cm-input=""
      />
      <div className="cm-actions">
        <button type="button" className="btn btn-sm primary" disabled={!text.trim()} onClick={post} data-cm-post="">
          게시
        </button>
        <button type="button" className="btn btn-sm" onClick={() => useEditor.getState().set({ activeCommentId: null })}>
          취소
        </button>
      </div>
    </div>
  );
}

function CommentCard({ slideId, c, user, active }: { slideId: string; c: SlideComment; user: CM.UserInfo; active: boolean }) {
  const [reply, setReply] = useState('');
  const [editing, setEditing] = useState<{ replyId?: string; text: string } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [active]);
  const st = () => useEditor.getState();
  const commitEdit = () => {
    if (!editing) return;
    const t = editing.text.trim();
    if (t) st().commit('메모 편집', (d) => CM.editCommentText(d, slideId, c.id, t, editing.replyId));
    setEditing(null);
  };
  const sendReply = () => {
    if (!reply.trim()) return;
    st().commit('메모 답글', (d) => void CM.replyToComment(d, slideId, c.id, { author: user.name, initials: user.initials, text: reply.trim() }));
    setReply('');
  };
  const entry = (who: { author: string; initials: string; created: string; text: string }, replyId?: string) => (
    <div className="cm-entry" key={replyId ?? 'root'}>
      <div className="cm-head">
        <Avatar initials={who.initials} name={who.author} />
        <b>{who.author}</b>
        <span className="muted" title={new Date(who.created).toLocaleString('ko-KR')}>
          {CM.relativeTime(who.created)}
        </span>
        <span className="sb-spacer" />
        {who.author === user.name && (
          <button type="button" className="icon-btn" title="편집" onClick={() => setEditing({ replyId, text: who.text })}>
            <Pencil size={12} />
          </button>
        )}
        <button type="button" className="icon-btn" title={replyId ? '답글 삭제' : '스레드 삭제'} onClick={() => st().commit(replyId ? '답글 삭제' : '메모 삭제', (d) => CM.deleteComment(d, slideId, c.id, replyId))} data-cm-delete={replyId ? 'reply' : 'thread'}>
          <Trash2 size={12} />
        </button>
      </div>
      {editing && editing.replyId === replyId ? (
        <textarea autoFocus rows={2} value={editing.text} onChange={(e) => setEditing({ ...editing, text: e.target.value })} onBlur={commitEdit} onKeyDown={(e) => (stop(e), e.key === 'Enter' && (e.ctrlKey || e.metaKey) && commitEdit(), e.key === 'Escape' && setEditing(null))} />
      ) : (
        <p className="cm-text">{who.text}</p>
      )}
    </div>
  );
  return (
    <div ref={ref} className={`cm-card ${active ? 'is-active' : ''} ${c.resolved ? 'is-resolved' : ''}`} onClick={() => !active && st().set({ activeCommentId: c.id })} data-cm-id={c.id}>
      {entry(c)}
      {c.replies.map((r) => entry(r, r.id))}
      {c.resolved ? (
        <div className="cm-actions">
          <span className="muted">
            <Check size={12} /> 해결됨
          </span>
          <button type="button" className="btn btn-sm" onClick={() => st().commit('메모 다시 열기', (d) => CM.setResolved(d, slideId, c.id, false))} data-cm-reopen="">
            <RotateCcw size={12} /> 다시 열기
          </button>
        </div>
      ) : (
        <>
          <textarea rows={1} value={reply} placeholder="답글…" onChange={(e) => setReply(e.target.value)} onKeyDown={(e) => (stop(e), e.key === 'Enter' && (e.ctrlKey || e.metaKey) && sendReply())} data-cm-reply="" />
          <div className="cm-actions">
            <button type="button" className="btn btn-sm" disabled={!reply.trim()} onClick={sendReply} data-cm-reply-send="">
              답글
            </button>
            <button type="button" className="btn btn-sm" onClick={() => st().commit('메모 해결', (d) => CM.setResolved(d, slideId, c.id, true))} data-cm-resolve="">
              <Check size={12} /> 해결
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/** 편집 화면의 메모 표시 (말풍선) */
export function CommentMarkers({ zoom }: { zoom: number }) {
  const slide = useEditor((s) => s.doc.slides.find((x) => x.id === s.activeSlideId));
  const show = useEditor((s) => s.showComments && !s.masterView);
  const active = useEditor((s) => s.activeCommentId);
  if (!show || !slide?.comments?.length) return null;
  return (
    <>
      {slide.comments.map((c, i) => (
        <button
          key={c.id}
          type="button"
          className={`cm-marker ${c.id === active ? 'is-active' : ''} ${c.resolved ? 'is-resolved' : ''}`}
          style={{ left: c.x * zoom, top: c.y * zoom }}
          title={`${c.author}: ${c.text}`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            useEditor.getState().set({ commentsPane: true, activeCommentId: c.id });
          }}
          data-cm-marker={c.id}
        >
          {c.initials || i + 1}
        </button>
      ))}
    </>
  );
}
