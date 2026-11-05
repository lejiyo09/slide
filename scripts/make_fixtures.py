#!/usr/bin/env python3
"""PPTX 가져오기 테스트용 실제 파일을 python-pptx로 생성한다 (SlideLab과 무관한 독립 도구).

생성물: src/services/import/__fixtures__/sample.pptx
  1: 제목 슬라이드 (제목/부제목 개체 틀, 노트)
  2: 제목+내용 (글머리 기호 2수준, 굵게/색/크기 런)
  3: 도형(회전/투명/그라데이션), 연결선 화살표, 그룹, 텍스트 상자, 자른 그림
  4: 표 + 막대 차트 (미지원 → 원본 보존 대상), 전환·애니메이션 XML
  5: 숨김 슬라이드, 구역(p14:sectionLst)
"""
import io
from pathlib import Path
from lxml import etree
from pptx import Presentation
from pptx.util import Emu, Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE, MSO_CONNECTOR
from pptx.enum.text import PP_ALIGN
from pptx.chart.data import CategoryChartData
from pptx.enum.chart import XL_CHART_TYPE

OUT = Path(__file__).resolve().parent.parent / 'src/services/import/__fixtures__'
OUT.mkdir(parents=True, exist_ok=True)

def png(w, h):
    from PIL import Image
    im = Image.new('RGB', (w, h))
    im.putdata([(x * 255 // w, 90, y * 255 // h) for y in range(h) for x in range(w)])
    buf = io.BytesIO(); im.save(buf, 'PNG'); return buf.getvalue()

prs = Presentation()
prs.slide_width, prs.slide_height = Inches(13.333), Inches(7.5)

# 1. 제목 슬라이드
s = prs.slides.add_slide(prs.slide_layouts[0])
s.shapes.title.text = '가져오기 테스트 제목'
s.placeholders[1].text = '부제목 텍스트'
s.notes_slide.notes_text_frame.text = '첫 슬라이드 노트'

# 2. 제목 + 내용, 글머리 기호
s = prs.slides.add_slide(prs.slide_layouts[1])
s.shapes.title.text = '글머리 기호 목록'
tf = s.placeholders[1].text_frame
tf.text = '첫 번째 항목'
p = tf.add_paragraph(); p.text = '하위 항목'; p.level = 1
p = tf.add_paragraph(); p.level = 0
r = p.add_run(); r.text = '굵은 빨강 '; r.font.bold = True; r.font.color.rgb = RGBColor(0xC0, 0, 0); r.font.size = Pt(28)
r = p.add_run(); r.text = '기울임'; r.font.italic = True; r.font.underline = True

# 3. 도형/선/그룹/그림
s = prs.slides.add_slide(prs.slide_layouts[6])
sh = s.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(0.5), Inches(0.5), Inches(3), Inches(1.5))
sh.name = 'RoundBox'
sh.fill.solid(); sh.fill.fore_color.rgb = RGBColor(0x44, 0x72, 0xC4)
sh.line.color.rgb = RGBColor(0x1F, 0x38, 0x64); sh.line.width = Pt(2)
sh.rotation = 30
sh.text_frame.text = '도형 안 텍스트'
sh.text_frame.paragraphs[0].alignment = PP_ALIGN.CENTER
# 투명도(alpha) 주입
sf = sh.fill._xPr.find('.//{http://schemas.openxmlformats.org/drawingml/2006/main}srgbClr')
etree.SubElement(sf, '{http://schemas.openxmlformats.org/drawingml/2006/main}alpha').set('val', '50000')

st = s.shapes.add_shape(MSO_SHAPE.STAR_5_POINT, Inches(4), Inches(0.5), Inches(2), Inches(2))
st.fill.gradient(); st.fill.gradient_angle = 90
st.fill.gradient_stops[0].color.rgb = RGBColor(0xFF, 0xC0, 0x00); st.fill.gradient_stops[1].color.rgb = RGBColor(0xC0, 0x00, 0x00)

ell = s.shapes.add_shape(MSO_SHAPE.OVAL, Inches(7), Inches(0.5), Inches(1.5), Inches(1))
ell.fill.solid(); ell.fill.fore_color.rgb = RGBColor(0x70, 0xAD, 0x47)

c = s.shapes.add_connector(MSO_CONNECTOR.STRAIGHT, Inches(1), Inches(3), Inches(5), Inches(4))
c.line.color.rgb = RGBColor(0xED, 0x7D, 0x31); c.line.width = Pt(3)
ln = c.line._get_or_add_ln()
etree.SubElement(ln, '{http://schemas.openxmlformats.org/drawingml/2006/main}tailEnd').set('type', 'triangle')

grp = s.shapes.add_group_shape()
g1 = grp.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(9), Inches(3), Inches(1), Inches(1))
g2 = grp.shapes.add_shape(MSO_SHAPE.OVAL, Inches(10.5), Inches(3.5), Inches(1), Inches(1))
grp.name = 'MyGroup'

tb = s.shapes.add_textbox(Inches(0.5), Inches(5), Inches(5), Inches(1))
tb.text_frame.text = '텍스트 상자 Arial 20'
for r in tb.text_frame.paragraphs[0].runs:
    r.font.name = 'Arial'; r.font.size = Pt(20)

pic = s.shapes.add_picture(io.BytesIO(png(120, 60)), Inches(7), Inches(5), Inches(4), Inches(2))
pic.crop_left = 0.1; pic.crop_right = 0.2

# 4. 표 + 차트 + 전환/애니메이션
s = prs.slides.add_slide(prs.slide_layouts[5])
s.shapes.title.text = '표와 차트'
tbl = s.shapes.add_table(3, 3, Inches(0.5), Inches(1.6), Inches(5.5), Inches(1.5)).table
for ri in range(3):
    for ci in range(3):
        tbl.cell(ri, ci).text = f'R{ri}C{ci}'
cd = CategoryChartData(); cd.categories = ['1분기', '2분기', '3분기']; cd.add_series('매출', (10, 25, 18))
s.shapes.add_chart(XL_CHART_TYPE.COLUMN_CLUSTERED, Inches(6.5), Inches(1.6), Inches(6), Inches(4.5), cd)
anim_target = s.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(0.5), Inches(4), Inches(2), Inches(1))
anim_target.name = 'Animated'
spid = anim_target.shape_id
P = 'http://schemas.openxmlformats.org/presentationml/2006/main'
transition = etree.fromstring(f'<p:transition xmlns:p="{P}" spd="med"><p:fade/></p:transition>')
timing = etree.fromstring(f'''<p:timing xmlns:p="{P}"><p:tnLst><p:par><p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst>
<p:seq concurrent="1" nextAc="seek"><p:cTn id="2" dur="indefinite" nodeType="mainSeq"><p:childTnLst><p:par><p:cTn id="3" fill="hold"><p:stCondLst><p:cond delay="indefinite"/></p:stCondLst><p:childTnLst>
<p:par><p:cTn id="4" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst><p:par><p:cTn id="5" presetID="10" presetClass="entr" presetSubtype="0" fill="hold" nodeType="clickEffect"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>
<p:set><p:cBhvr><p:cTn id="6" dur="1" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst></p:cTn><p:tgtEl><p:spTgt spid="{spid}"/></p:tgtEl><p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst></p:cBhvr><p:to><p:strVal val="visible"/></p:to></p:set>
<p:animEffect transition="in" filter="fade"><p:cBhvr><p:cTn id="7" dur="500"/><p:tgtEl><p:spTgt spid="{spid}"/></p:tgtEl></p:cBhvr></p:animEffect>
</p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn><p:prevCondLst><p:cond evt="onPrev" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:prevCondLst><p:nextCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:nextCondLst></p:seq>
</p:childTnLst></p:cTn></p:par></p:tnLst><p:bldLst><p:bldP spid="{spid}" grpId="0" animBg="1"/></p:bldLst></p:timing>''')
sld = s._element
cSld = sld.find(f'{{{P}}}cSld')
idx = list(sld).index(sld.find(f'{{{P}}}clrMapOvr')) + 1
sld.insert(idx, transition); sld.insert(idx + 1, timing)

# 5. 숨김 슬라이드
s = prs.slides.add_slide(prs.slide_layouts[5])
s.shapes.title.text = '숨긴 슬라이드'
s._element.set('show', '0')

# 구역 (p14:sectionLst)
ids = [sid.get('id') for sid in prs.slides._sldIdLst]
P14 = 'http://schemas.microsoft.com/office/powerpoint/2010/main'
ext_xml = f'''<p:extLst xmlns:p="{P}"><p:ext uri="{{521415D9-36F7-43E2-AB2F-B90AF26B5E84}}"><p14:sectionLst xmlns:p14="{P14}">
<p14:section name="도입" id="{{11111111-1111-1111-1111-111111111111}}"><p14:sldIdLst><p14:sldId id="{ids[0]}"/><p14:sldId id="{ids[1]}"/></p14:sldIdLst></p14:section>
<p14:section name="본문" id="{{22222222-2222-2222-2222-222222222222}}"><p14:sldIdLst>{''.join(f'<p14:sldId id="{i}"/>' for i in ids[2:])}</p14:sldIdLst></p14:section>
</p14:sectionLst></p:ext></p:extLst>'''
prs.part._element.append(etree.fromstring(ext_xml))

prs.save(OUT / 'sample.pptx')
print('written', OUT / 'sample.pptx')

# ── charts.pptx: 차트 종류별 (8단계) ──
from pptx.chart.data import XyChartData, BubbleChartData
from pptx.enum.chart import XL_LEGEND_POSITION
cp = Presentation()
cp.slide_width, cp.slide_height = Inches(13.333), Inches(7.5)
kinds = [
    (XL_CHART_TYPE.COLUMN_CLUSTERED, '세로 막대'), (XL_CHART_TYPE.BAR_STACKED, '가로 누적 막대'), (XL_CHART_TYPE.LINE_MARKERS, '꺾은선'),
    (XL_CHART_TYPE.PIE, '원형'), (XL_CHART_TYPE.DOUGHNUT, '도넛'), (XL_CHART_TYPE.AREA, '영역'), (XL_CHART_TYPE.RADAR, '방사형(보존)'),
]
for kind, title in kinds:
    s = cp.slides.add_slide(cp.slide_layouts[5])
    s.shapes.title.text = title
    d = CategoryChartData(); d.categories = ['가', '나', '다', '라']
    d.add_series('A', (3, 5, 2, 6))
    if kind not in (XL_CHART_TYPE.PIE, XL_CHART_TYPE.DOUGHNUT):
        d.add_series('B', (4, 1, 5, 2))
    ch = s.shapes.add_chart(kind, Inches(1), Inches(1.5), Inches(8), Inches(5), d).chart
    ch.has_legend = True; ch.legend.position = XL_LEGEND_POSITION.BOTTOM; ch.legend.include_in_layout = False
s = cp.slides.add_slide(cp.slide_layouts[5]); s.shapes.title.text = '분산형'
xy = XyChartData(); ser = xy.add_series('측정')
for x, y in [(1, 2.5), (2, 3.1), (3.5, 1.2), (5, 4.4)]: ser.add_data_point(x, y)
s.shapes.add_chart(XL_CHART_TYPE.XY_SCATTER, Inches(1), Inches(1.5), Inches(8), Inches(5), xy)
cp.save(OUT / 'charts.pptx')
print('written', OUT / 'charts.pptx')
