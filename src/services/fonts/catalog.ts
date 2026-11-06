/**
 * 기본 제공 글꼴 목록.
 * - 웹 글꼴: Google Fonts의 무료 글꼴(SIL OFL / Apache). 모두 Google Fonts CSS API에서 제공 여부를 확인함.
 *   쓸 때만 내려받고, PWA 캐시에 저장되어 다음부터는 오프라인에서도 쓸 수 있다.
 * - 시스템 글꼴: Windows/macOS/Office에 흔히 설치된 글꼴. 이 컴퓨터에 없으면 목록에 "설치 안 됨"으로 표시.
 */

export type FontCategory = 'sans' | 'serif' | 'hand' | 'display' | 'mono';

export const CATEGORY_NAMES: Record<FontCategory, string> = { sans: '고딕', serif: '명조', hand: '손글씨', display: '디자인', mono: '고정폭' };

export interface CatalogFont {
  family: string;
  /** 표시 이름 (한국어 이름이 있으면) */
  label?: string;
  category: FontCategory;
  /** 한글 글리프 포함 */
  korean: boolean;
  /** CSS API 축 지정 (기본 ital,wght 0/1 × 400/700) */
  axes?: string;
}

const W = (family: string, category: FontCategory, korean: boolean, label?: string, axes?: string): CatalogFont => ({ family, category, korean, ...(label ? { label } : {}), ...(axes ? { axes } : {}) });

export const WEB_FONTS: CatalogFont[] = [
  // 한글 — 고딕
  W('Noto Sans KR', 'sans', true, '본고딕 (Noto Sans KR)'),
  W('Nanum Gothic', 'sans', true, '나눔고딕'),
  W('Gothic A1', 'sans', true),
  W('IBM Plex Sans KR', 'sans', true),
  W('Gowun Dodum', 'sans', true, '고운돋움'),
  W('Nanum Gothic Coding', 'mono', true, '나눔고딕코딩'),
  W('Sunflower', 'sans', true, undefined, 'wght@300;500;700'),
  W('Orbit', 'sans', true),
  // 한글 — 명조
  W('Noto Serif KR', 'serif', true, '본명조 (Noto Serif KR)'),
  W('Nanum Myeongjo', 'serif', true, '나눔명조'),
  W('Gowun Batang', 'serif', true, '고운바탕'),
  W('Hahmlet', 'serif', true, '함렛'),
  W('Song Myung', 'serif', true, '송명'),
  W('Diphylleia', 'serif', true),
  // 한글 — 손글씨
  W('Nanum Pen Script', 'hand', true, '나눔손글씨 펜'),
  W('Nanum Brush Script', 'hand', true, '나눔손글씨 붓'),
  W('Gaegu', 'hand', true, '개구'),
  W('Hi Melody', 'hand', true, '하이멜로디'),
  W('Gamja Flower', 'hand', true, '감자꽃'),
  W('Poor Story', 'hand', true),
  W('Single Day', 'hand', true, '싱글데이'),
  W('Cute Font', 'hand', true),
  W('Dokdo', 'hand', true, '독도'),
  W('East Sea Dokdo', 'hand', true, '동해독도'),
  W('Kirang Haerang', 'hand', true, '기랑해랑'),
  W('Dongle', 'hand', true, '동글'),
  // 한글 — 디자인/제목용
  W('Black Han Sans', 'display', true, '검은고딕'),
  W('Do Hyeon', 'display', true, '도현'),
  W('Jua', 'display', true, '주아'),
  W('Yeon Sung', 'display', true, '연성'),
  W('Stylish', 'display', true, '스타일리시'),
  W('Gugi', 'display', true, '구기'),
  W('Bagel Fat One', 'display', true),
  W('Gasoek One', 'display', true),
  W('Moirai One', 'display', true),
  W('Grandiflora One', 'display', true),
  // 영문 — 고딕
  W('Inter', 'sans', false),
  W('Roboto', 'sans', false),
  W('Open Sans', 'sans', false),
  W('Lato', 'sans', false),
  W('Montserrat', 'sans', false),
  W('Poppins', 'sans', false),
  W('Raleway', 'sans', false),
  W('Nunito', 'sans', false),
  W('Source Sans 3', 'sans', false),
  W('Noto Sans', 'sans', false),
  W('Oswald', 'display', false),
  W('Bebas Neue', 'display', false),
  // 영문 — 명조
  W('Playfair Display', 'serif', false),
  W('Merriweather', 'serif', false),
  W('Lora', 'serif', false),
  W('PT Serif', 'serif', false),
  W('Noto Serif', 'serif', false),
  W('Roboto Slab', 'serif', false),
  // 영문 — 손글씨/디자인
  W('Dancing Script', 'hand', false),
  W('Caveat', 'hand', false),
  W('Pacifico', 'hand', false),
  W('Lobster', 'display', false),
  // 고정폭
  W('Roboto Mono', 'mono', false),
  W('Fira Code', 'mono', false),
];

/** 흔히 설치된 시스템/Office 글꼴 (한국어 Windows 이름 포함) */
export const SYSTEM_FONTS: CatalogFont[] = [
  W('Malgun Gothic', 'sans', true, '맑은 고딕'),
  W('맑은 고딕', 'sans', true),
  W('Gulim', 'sans', true, '굴림'),
  W('Dotum', 'sans', true, '돋움'),
  W('Batang', 'serif', true, '바탕'),
  W('Gungsuh', 'serif', true, '궁서'),
  W('Apple SD Gothic Neo', 'sans', true, '애플 SD 산돌고딕 Neo'),
  W('AppleMyungjo', 'serif', true, '애플명조'),
  W('Arial', 'sans', false),
  W('Arial Black', 'display', false),
  W('Calibri', 'sans', false),
  W('Calibri Light', 'sans', false),
  W('Aptos', 'sans', false),
  W('Segoe UI', 'sans', false),
  W('Helvetica', 'sans', false),
  W('Helvetica Neue', 'sans', false),
  W('Verdana', 'sans', false),
  W('Tahoma', 'sans', false),
  W('Trebuchet MS', 'sans', false),
  W('Century Gothic', 'sans', false),
  W('Franklin Gothic Medium', 'sans', false),
  W('Gill Sans MT', 'sans', false),
  W('Corbel', 'sans', false),
  W('Candara', 'sans', false),
  W('Cambria', 'serif', false),
  W('Georgia', 'serif', false),
  W('Times New Roman', 'serif', false),
  W('Garamond', 'serif', false),
  W('Book Antiqua', 'serif', false),
  W('Palatino Linotype', 'serif', false),
  W('Constantia', 'serif', false),
  W('Impact', 'display', false),
  W('Comic Sans MS', 'hand', false),
  W('Segoe Script', 'hand', false),
  W('Courier New', 'mono', false),
  W('Consolas', 'mono', false),
  W('Lucida Console', 'mono', false),
];

export const webFontByFamily = new Map(WEB_FONTS.map((f) => [f.family.toLowerCase(), f]));
export const isWebFont = (family: string) => webFontByFamily.has(family.toLowerCase());

/** 글꼴 선택 상자에 보이는 이름 (미리 보기 파일에 담을 글자) */
export const pickerLabel = (f: CatalogFont) => (f.label && f.label !== f.family ? `${f.family} · ${f.label}` : f.family);

/** Google Fonts CSS2 주소 (text: 그 글자만 담은 작은 미리 보기용 파일) */
export function webFontCssUrl(family: string, text?: string): string {
  const f = webFontByFamily.get(family.toLowerCase());
  const axes = f?.axes ?? 'ital,wght@0,400;0,700;1,400;1,700';
  const q = `family=${encodeURIComponent(f?.family ?? family).replace(/%20/g, '+')}${text ? '' : `:${axes}`}&display=swap${text ? `&text=${encodeURIComponent(text)}` : ''}`;
  return `https://fonts.googleapis.com/css2?${q}`;
}

const HANGUL = /[\u3131-\u318e\uac00-\ud7a3]/;
/** 사용자 글꼴 중 한글 이름이 있는 패밀리 (라이브러리가 채움 — 내보내기에서 동기적으로 판단하려고 여기 둠) */
export const koreanUserFamilies = new Set<string>();

/** 한글을 표시할 수 있는 글꼴인지 (목록의 한글 글꼴, 한글 이름, 한글 이름이 있는 내 글꼴) */
export function koreanCapable(family: string): boolean {
  const low = family.toLowerCase();
  if (HANGUL.test(family) || koreanUserFamilies.has(low)) return true;
  const f = webFontByFamily.get(low) ?? SYSTEM_FONTS.find((x) => x.family.toLowerCase() === low);
  return !!f?.korean;
}
