#!/usr/bin/env python3
"""내보낸 PPTX를 독립 도구(python-pptx, LibreOffice)로 검증한다.

사용법: python3 scripts/verify_pptx.py test-output/e2e-export.pptx
- python-pptx로 슬라이드 크기/개체/텍스트/노트를 출력
- soffice가 있으면 PDF로 변환해 실제로 열리는지 확인
"""
import shutil, subprocess, sys, tempfile, zipfile
from pathlib import Path

path = Path(sys.argv[1] if len(sys.argv) > 1 else 'test-output/e2e-export.pptx')
bad = zipfile.ZipFile(path).testzip()
assert bad is None, f'손상된 ZIP 항목: {bad}'

from pptx import Presentation
from pptx.util import Emu

p = Presentation(str(path))
print(f'크기: {Emu(p.slide_width).inches:.3f} x {Emu(p.slide_height).inches:.3f} in, 슬라이드 {len(p.slides)}장')
for i, s in enumerate(p.slides, 1):
    print(f'-- 슬라이드 {i}')
    for sh in s.shapes:
        t = sh.text_frame.text.replace('\n', ' | ') if sh.has_text_frame else ''
        print(f'   {str(sh.shape_type):18} {sh.name[:16]:16} rot={sh.rotation:6.1f} {t[:50]}')
    if s.has_notes_slide and s.notes_slide.notes_text_frame.text:
        print('   노트:', s.notes_slide.notes_text_frame.text)

if shutil.which('soffice'):
    with tempfile.TemporaryDirectory() as out:
        subprocess.run(['soffice', '--headless', '--convert-to', 'pdf', '--outdir', out, str(path)], check=True, capture_output=True, timeout=180)
        pdf = Path(out) / (path.stem + '.pdf')
        assert pdf.exists() and pdf.stat().st_size > 0, 'LibreOffice 변환 실패'
        print(f'LibreOffice PDF 변환 성공 ({pdf.stat().st_size} bytes)')
else:
    print('soffice 없음: LibreOffice 검증 생략')
