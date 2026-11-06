테스트용 글꼴: Caladea(SIL Open Font License 1.1, CALADEA-LICENSE.txt)를 fontTools로 일부 글자만 남기고
글꼴 이름을 "SlideLab Test Serif"(한국어 이름 "슬라이드랩 테스트 명조")로 바꾼 파생본입니다 (OFL 4·5항에 따라 이름 변경).

- `TestSerif.ttc`: 위 두 글꼴(Regular, BoldItalic)을 fontTools로 묶은 글꼴 모음(TTC). 모음 나누기 테스트용.
- `Boldonse.pptx`: LibreOffice 소스의 테스트 파일 `sd/qa/unit/data/BoldonseFontEmbedded.pptx`(MPL 2.0).
  PowerPoint가 Boldonse 글꼴(Google Fonts, SIL OFL 1.1)을 MTX 압축 EOT로 포함한 실제 파일입니다.
- `Boldonse.libeot.ttf`: 위 파일의 `ppt/fonts/font1.fntdata`를 시스템 libeot(`EOT2ttf_buffer`)로 복원한 참조 결과 (OFL 1.1). MTX 복원 결과 비교용.
