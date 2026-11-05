import { useEffect, useState } from 'react';
import { CheckCircle2, Info } from 'lucide-react';
import { Dialog } from './Dialog';
import { onImportReport } from '../../services/import/importFile';
import { summarizeReport, type ImportReport } from '../../services/import/report';

/** PPTX 가져오기 결과: 지원하지 않는 요소를 숨기지 않고 알린다 */
export function ImportReportDialog() {
  const [report, setReport] = useState<ImportReport | null>(null);
  useEffect(() => onImportReport(setReport), []);
  if (!report) return null;
  const lines = summarizeReport(report);
  return (
    <Dialog title="PowerPoint 파일 가져오기 완료" onClose={() => setReport(null)} onOk={() => setReport(null)} hideCancel>
      <p className="ir-summary">
        <CheckCircle2 size={16} /> <strong>{report.fileName}</strong>: 슬라이드 {report.slides}장, 개체 {report.objects}개를 편집 가능한 개체로 가져왔습니다.
      </p>
      {lines.length > 0 ? (
        <>
          <p className="ir-head">
            <Info size={15} /> 호환성 알림
          </p>
          <ul className="ir-list">
            {lines.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </>
      ) : (
        <p className="muted">모든 요소를 지원되는 형식으로 가져왔습니다.</p>
      )}
    </Dialog>
  );
}
