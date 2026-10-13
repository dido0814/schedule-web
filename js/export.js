/* Excel (.xlsx) / Word (.docx) 匯出：自己產生 Office Open XML 並打包成 zip，
 * 不需要任何外部函式庫，也不需要網際網路。 */
(function (root) {
  "use strict";
  const enc = new TextEncoder();

  // ─────────────────────────── ZIP（不壓縮） ───────────────────────────
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(buf) {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  function makeZip(files) {
    // files: [{name, data: string | Uint8Array}]
    const chunks = [], central = [];
    let offset = 0;
    const d = new Date();
    const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    for (const f of files) {
      const name = enc.encode(f.name);
      const data = typeof f.data === "string" ? enc.encode(f.data) : f.data;
      const crc = crc32(data);
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
      lh.setUint16(8, 0, true); lh.setUint16(10, dosTime, true); lh.setUint16(12, dosDate, true);
      lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true);
      lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
      chunks.push(new Uint8Array(lh.buffer), name, data);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true);
      ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true); ch.setUint16(12, dosTime, true);
      ch.setUint16(14, dosDate, true); ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true);
      ch.setUint32(24, data.length, true); ch.setUint16(28, name.length, true);
      ch.setUint32(42, offset, true);
      central.push(new Uint8Array(ch.buffer), name);
      offset += 30 + name.length + data.length;
    }
    const cdSize = central.reduce((s, c) => s + c.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
    return new Blob([...chunks, ...central, new Uint8Array(end.buffer)]);
  }

  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const argb = (hex) => "FF" + hex.replace("#", "").toUpperCase();

  // ─────────────────────────── XLSX 產生器 ───────────────────────────
  function colLetter(n) { let s = ""; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }

  class Styles {
    constructor() {
      this.fonts = ['<font><sz val="11"/><name val="Calibri"/></font>'];
      this.fills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>'];
      this.borders = ["<border><left/><right/><top/><bottom/><diagonal/></border>"];
      this.xfs = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'];
      this.map = new Map();
    }
    idx(list, xml) { let i = list.indexOf(xml); if (i < 0) { list.push(xml); i = list.length - 1; } return i; }
    get(st) {
      if (!st) return 0;
      const key = JSON.stringify(st);
      if (this.map.has(key)) return this.map.get(key);
      let fontId = 0, fillId = 0, borderId = 0, align = "";
      if (st.font) {
        const f = st.font;
        fontId = this.idx(this.fonts, `<font>${f.bold ? "<b/>" : ""}${f.italic ? "<i/>" : ""}<sz val="${f.size || 11}"/>` +
          `<color rgb="${argb(f.color || "#000000")}"/><name val="${esc(f.name || "Microsoft JhengHei")}"/><charset val="136"/></font>`);
      }
      if (st.fill) {
        const xml = st.fill.gradient
          ? `<fill><gradientFill degree="${st.fill.gradient.degree || 0}"><stop position="0"><color rgb="${argb(st.fill.gradient.stops[0])}"/></stop><stop position="1"><color rgb="${argb(st.fill.gradient.stops[1])}"/></stop></gradientFill></fill>`
          : `<fill><patternFill patternType="solid"><fgColor rgb="${argb(st.fill)}"/><bgColor indexed="64"/></patternFill></fill>`;
        fillId = this.idx(this.fills, xml);
      }
      if (st.border) {
        const side = (n) => { const b = st.border[n]; return b ? `<${n} style="${b.style || "thin"}"><color rgb="${argb(b.color)}"/></${n}>` : `<${n}/>`; };
        borderId = this.idx(this.borders, `<border>${side("left")}${side("right")}${side("top")}${side("bottom")}<diagonal/></border>`);
      }
      if (st.align) {
        const a = st.align;
        align = `<alignment${a.h ? ` horizontal="${a.h}"` : ""}${a.v ? ` vertical="${a.v}"` : ""}${a.wrap ? ' wrapText="1"' : ""}` +
          `${a.indent ? ` indent="${a.indent}"` : ""}${a.shrink ? ' shrinkToFit="1"' : ""}/>`;
      }
      const xf = `<xf numFmtId="0" fontId="${fontId}" fillId="${fillId}" borderId="${borderId}" xfId="0"` +
        ` applyFont="1" applyFill="1" applyBorder="1"${align ? ' applyAlignment="1">' + align + "</xf>" : "/>"}`;
      this.xfs.push(xf);
      const id = this.xfs.length - 1;
      this.map.set(key, id);
      return id;
    }
    xml() {
      return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="${this.fonts.length}">${this.fonts.join("")}</fonts>
<fills count="${this.fills.length}">${this.fills.join("")}</fills>
<borders count="${this.borders.length}">${this.borders.join("")}</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="${this.xfs.length}">${this.xfs.join("")}</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
    }
  }

  class Sheet {
    constructor(name) {
      this.name = name; this.cells = new Map(); this.merges = []; this.cols = {}; this.rows = {};
      this.freeze = null; this.showGrid = true;
    }
    cell(r, c) {
      const k = r + "," + c;
      if (!this.cells.has(k)) this.cells.set(k, { r, c, v: null, s: {} });
      return this.cells.get(k);
    }
    set(r, c, v, style) { const x = this.cell(r, c); if (v !== undefined) x.v = v; if (style) Object.assign(x.s, style); return x; }
    merge(r1, c1, r2, c2) { this.merges.push(`${colLetter(c1)}${r1}:${colLetter(c2)}${r2}`); }
    xml(styles) {
      const byRow = new Map();
      for (const x of this.cells.values()) { if (!byRow.has(x.r)) byRow.set(x.r, []); byRow.get(x.r).push(x); }
      const rowNums = [...new Set([...byRow.keys(), ...Object.keys(this.rows).map(Number)])].sort((a, b) => a - b);
      let data = "";
      for (const r of rowNums) {
        const cells = (byRow.get(r) || []).sort((a, b) => a.c - b.c);
        const ht = this.rows[r] ? ` ht="${this.rows[r]}" customHeight="1"` : "";
        data += `<row r="${r}"${ht}>`;
        for (const x of cells) {
          const ref = colLetter(x.c) + r, s = styles.get(Object.keys(x.s).length ? x.s : null);
          if (x.v === null || x.v === "") data += `<c r="${ref}" s="${s}"/>`;
          else if (typeof x.v === "number") data += `<c r="${ref}" s="${s}"><v>${x.v}</v></c>`;
          else data += `<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${esc(x.v)}</t></is></c>`;
        }
        data += "</row>";
      }
      const cols = Object.keys(this.cols).map(Number).sort((a, b) => a - b)
        .map((c) => `<col min="${c}" max="${c}" width="${this.cols[c]}" customWidth="1"/>`).join("");
      let pane = "";
      if (this.freeze) {
        const [fr, fc] = this.freeze;
        pane = `<pane xSplit="${fc - 1}" ySplit="${fr - 1}" topLeftCell="${colLetter(fc)}${fr}" activePane="bottomRight" state="frozen"/>`;
      }
      return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>
<sheetViews><sheetView workbookViewId="0"${this.showGrid ? "" : ' showGridLines="0"'}>${pane}</sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="16.5"/>
${cols ? `<cols>${cols}</cols>` : ""}
<sheetData>${data}</sheetData>
${this.merges.length ? `<mergeCells count="${this.merges.length}">${this.merges.map((m) => `<mergeCell ref="${m}"/>`).join("")}</mergeCells>` : ""}
<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>
<pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/>
</worksheet>`;
    }
  }

  function workbookBlob(sheets) {
    const styles = new Styles();
    const sheetXml = sheets.map((s) => s.xml(styles));
    const files = [
      { name: "[Content_Types].xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("\n")}
</Types>` },
      { name: "_rels/.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
      { name: "xl/workbook.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<bookViews><workbookView/></bookViews>
<sheets>${sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets>
</workbook>` },
      { name: "xl/_rels/workbook.xml.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("\n")}
<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>` },
      { name: "xl/styles.xml", data: styles.xml() },
    ];
    sheetXml.forEach((x, i) => files.push({ name: `xl/worksheets/sheet${i + 1}.xml`, data: x }));
    return makeZip(files);
  }

  // ─────────────────────────── 工程預定進度表（excel_export.py） ───────────────────────────
  const S = {
    navy: "#1F3864", headerBg: "#DCE6F2", dayBar: "#2F5597", doneRed: "#C00000",
    parentRow: "#DDEBF7", childRow: "#FBF6EC", zebra: "#F5F5F5", line: "#D9D9D9",
    barBlue: "#2F75B5", barChild: "#9DC3E6", barRed: "#D03B3B", colLine: "#C9D3DF",
  };
  const font = (size, bold, color) => ({ name: "Microsoft JhengHei", size: size || 11, bold: !!bold, color: color || S.navy });
  const side = (color, style) => ({ color, style: style || "thin" });

  function textWidth(s) {
    let w = 0;
    for (const ch of s) w += /[ᄀ-￯]/.test(ch) ? 2.3 : 1.2;
    return w;
  }

  function buildXlsx(projectName, items, unitDays = 5, tickStep = 30) {
    const valid = items.filter((it) => it.name);
    const milestones = valid.filter((it) => it.milestone);
    const tasks = valid.filter((it) => !it.milestone);
    const total = Math.max(valid.reduce((m, it) => Math.max(m, it.end_day || 0), 0), 1);
    const hasCpm = valid.length > 0 && valid.every((it) => "is_critical" in it);
    const parentNames = new Set(valid.map((it) => it._effective_parent).filter(Boolean));
    const nMonths = Math.ceil(total / tickStep);
    const cpm = tickStep / unitDays;
    const numCols = nMonths * cpm;
    const first = 4, last = first + numCols - 1;
    const dayCol = (d) => first + Math.min(Math.floor(Math.max(d, 0) / unitDays), numCols - 1);

    const ws = new Sheet("工程預定進度表");
    ws.showGrid = false;

    // 標題
    ws.merge(1, 1, 1, last);
    ws.set(1, 1, `${projectName}　工程預定進度表`, {
      font: font(22, true), align: { h: "left", v: "center", indent: 1 },
      fill: { gradient: { degree: 0, stops: ["#FFFFFF", "#CFE0F3"] } }, border: { left: side(S.navy, "thick") },
    });
    for (let c = 2; c <= last; c++) ws.set(1, c, undefined, { fill: { gradient: { degree: 0, stops: ["#FFFFFF", "#CFE0F3"] } } });
    ws.rows[1] = 48; ws.rows[2] = 8;

    // 表頭
    const ht = 3, hb = 4;
    const cl = side(S.colLine), wl = side("#FFFFFF");
    [[1, "編號"], [2, "主要工作項目"], [3, "工期\n(日)"]].forEach(([c, label]) => {
      ws.merge(ht, c, hb, c);
      for (const r of [ht, hb]) ws.set(r, c, undefined, { fill: S.headerBg, border: { left: cl, right: cl, top: cl, bottom: cl } });
      ws.set(ht, c, label, { font: font(12, true), align: { h: "center", v: "center", wrap: true } });
    });
    for (let m = 0; m < nMonths; m++) {
      const c0 = first + m * cpm, c1 = c0 + cpm - 1;
      ws.merge(ht, c0, ht, c1); ws.merge(hb, c0, hb, c1);
      for (let c = c0; c <= c1; c++) {
        ws.set(ht, c, undefined, { fill: S.headerBg, border: { left: c === c0 && m > 0 ? wl : null, top: cl } });
        ws.set(hb, c, undefined, { fill: S.dayBar });
      }
      ws.set(ht, c0, `第${m + 1}月`, { font: font(11, true), align: { h: "center", v: "center" } });
      ws.set(hb, c0, m * tickStep, { font: font(10, false, "#FFFFFF"), align: { h: "left", v: "center" } });
    }
    ws.rows[ht] = 22; ws.rows[hb] = 22;

    // 資料列
    const rows = [];
    if (milestones.length) rows.push(["milestone", null]);
    tasks.forEach((it) => rows.push(["task", it]));
    let nameWidth = 22, row = hb + 1;
    const ln = side(S.line);
    rows.forEach(([kind, it], i) => {
      const level = it ? it.level || 0 : 0;
      const isParent = it && parentNames.has(it.name);
      const bg = isParent ? S.parentRow : level > 0 ? (i % 2 === 1 ? S.childRow : "#FFFFFF") : (i % 2 === 1 ? S.zebra : "#FFFFFF");
      for (let c = 1; c <= last; c++) {
        let left = null;
        if (c <= first) left = cl; else if ((c - first) % cpm === 0) left = ln;
        ws.set(row, c, undefined, { fill: bg, border: { left, right: c === last ? cl : null, bottom: ln } });
      }
      const number = kind === "milestone" ? "0" : it.number || "";
      const name = kind === "milestone" ? "里程碑" : it.name;
      const ns = level === 0 ? 12 : 11;
      ws.set(row, 1, number, { font: font(ns, level === 0), align: { h: "center", v: "center" } });
      ws.set(row, 2, name, { font: font(ns, level === 0), align: { h: "left", v: "center", indent: 1 + level * 2 } });
      nameWidth = Math.max(nameWidth, (textWidth(name) * ns) / 11 + level * 3 + 4);
      const durStyle = { font: font(12), align: { h: "center", v: "center" } };
      ws.rows[row] = 26;
      if (kind === "milestone") {
        ws.set(row, 3, "-", durStyle);
        for (const ms of milestones) {
          const day = Math.min(Math.max(ms.end_day || 0, 0), total);
          const col = dayCol(day > 0 ? day - 1 : 0);
          const edge = day === 0 || day === total;
          const right = col - first > numCols / 2;
          ws.set(row, col, right ? `${ms.name} ◆` : `◆ ${ms.name}`, {
            font: font(11, true, edge ? S.doneRed : S.navy), align: { h: right ? "right" : "left", v: "center" },
          });
        }
        row++;
        return;
      }
      const dur = it.end_day - it.start_day + 1;
      ws.set(row, 3, dur, durStyle);
      if (dur > 0) {
        const bar = hasCpm && it.is_critical ? S.barRed : level > 0 ? S.barChild : S.barBlue;
        const bs = side(bg, "thick");
        const sc = dayCol(it.start_day - 1), ec = dayCol(it.end_day - 1);
        for (let c = sc; c <= ec; c++) ws.set(row, c, undefined, { fill: bar, border: { top: bs, bottom: bs } });
        if (ec > sc) ws.merge(row, sc, row, ec);
        ws.set(row, sc, `${dur}日`, { font: font(ec > sc ? 10 : 8, true, "#FFFFFF"), align: { h: "center", v: "center", shrink: true } });
      }
      row++;
    });
    const lastRow = row - 1;
    ws.cols[1] = 7; ws.cols[2] = Math.round(nameWidth * 10) / 10; ws.cols[3] = 8;
    for (let c = 0; c < numCols; c++) ws.cols[first + c] = 2.6;
    ws.freeze = [hb + 1, first];

    // 頁尾
    const foot = lastRow + 2;
    const legend = [[S.barBlue, "一般工項"]];
    if (hasCpm && tasks.some((it) => it.is_critical)) legend.unshift([S.barRed, "要徑工項"]);
    let col = first;
    for (const [color, t] of legend) {
      ws.set(foot, col, undefined, { fill: color }); ws.set(foot, col + 1, undefined, { fill: color });
      ws.set(foot, col + 2, t, { font: font(10), align: { h: "left", v: "center", indent: 1 } });
      col += 8;
    }
    ws.set(foot, last, `總工期：${total} 日曆天`, { font: font(12, true), align: { h: "right", v: "center" } });
    ws.rows[foot] = 22;

    const sheets = [ws];
    if (hasCpm) sheets.push(cpmSheet(valid));
    return workbookBlob(sheets);
  }

  function cpmSheet(valid) {
    const ws = new Sheet("要徑分析表(CPM)");
    const b = side("#C3C2B7"), border = { left: b, right: b, top: b, bottom: b };
    const headers = ["編號", "工作項目", "工期", "最早開始(ES)", "最早完成(EF)", "最遲開始(LS)", "最遲完成(LF)", "總浮時(TF)", "是否要徑"];
    headers.forEach((h, i) => ws.set(1, i + 1, h, { font: { name: "Microsoft JhengHei", bold: true, color: "#FFFFFF" }, fill: "#2A78D6", align: { h: "center", v: "center" }, border }));
    let r = 2;
    for (const it of [...valid].sort((a, b2) => (a.es || 0) - (b2.es || 0))) {
      const vals = [it.number || "", it.name, it.ef - it.es + 1, it.es, it.ef, it.ls, it.lf, it.total_float, it.is_critical ? "是" : "否"];
      vals.forEach((v, i) => {
        const st = { align: { h: "center", v: "center" }, border, font: { name: "Microsoft JhengHei", color: "#000000" } };
        if (it.is_critical && i === 1) st.font = { name: "Microsoft JhengHei", bold: true, color: "#D03B3B" };
        if (it.is_critical && i === 8) { st.fill = "#D03B3B"; st.font = { name: "Microsoft JhengHei", bold: true, color: "#FFFFFF" }; }
        ws.set(r, i + 1, v, st);
      });
      r++;
    }
    [8, 26, 8, 12, 12, 12, 12, 10, 10].forEach((w, i) => (ws.cols[i + 1] = w));
    ws.set(r + 1, 1, "要徑：總浮時(TF)=0，任一要徑項目延誤都會直接拖延總工期，應優先管控。",
      { font: { name: "Microsoft JhengHei", italic: true, size: 9, color: "#898781" } });
    return ws;
  }

  // ─────────────────────────── Word（word_export.py） ───────────────────────────
  function canvasPng(canvas) {
    const b64 = canvas.toDataURL("image/png").split(",")[1];
    const bin = atob(b64), out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function buildDocx(projectName, items, ganttCanvas, pdmCanvas) {
    const lines = Core.generateFullText(projectName, items);
    const valid = items.filter((it) => it.name);
    const hasCpm = valid.length > 0 && valid.every((it) => "is_critical" in it);
    const images = [];
    let body = "";
    const run = (t, opt) => `<w:r>${opt && opt.bold ? "<w:rPr><w:b/></w:rPr>" : ""}<w:t xml:space="preserve">${esc(t)}</w:t></w:r>`;
    const para = (runs, style, center) =>
      `<w:p><w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ""}<w:spacing w:after="120"/>${center ? '<w:jc w:val="center"/>' : ""}</w:pPr>${runs}</w:p>`;
    const image = (canvas) => {
      const id = images.length + 1;
      images.push(canvasPng(canvas));
      const cx = Math.round(6.3 * 914400), cy = Math.round((cx * canvas.height) / canvas.width);
      return `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">
<wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${id}" name="圖${id}"/>
<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>
<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic>
<pic:nvPicPr><pic:cNvPr id="${id}" name="image${id}.png"/><pic:cNvPicPr/></pic:nvPicPr>
<pic:blipFill><a:blip r:embed="rIdImg${id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>
<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>
</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
    };

    body += para(run(`${projectName} 工程預定進度說明`), "Heading1", true);
    body += para(run("一、預定進度表"), "Heading2");
    body += image(ganttCanvas);
    body += para(run("二、施工排程說明"), "Heading2");
    lines.forEach((l, i) => (body += para(run(l, { bold: i === 0 }))));
    if (hasCpm) {
      body += para(run("三、要徑網圖（PDM 前置作業法）"), "Heading2");
      body += image(pdmCanvas);
      const crit = valid.filter((it) => it.is_critical).map((it) => it.name);
      if (crit.length) body += para(run("要徑（總浮時=0，任一項目延誤都會拖延總工期）：", { bold: true }) + run(crit.join("　→　")));
      const nc = valid.filter((it) => !it.is_critical && (it.total_float || 0) > 0);
      if (nc.length) body += para(run(`非要徑項目浮時：${nc.map((it) => `${it.name}尚有 ${it.total_float} 日曆天浮時`).join("；")}。`));
    }

    const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
 xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
 xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
 xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
<w:body>${body}
<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr>
</w:body></w:document>`;

    const fontXml = '<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Microsoft JhengHei" w:cs="Calibri"/>';
    const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr>${fontXml}<w:sz w:val="24"/><w:szCs w:val="24"/><w:lang w:val="en-US" w:eastAsia="zh-TW"/></w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="300" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>
<w:pPr><w:keepNext/><w:spacing w:before="240" w:after="240"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:color w:val="1F3864"/><w:sz w:val="36"/><w:szCs w:val="36"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>
<w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:color w:val="2F5597"/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr></w:style>
</w:styles>`;

    const files = [
      { name: "[Content_Types].xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Default Extension="png" ContentType="image/png"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>` },
      { name: "_rels/.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>` },
      { name: "word/_rels/document.xml.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
${images.map((_, i) => `<Relationship Id="rIdImg${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image${i + 1}.png"/>`).join("\n")}
</Relationships>` },
      { name: "word/document.xml", data: doc },
      { name: "word/styles.xml", data: styles },
    ];
    images.forEach((img, i) => files.push({ name: `word/media/image${i + 1}.png`, data: img }));
    return makeZip(files);
  }

  function download(blob, filename) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  root.Exporter = { buildXlsx, buildDocx, download, makeZip };
})(window);
