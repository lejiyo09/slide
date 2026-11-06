/** AI 설정: 제공자(기본 엔진 / Claude / OpenAI 호환), API 키, 모델, 이미지 생성 */
import { useState } from 'react';
import { Dialog } from '../dialogs/Dialog';
import { useEditor } from '../../core/store/editorStore';
import { DEFAULT_AI_SETTINGS, getProvider, loadAIKeys, loadAISettings, saveAISettings, type AIKeys, type AISettings } from '../../services/ai/settings';
import { AI_PROXY_URL, CLAUDE_MODELS, DEFAULT_GPT_IMAGE_MODEL, GPT_MODEL_SUGGESTIONS, type Effort } from '../../services/ai/models';
import { AIError } from '../../services/ai/types';

export function AISettingsDialog({ onClose }: { onClose: (saved: boolean) => void }) {
  const [s, setS] = useState<AISettings>(loadAISettings);
  const [keys, setKeys] = useState<AIKeys>(loadAIKeys);
  const [test, setTest] = useState<{ busy: boolean; msg?: string; ok?: boolean }>({ busy: false });
  const patch = (p: Partial<AISettings>) => setS((x) => ({ ...x, ...p }));
  const save = () => {
    saveAISettings(s, keys);
    useEditor.getState().toast('AI 설정을 저장했습니다.', 'success');
    onClose(true);
  };
  const runTest = async () => {
    setTest({ busy: true });
    try {
      const p = await getProvider(s, keys);
      const r = await p.summarize('SlideLab은 웹에서 동작하는 프레젠테이션 편집기입니다. API 키 없이도 기본 기능을 쓸 수 있습니다.', 'short');
      setTest({ busy: false, ok: true, msg: `연결됨 (${p.name}): ${r.split('\n')[0]}` });
    } catch (e) {
      setTest({ busy: false, ok: false, msg: e instanceof AIError || e instanceof Error ? e.message : String(e) });
    }
  };
  return (
    <Dialog title="AI 설정" onClose={() => onClose(false)} onOk={save} okLabel="저장">
      <div className="ai-settings">
        <fieldset>
          <legend>텍스트 AI 제공자</legend>
          <label>
            <input type="radio" name="aip" checked={s.provider === 'offline'} onChange={() => patch({ provider: 'offline' })} />
            <span>
              <b>기본 엔진</b> — 키 없이 이 브라우저에서 동작 (규칙 기반: 문서 구조 분석·추출 요약·템플릿 대본. 새 내용을 지어내지는 못함)
            </span>
          </label>
          <label>
            <input type="radio" name="aip" checked={s.provider === 'gpt-proxy'} onChange={() => patch({ provider: 'gpt-proxy' })} />
            <span>
              <b>GPT — 사이트 중계 서버</b> {AI_PROXY_URL ? '(이 사이트에 설정됨, 권장)' : ''} — OpenAI 키는 중계 서버에만 있고 브라우저에는 접근 코드만 입력
            </span>
          </label>
          <label>
            <input type="radio" name="aip" checked={s.provider === 'openai'} onChange={() => patch({ provider: 'openai' })} />
            <span>
              <b>OpenAI (GPT)</b> — 본인의 OpenAI API 키로 GPT를 직접 호출. 이미지 생성(gpt-image)에도 같은 키 사용 가능
            </span>
          </label>
          <label>
            <input type="radio" name="aip" checked={s.provider === 'anthropic'} onChange={() => patch({ provider: 'anthropic' })} />
            <span>
              <b>Claude (Anthropic)</b> — 본인의 API 키로 Claude API를 직접 호출. PDF 문서도 읽음
            </span>
          </label>
          <label>
            <input type="radio" name="aip" checked={s.provider === 'openai-compatible'} onChange={() => patch({ provider: 'openai-compatible' })} />
            <span>
              <b>OpenAI 호환 엔드포인트</b> — /chat/completions 형식을 제공하는 서버 (예: 로컬 Ollama, LM Studio)
            </span>
          </label>
        </fieldset>
        {s.provider === 'gpt-proxy' && (
          <fieldset>
            <legend>GPT — 사이트 중계 서버</legend>
            <label className="ai-row">
              주소
              <input value={s.proxy.url} placeholder="https://slidelab-ai-proxy.<계정>.workers.dev" onChange={(e) => patch({ proxy: { ...s.proxy, url: e.target.value.trim() } })} aria-label="중계 서버 주소" />
            </label>
            <label className="ai-row">
              모델
              <input list="gpt-models" value={s.proxy.model} onChange={(e) => patch({ proxy: { ...s.proxy, model: e.target.value.trim() } })} aria-label="중계 서버 모델" />
            </label>
            <label className="ai-row">
              접근 코드
              <input type="password" autoComplete="off" placeholder="사이트 관리자에게 받은 코드" value={keys.access ?? ''} onChange={(e) => setKeys({ ...keys, access: e.target.value.trim() })} aria-label="접근 코드" />
            </label>
            <datalist id="gpt-models">
              {GPT_MODEL_SUGGESTIONS.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
            <p className="ai-note">중계 서버(Cloudflare Worker)가 OpenAI 키를 보관하고, 허용된 사이트와 접근 코드가 맞는 요청만 GPT로 전달합니다. 설치 방법은 저장소의 proxy/README.md를 보세요.</p>
          </fieldset>
        )}
        {s.provider === 'openai' && (
          <fieldset>
            <legend>OpenAI (GPT)</legend>
            <label className="ai-row">
              API 키
              <input type="password" autoComplete="off" placeholder="sk-..." value={keys.gpt ?? ''} onChange={(e) => setKeys({ ...keys, gpt: e.target.value.trim() })} aria-label="OpenAI API 키" />
            </label>
            <label className="ai-row">
              모델
              <input list="gpt-models" value={s.gpt.model} onChange={(e) => patch({ gpt: { model: e.target.value.trim() } })} aria-label="GPT 모델" />
              <datalist id="gpt-models">
                {GPT_MODEL_SUGGESTIONS.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </label>
            <p className="ai-note">모델 이름은 OpenAI 계정에서 쓸 수 있는 이름을 그대로 적으세요 (예: {GPT_MODEL_SUGGESTIONS.join(', ')}). 키는 platform.openai.com에서 발급합니다.</p>
          </fieldset>
        )}
        {s.provider === 'anthropic' && (
          <fieldset>
            <legend>Claude</legend>
            <label className="ai-row">
              API 키
              <input type="password" autoComplete="off" placeholder="sk-ant-..." value={keys.anthropic ?? ''} onChange={(e) => setKeys({ ...keys, anthropic: e.target.value.trim() })} aria-label="Claude API 키" />
            </label>
            <label className="ai-row">
              모델
              <select value={s.anthropic.model} onChange={(e) => patch({ anthropic: { ...s.anthropic, model: e.target.value } })} aria-label="Claude 모델">
                {CLAUDE_MODELS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="ai-row">
              노력 수준
              <select value={s.anthropic.effort} onChange={(e) => patch({ anthropic: { ...s.anthropic, effort: e.target.value as Effort } })} aria-label="노력 수준">
                <option value="low">낮음 (빠름)</option>
                <option value="medium">보통 (기본)</option>
                <option value="high">높음</option>
                <option value="xhigh">매우 높음</option>
              </select>
            </label>
            <p className="ai-note">안전 정책으로 거절되면 Claude API가 대체 모델로 자동 재시도합니다(Opus·Sonnet·Fable). 키는 console.anthropic.com에서 발급합니다.</p>
          </fieldset>
        )}
        {s.provider === 'openai-compatible' && (
          <fieldset>
            <legend>OpenAI 호환 엔드포인트</legend>
            <label className="ai-row">
              주소
              <input value={s.openai.baseUrl} placeholder={DEFAULT_AI_SETTINGS.openai.baseUrl} onChange={(e) => patch({ openai: { ...s.openai, baseUrl: e.target.value.trim() } })} aria-label="엔드포인트 주소" />
            </label>
            <label className="ai-row">
              모델
              <input value={s.openai.model} placeholder="예: llama3.1" onChange={(e) => patch({ openai: { ...s.openai, model: e.target.value.trim() } })} aria-label="모델 이름" />
            </label>
            <label className="ai-row">
              API 키
              <input type="password" autoComplete="off" placeholder="(없으면 비워 둠)" value={keys.openai ?? ''} onChange={(e) => setKeys({ ...keys, openai: e.target.value.trim() })} aria-label="엔드포인트 API 키" />
            </label>
            <p className="ai-note">브라우저에서 직접 호출하므로 서버가 이 사이트의 CORS 요청을 허용해야 합니다.</p>
          </fieldset>
        )}
        <fieldset>
          <legend>이미지 생성 (선택)</legend>
          <label>
            <input type="checkbox" checked={s.image.enabled} onChange={(e) => patch({ image: { ...s.image, enabled: e.target.checked } })} /> 이미지 생성 사용
          </label>
          {s.image.enabled && (
            <>
              <label>
                <input type="radio" name="imgsrc" checked={s.image.source === 'proxy'} onChange={() => patch({ image: { ...s.image, source: 'proxy', model: s.image.model || DEFAULT_GPT_IMAGE_MODEL } })} /> 사이트 중계 서버 (OpenAI 이미지 API)
              </label>
              <label>
                <input type="radio" name="imgsrc" checked={s.image.source === 'gpt'} onChange={() => patch({ image: { ...s.image, source: 'gpt', model: s.image.model || DEFAULT_GPT_IMAGE_MODEL } })} /> OpenAI 이미지 API (위 GPT 키 사용)
              </label>
              <label>
                <input type="radio" name="imgsrc" checked={s.image.source === 'custom'} onChange={() => patch({ image: { ...s.image, source: 'custom' } })} /> 다른 OpenAI 호환 /images/generations 엔드포인트
              </label>
              {s.image.source === 'gpt' && !keys.gpt && <p className="ai-note ai-err">OpenAI API 키를 위 'OpenAI (GPT)'에서 입력해야 합니다.</p>}
              {s.image.source === 'custom' && (
                <>
                  <label className="ai-row">
                    주소
                    <input value={s.image.baseUrl} placeholder="https://.../v1" onChange={(e) => patch({ image: { ...s.image, baseUrl: e.target.value.trim() } })} aria-label="이미지 엔드포인트 주소" />
                  </label>
                  <label className="ai-row">
                    API 키
                    <input type="password" autoComplete="off" value={keys.image ?? ''} onChange={(e) => setKeys({ ...keys, image: e.target.value.trim() })} aria-label="이미지 API 키" />
                  </label>
                </>
              )}
              <label className="ai-row">
                모델
                <input value={s.image.model} placeholder={DEFAULT_GPT_IMAGE_MODEL} onChange={(e) => patch({ image: { ...s.image, model: e.target.value.trim() } })} aria-label="이미지 모델" />
              </label>
            </>
          )}
        </fieldset>
        <label className="ai-remember">
          <input type="checkbox" checked={s.rememberKeys} onChange={(e) => patch({ rememberKeys: e.target.checked })} /> 이 브라우저에 API 키 기억 (끄면 탭을 닫을 때 지워짐)
        </label>
        <p className="ai-note ai-privacy">
          AI 기능을 쓰면 해당 슬라이드의 텍스트(와 선택한 문서)가 위에서 고른 제공자에게 전송됩니다. 키는 프레젠테이션 파일이나 SlideLab 서버에 저장되지 않으며(서버 없음), 이 브라우저에서만 사용됩니다.
          공용 컴퓨터에서는 키를 기억하지 마세요.
        </p>
        <div className="ai-test">
          <button type="button" className="btn" disabled={test.busy} onClick={() => void runTest()} data-ai="test">
            {test.busy ? '확인 중…' : '연결 테스트'}
          </button>
          {test.msg && <span className={test.ok ? 'ai-ok' : 'ai-err'}>{test.msg}</span>}
        </div>
      </div>
    </Dialog>
  );
}
