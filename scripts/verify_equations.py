#!/usr/bin/env python3
"""
SlideLab이 PPTX에 쓴 수식(OMML)을 LibreOffice Writer로 독립 검증한다.
LibreOffice Impress(24.2)는 PPTX의 a14:m을 읽지 못하므로, 같은 m:oMath를 최소 DOCX에 넣어 Writer(OMML 지원)로 연다.
Writer가 만든 수식 개체(StarMath)를 출력한다.

사용: npx vitest run src/services/math  (test-output/equations-export.pptx 생성)
      python3 scripts/verify_equations.py test-output/equations-export.pptx
필요: LibreOffice + libreoffice-math
"""
import re, subprocess, sys, tempfile, zipfile, os

src = sys.argv[1] if len(sys.argv) > 1 else 'test-output/equations-export.pptx'
z = zipfile.ZipFile(src)
slides = sorted((n for n in z.namelist() if re.match(r'ppt/slides/slide\d+\.xml$', n)), key=lambda n: int(re.findall(r'\d+', n)[0]))
paras = []
for n in slides:
    s = z.read(n).decode('utf-8')
    for m in re.finditer(r'<m:oMathPara.*?</m:oMathPara>', s, re.S):
        x = re.sub(r'<a:rPr.*?</a:rPr>', '', m.group(0), flags=re.S)
        paras.append('<w:p>' + re.sub(r' xmlns:a="[^"]*"', '', x) + '</w:p>')
tmp = tempfile.mkdtemp()
docx = os.path.join(tmp, 'eq.docx')
with zipfile.ZipFile(docx, 'w') as o:
    o.writestr('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
    o.writestr('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
    o.writestr('word/document.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><w:body>' + ''.join(paras) + '</w:body></w:document>')
subprocess.run(['soffice', '--headless', f'-env:UserInstallation=file://{tmp}/profile', '--convert-to', 'odt', '--outdir', tmp, docx], check=True, capture_output=True, timeout=300)
odt = zipfile.ZipFile(os.path.join(tmp, 'eq.odt'))
objs = sorted((n for n in odt.namelist() if re.match(r'Object \d+/content.xml', n)), key=lambda n: int(n.split()[1].split('/')[0]))
print(f'수식 {len(paras)}개 → LibreOffice 수식 개체 {len(objs)}개')
for n in objs:
    a = re.search(r'<annotation encoding="StarMath 5.0">(.*?)</annotation>', odt.read(n).decode(), re.S)
    print(' ', n.split('/')[0], '|', a.group(1) if a else '(주석 없음)')
sys.exit(0 if len(objs) == len(paras) else 1)
