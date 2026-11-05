import { useRegisterSW } from 'virtual:pwa-register/react';
import { RefreshCw, X, WifiOff } from 'lucide-react';

/** 서비스 워커 등록 + 새 버전/오프라인 준비 알림 */
export function PwaPrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [offlineReady, setOfflineReady],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisterError(err) {
      console.warn('서비스 워커 등록 실패', err);
    },
  });
  if (!needRefresh && !offlineReady) return null;
  return (
    <div className="pwa-prompt" role="alert">
      {needRefresh ? (
        <>
          <RefreshCw size={16} />
          <span>SlideLab의 새 버전이 있습니다.</span>
          <button type="button" className="btn primary btn-sm" onClick={() => updateServiceWorker(true)}>
            새로 고침
          </button>
        </>
      ) : (
        <>
          <WifiOff size={16} />
          <span>오프라인에서도 사용할 준비가 되었습니다.</span>
        </>
      )}
      <button type="button" className="icon-btn" aria-label="닫기" onClick={() => (setNeedRefresh(false), setOfflineReady(false))}>
        <X size={14} />
      </button>
    </div>
  );
}
