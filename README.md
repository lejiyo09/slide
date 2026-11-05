# SlideLab

설치 없이 브라우저에서 동작하는 **웹 기반 프레젠테이션 편집기**입니다.
Microsoft PowerPoint 데스크톱의 작업 방식(리본, 슬라이드 탐색기, 캔버스, 서식 창)을 참고해 독자적으로 구현하며,
서버 없이 핵심 편집 기능이 동작하고 작업 내용은 브라우저의 IndexedDB에 자동 저장됩니다. PWA로 설치하면 오프라인에서도 실행됩니다.

> Microsoft 365의 유료 기능을 해제하는 프로그램이 아니라, 대응 기능을 자체 구현한 독립 프로그램입니다.

## 실행

```bash
npm install
npm run dev          # 개발 서버 (http://localhost:5173)
npm run build        # 타입 검사 + 정적 빌드 (dist/)
npm test             # 단위 테스트 (Vitest)
npm run test:e2e     # 브라우저 E2E (빌드 후 `npx vite preview --port 4173` 실행 상태에서)
npm run verify:pptx  # 내보낸 PPTX를 python-pptx/LibreOffice로 검증
```

GitHub Codespaces에서도 동일하게 실행됩니다. `main`에 push하면 `.github/workflows/deploy.yml`이 테스트·빌드 후 GitHub Pages에 배포합니다
(저장소 Settings → Pages → Source를 **GitHub Actions**로 설정해야 합니다). `base: './'`로 빌드하므로 하위 경로에서도 동작합니다.

## 현재 상태 (1차 작동 버전)

| 단계 | 내용 | 상태 |
| --- | --- | --- |
| 1–2 | 저장소 분석, 아키텍처 | 완료 |
| 3 | 편집기 UI (리본 10개 탭, 슬라이드 탐색기, 캔버스, 서식 창, 상태 표시줄, 노트) | 완료 |
| 4 | 슬라이드/개체 JSON 데이터 모델 | 완료 |
| 5 | 텍스트·도형·이미지 삽입/편집 | 완료 (아래 상세) |
| 6 | 실행 취소/다시 실행, 자동 저장, 버전 기록 | 완료 |
| 7 | PPTX 내보내기 | **기본 내보내기 완료** · 가져오기 미구현 |
| 8 | 표, 차트, 미디어 | 미구현 (리본에 "준비 중"으로 표시) |
| 9 | 테마/디자인 | 테마 5종·배경(단색/그라데이션/그림)·슬라이드 크기 완료 · 마스터 미구현 |
| 10 | 애니메이션·전환 엔진 | 미구현 |
| 11 | 발표 도구 | 기본 슬라이드 쇼 완료 · 발표자 보기/포인터/타이머 미구현 |
| 12 | AI 기능 | 미구현 |
| 13 | 전체 테스트·최적화 | 진행 중 |

미구현 기능은 리본에서 비활성 "준비 중 · N단계" 그룹으로 표시되며, 작동하는 것처럼 보이지 않도록 했습니다.

### 구현된 기능
- **슬라이드**: 추가(레이아웃 6종), 복제, 삭제, 드래그/단축키로 순서 변경, 다중 선택(Ctrl/Shift), 숨기기, 구역(추가·이름 변경·제거·접기), 축소판, 여러 슬라이드 보기, 복사/붙여넣기
- **캔버스**: 선택/다중 선택/영역 선택, 이동(Shift 축 고정, Ctrl+드래그 복제), 회전된 개체 크기 조절(그림은 비율 유지), 회전(Shift 15°), 선 끝점 편집, 스마트 안내선·개체 맞춤(Alt로 해제), 눈금선, 확대/축소(Ctrl+휠, 창에 맞춤), 컨텍스트 메뉴, 파일 드래그 앤 드롭, 이미지 붙여넣기
- **텍스트**: 서식 있는 텍스트 편집(문단·런 단위), 글꼴, 크기, 굵게/기울임/밑줄/취소선, 글자 색, 형광펜, 맞춤, 줄 간격, 글머리 기호/번호, 수준(Tab), 텍스트 방향, 세로 맞춤, 여백, 자동 크기 조정, 개체 틀 안내 문구
- **도형**: 20종 프리셋, 채우기(없음/단색/그라데이션/투명도), 윤곽선(색/두께/대시), 도형 안 텍스트, 선·화살표(머리 모양)
- **이미지**: 업로드(PNG/JPG/GIF/WebP/SVG), 스크린샷 캡처, 크기 조절, 자르기(핸들/수치), 회전, 대칭, 투명도, 그림 바꾸기, 원래대로
- **배열**: 맞춤 6종 + 간격 동일하게, 순서 4종, 그룹/그룹 해제, 서식 복사(Ctrl+Shift+C/V)
- **디자인**: 테마 5종, 슬라이드 배경, 모두 적용, 16:9 / 4:3 / 사용자 지정 크기
- **저장**: IndexedDB 자동 저장, 프로젝트 목록 열기/삭제, `.slidelab`(JSON) 가져오기/내보내기, 버전 저장·복원
- **PPTX 내보내기**: 텍스트·문단 서식, 도형, 선/화살표, 이미지(자르기 반영), 회전/대칭, 투명도, 배경(그라데이션은 이미지로), 노트, 숨김 슬라이드, 구역, 슬라이드 크기. 변환 손실은 내보내기 화면에 **호환성 알림**으로 표시
- **슬라이드 쇼**: 처음부터/현재부터, 전체 화면, 키보드(→ ← Space PgUp/Dn Home End, 번호+Enter), 검은/흰 화면(B/W), 숨김 슬라이드 건너뛰기
- **PWA**: 매니페스트, 서비스 워커(오프라인 실행), 설치 버튼, 새 버전 알림, `.pptx`/`.slidelab` 파일 핸들러 선언
- **기타**: 다크 모드, 상황별 탭(도형 서식/그림 서식), 키보드 단축키

## 아키텍처

```
src/
  app/            App 셸, 부트스트랩(마지막 문서 복원 + 자동 저장 시작)
  types/          JSON 문서 모델 (Presentation → Slide → SlideObject)
  core/
    document/     팩토리(레이아웃·개체 생성), 조회, 스키마 마이그레이션
    commands/     commands.ts: 순수 문서 명령(immer draft) / actions.ts: UI 공용 고수준 동작
    history/      스냅샷 기반 실행 취소/다시 실행 (구조적 공유)
    store/        zustand 전역 상태 (문서, 선택, 보기, 제스처)
  editors/text/   모델↔DOM 변환(richText), contentEditable 편집기, 서식 엔진
  engines/rendering/  ObjectView/SlideView (캔버스·축소판·슬라이드 쇼 공용), 도형 기하
  components/     ribbon, sidebar, canvas, properties, statusbar, slideshow, dialogs, common
  services/       storage(IndexedDB, 자동 저장, 파일), export(PPTX), import(스크린샷)
  themes/  hooks/  utils/  styles/
```

- **좌표계**: 슬라이드 px(96 DPI). 16:9 = 1280×720 px = 13.333×7.5 in. 글꼴은 pt.
- **실행 취소**: 모든 변경은 `commit(label, recipe)` 하나 = 실행 취소 1단계. 드래그·텍스트 편집·슬라이더는 `beginGesture/updateGesture/endGesture`로 묶어 1단계로 기록.
- **렌더링**: 하나의 `SlideView`를 편집 캔버스, 축소판, 슬라이드 쇼, 새 문서 미리보기에서 공유해 화면이 일치.
- **텍스트**: 문단/런 모델과 동일한 DOM 구조를 편집기와 정적 렌더러가 공유하고, 편집 결과는 계산된 스타일로 다시 모델에 반영.
- **PPTX 원본 보존**: 모델에 `sourceXml` 필드를 예약해 두었으며, 7단계 가져오기에서 미지원 요소 원본 XML을 보존할 예정.

## 사용 라이브러리 검증

| 라이브러리 | 버전 | 라이선스 | 용도 |
| --- | --- | --- | --- |
| react / react-dom | 19 | MIT | UI |
| vite, @vitejs/plugin-react | 8 / 6 | MIT | 빌드 |
| typescript | 5.9 | Apache-2.0 | 타입 |
| zustand | 5 | MIT | 상태 관리 |
| immer | 11 | MIT | 불변 갱신·스냅샷 |
| idb | 8 | ISC | IndexedDB 래퍼 |
| pptxgenjs | 4 | MIT | PPTX 생성 (지연 로딩) |
| jszip | 3 | MIT (MIT/GPL 이중) | PPTX 검증·향후 가져오기 |
| nanoid | 5 | MIT | ID |
| lucide-react | 1.x | ISC | 아이콘 |
| vite-plugin-pwa (Workbox) | 2 | MIT | PWA |
| vitest, jsdom, fake-indexeddb | – | MIT/Apache-2.0 | 테스트 |

모두 npm 레지스트리에서 실재·버전·라이선스를 확인했으며 유료 API/SDK는 사용하지 않습니다.

## 키보드 단축키

| 동작 | 키 | 동작 | 키 |
| --- | --- | --- | --- |
| 실행 취소 / 다시 실행 | Ctrl+Z / Ctrl+Y | 새 슬라이드 | Ctrl+M |
| 복사 / 잘라내기 / 붙여넣기 | Ctrl+C / X / V | 복제 | Ctrl+D |
| 그룹 / 해제 | Ctrl+G / Ctrl+Shift+G | 모두 선택 | Ctrl+A |
| 굵게 / 기울임 / 밑줄 | Ctrl+B / I / U | 맞춤(왼/가/오/양) | Ctrl+L / E / R / J |
| 글꼴 크게 / 작게 | Ctrl+] / Ctrl+[ | 맨 앞 / 맨 뒤 | Ctrl+Shift+] / [ |
| 서식 복사 / 붙여넣기 | Ctrl+Shift+C / V | 텍스트 편집 | Enter, F2, 더블클릭 |
| 이동(미세) | 방향키 (Ctrl: 1px, Shift: 크게) | 다음 개체 | Tab |
| 슬라이드 쇼 | F5 / Shift+F5 | 확대/축소/맞춤 | Ctrl+= / Ctrl+- / Ctrl+0 |
| 저장 | Ctrl+S (자동 저장됨) | 취소 | Esc |
