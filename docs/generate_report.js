const fs = require('fs');
const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
        AlignmentType, BorderStyle, WidthType, ShadingType, HeadingLevel } = require('docx');

const border = { style: BorderStyle.SINGLE, size: 1, color: "999999" };
const borders = { top: border, bottom: border, left: border, right: border };
const noBorder = { style: BorderStyle.NONE, size: 0 };
const noBorders = { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder };

const cellMargins = { top: 60, bottom: 60, left: 100, right: 100 };

function headerCell(text, width) {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    borders,
    shading: { fill: "1B3A5C", type: ShadingType.CLEAR },
    margins: cellMargins,
    verticalAlign: "center",
    children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [
      new TextRun({ text, bold: true, font: "맑은 고딕", size: 17, color: "FFFFFF" })
    ]})]
  });
}

function cell(children, width, opts = {}) {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    borders,
    margins: cellMargins,
    shading: opts.shading ? { fill: opts.shading, type: ShadingType.CLEAR } : undefined,
    verticalAlign: "center",
    children: Array.isArray(children) ? children : [children]
  });
}

function txt(text, opts = {}) {
  return new TextRun({ text, font: "맑은 고딕", size: opts.size || 17, ...opts });
}

function p(runs, opts = {}) {
  return new Paragraph({
    spacing: { before: opts.before || 0, after: opts.after || 40, line: opts.line || 260 },
    alignment: opts.align || AlignmentType.LEFT,
    children: Array.isArray(runs) ? runs : [runs],
    ...opts.extra
  });
}

function bulletP(text, opts = {}) {
  return p([txt(opts.bold ? "" : "", { size: 16 }), txt(text, { size: 16, ...opts })], { before: 10, after: 10 });
}

// ── 본문 ──

const tableWidth = 9026;
const col1 = 1600;
const col2 = 7426;

const doc = new Document({
  styles: {
    default: { document: { run: { font: "맑은 고딕", size: 20 } } },
  },
  sections: [{
    properties: {
      page: {
        size: { width: 11906, height: 16838 },
        margin: { top: 1100, right: 1440, bottom: 900, left: 1440 }
      }
    },
    children: [
      // ── 제목 ──
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 60 },
        children: [txt("부킹 관리 시스템(FORWARDING GL) 도입 보고서", { bold: true, size: 28, color: "1B3A5C" })]
      }),
      new Paragraph({
        alignment: AlignmentType.RIGHT,
        spacing: { after: 200 },
        children: [txt("2026.04.05  |  포워딩팀", { size: 16, color: "666666" })]
      }),

      // ── 1. 배경 ──
      p([txt("1. 추진 배경", { bold: true, size: 20, color: "1B3A5C" })], { before: 40, after: 80 }),
      new Table({
        width: { size: tableWidth, type: WidthType.DXA },
        columnWidths: [tableWidth],
        rows: [new TableRow({ children: [
          cell([
            p([txt("포워딩 부킹 현황을 엑셀 파일로 관리하면서 ", { size: 16 }),
               txt("실시간 현황 파악 지연, BLANK SAILING 누락, 담당자 간 정보 불일치", { size: 16, bold: true }),
               txt(" 등의 문제가 반복 발생하였습니다. 이를 해결하기 위해 웹 기반 부킹 관리 시스템을 자체 개발하여 Vercel 클라우드에 배포하였으며, 본 보고서는 시스템 도입에 따른 운영 변화와 기대효과를 정리합니다.", { size: 16 })
            ], { before: 20, after: 20 })
          ], tableWidth, { shading: "F5F7FA" })
        ]})]
      }),

      // ── 2. AS-IS vs TO-BE ──
      p([txt("2. 기존 운영 vs 신규 운영안", { bold: true, size: 20, color: "1B3A5C" })], { before: 200, after: 80 }),
      new Table({
        width: { size: tableWidth, type: WidthType.DXA },
        columnWidths: [4513, 4513],
        rows: [
          new TableRow({ children: [
            headerCell("기존 운영 (AS-IS)", 4513),
            headerCell("신규 운영안 (TO-BE)", 4513),
          ]}),
          new TableRow({ children: [
            cell([
              bulletP("\u2022 엑셀 파일 기반 부킹 현황 관리 (개인 PC / 공유폴더)"),
              bulletP("\u2022 BLANK SAILING 수기 파악 \u2014 주차별 누락 빈번"),
              bulletP("\u2022 선사\u00B7도착지별 현황 취합에 30분 이상 소요"),
              bulletP("\u2022 서류마감일 수동 모니터링 (놓치는 경우 발생)"),
              bulletP("\u2022 담당자 부재 시 업무 파악 불가"),
              bulletP("\u2022 RF(리퍼) 컨테이너 구분 없이 혼합 관리"),
            ], 4513),
            cell([
              bulletP("\u2022 웹 기반 실시간 부킹 관리 (PC/모바일 접근)"),
              bulletP("\u2022 BLANK SAILING 자동 감지", { bold: true }),
              p([txt("   (주차 범위 설정 \u2192 비RF 기준 자동 판별, RF 분리)", { size: 15, color: "555555" })], { before: 0, after: 10 }),
              bulletP("\u2022 서류마감 D-3 자동 색상 경고 + 필터"),
              bulletP("\u2022 선사별 색상 구분, 도착지 병합 등 가시성 극대화"),
              bulletP("\u2022 엑셀 복사/내보내기 지원 \u2192 기존 업무 연속성 확보"),
            ], 4513),
          ]}),
        ]
      }),

      // ── 3. 주요 기능 ──
      p([txt("3. 시스템 주요 기능", { bold: true, size: 20, color: "1B3A5C" })], { before: 200, after: 80 }),
      new Table({
        width: { size: tableWidth, type: WidthType.DXA },
        columnWidths: [2200, 6826],
        rows: [
          new TableRow({ children: [ headerCell("기능", 2200), headerCell("설명", 6826) ]}),
          new TableRow({ children: [
            cell(p([txt("BLANK SAILING", { size: 15, bold: true })], { align: AlignmentType.CENTER }), 2200, { shading: "FFF8E1" }),
            cell(p([txt("주차 범위(예: 14~18주) 설정 시 도착지별 비RF 부킹 누락 주차를 자동 표시, ETD 필터 자동 연동", { size: 15 })]), 6826)
          ]}),
          new TableRow({ children: [
            cell(p([txt("RF 분리", { size: 15, bold: true })], { align: AlignmentType.CENTER }), 2200, { shading: "E0F7FA" }),
            cell(p([txt("리퍼 컨테이너는 별도 그룹으로 하단 배치, 일반 컨테이너와 분리하여 BLANK 판단 정확도 향상", { size: 15 })]), 6826)
          ]}),
          new TableRow({ children: [
            cell(p([txt("선사 색상 관리", { size: 15, bold: true })], { align: AlignmentType.CENTER }), 2200, { shading: "F3E5F5" }),
            cell(p([txt("설정 탭에서 선사별 색상 지정 \u2192 부킹장 테이블 배지에 즉시 반영, 한눈에 선사 식별", { size: 15 })]), 6826)
          ]}),
          new TableRow({ children: [
            cell(p([txt("엑셀 연동", { size: 15, bold: true })], { align: AlignmentType.CENTER }), 2200, { shading: "E8F5E9" }),
            cell(p([txt("드래그 범위 Ctrl+C 복사(열제목 포함 옵션), 엑셀 내보내기, 내륙운송 데이터 추출", { size: 15 })]), 6826)
          ]}),
          new TableRow({ children: [
            cell(p([txt("서류마감 경고", { size: 15, bold: true })], { align: AlignmentType.CENTER }), 2200, { shading: "FFEBEE" }),
            cell(p([txt("D-3 이내 자동 빨간 배지 표시, 클릭 시 해당 건만 필터링하여 즉시 대응 가능", { size: 15 })]), 6826)
          ]}),
        ]
      }),

      // ── 4. 필요 지원 ──
      p([txt("4. 사내 지원 필요 사항", { bold: true, size: 20, color: "1B3A5C" })], { before: 200, after: 80 }),
      new Table({
        width: { size: tableWidth, type: WidthType.DXA },
        columnWidths: [1800, 3613, 3613],
        rows: [
          new TableRow({ children: [
            headerCell("지원 부서", 1800), headerCell("지원 내용", 3613), headerCell("비고", 3613)
          ]}),
          new TableRow({ children: [
            cell(p([txt("IT / 정보보안", { size: 15, bold: true })], { align: AlignmentType.CENTER }), 1800, { shading: "EEF2F7" }),
            cell(p([txt("사내 도메인 연결, SSL 인증서, 접근 권한(IP 화이트리스트) 설정", { size: 15 })]), 3613),
            cell(p([txt("Vercel + Supabase 클라우드 보안 검토", { size: 15 })]), 3613),
          ]}),
          new TableRow({ children: [
            cell(p([txt("포워딩 운영", { size: 15, bold: true })], { align: AlignmentType.CENTER }), 1800, { shading: "EEF2F7" }),
            cell(p([txt("선사\u00B7도착지\u00B7양하항 마스터 데이터 관리, 입력 규칙 수립", { size: 15 })]), 3613),
            cell(p([txt("설정 탭에서 직접 관리 가능 (자체 해결)", { size: 15 })]), 3613),
          ]}),
          new TableRow({ children: [
            cell(p([txt("경영지원", { size: 15, bold: true })], { align: AlignmentType.CENTER }), 1800, { shading: "EEF2F7" }),
            cell(p([txt("클라우드 운영 비용 승인 (Vercel Pro + Supabase)", { size: 15 })]), 3613),
            cell(p([txt("현재 무료 플랜 운영 중, 트래픽 증가 시 전환 필요", { size: 15 })]), 3613),
          ]}),
        ]
      }),

      // ── 5. 기대효과 & 확장성 ──
      p([txt("5. 기대효과 및 확장성", { bold: true, size: 20, color: "1B3A5C" })], { before: 200, after: 80 }),
      new Table({
        width: { size: tableWidth, type: WidthType.DXA },
        columnWidths: [4513, 4513],
        rows: [
          new TableRow({ children: [ headerCell("기대효과", 4513), headerCell("향후 확장 방향", 4513) ]}),
          new TableRow({ children: [
            cell([
              bulletP("\u2022 부킹 현황 파악 시간 30분 \u2192 실시간 (즉시)"),
              bulletP("\u2022 BLANK SAILING 누락 건수 제로화"),
              bulletP("\u2022 서류마감 지연 사고 예방 (D-3 자동 경고)"),
              bulletP("\u2022 담당자 부재 시에도 현황 즉시 파악 가능"),
              bulletP("\u2022 엑셀 호환으로 기존 업무 프로세스 유지"),
            ], 4513),
            cell([
              bulletP("\u2022 고객사 포털 연동 (부킹 현황 공유)"),
              bulletP("\u2022 BI 대시보드 (선사별\u00B7도착지별 물량 추이)"),
              bulletP("\u2022 내륙운송 시스템 연계 자동화"),
              bulletP("\u2022 알림 기능 (카카오톡/이메일 서류마감 알림)"),
              bulletP("\u2022 다중 법인\u00B7지점 확장 (멀티테넌시)"),
            ], 4513),
          ]}),
        ]
      }),
    ]
  }]
});

Packer.toBuffer(doc).then(buffer => {
  fs.writeFileSync("C:\\작업\\FORWARDING_GL\\docs\\FORWARDING_GL_도입보고서.docx", buffer);
  console.log("✅ 보고서 생성 완료: docs/FORWARDING_GL_도입보고서.docx");
});
