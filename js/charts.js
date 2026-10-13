/* 甘特圖（傳統表格式）與 PDM 要徑網圖，用 canvas 繪製（對應 Python 版 gantt_chart.py / pdm_chart.py） */
(function (root) {
  "use strict";
  const FONT = '"Microsoft JhengHei","微軟正黑體","Noto Sans TC","Noto Sans CJK TC","PingFang TC",sans-serif';
  const SCALE = 2; // 高解析輸出（Word 內嵌也清楚）

  const C = {
    headerGreen: "#3a7d3a", headerText: "#ffffff", critical: "#c0392b", normal: "#a9cced",
    float: "#bfbfbf", curve: "#2f5fa8", grid: "#c9c9c9", stageBand: "#eef2f7",
    ink: "#1a1a1a", milestone: "#1f3864",
  };

  function makeCanvas(w, h) {
    const cv = document.createElement("canvas");
    cv.width = Math.ceil(w * SCALE);
    cv.height = Math.ceil(h * SCALE);
    cv.style.width = w + "px";
    const ctx = cv.getContext("2d");
    ctx.scale(SCALE, SCALE);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    ctx.textBaseline = "middle";
    return [cv, ctx];
  }
  function font(size, bold) { return `${bold ? "bold " : ""}${size}px ${FONT}`; }
  function text(ctx, s, x, y, opt) {
    opt = opt || {};
    ctx.font = font(opt.size || 13, opt.bold);
    ctx.fillStyle = opt.color || C.ink;
    ctx.textAlign = opt.align || "left";
    ctx.fillText(s, x, y);
  }
  function line(ctx, x1, y1, x2, y2, color, w, dash) {
    ctx.beginPath();
    ctx.strokeStyle = color; ctx.lineWidth = w || 1;
    ctx.setLineDash(dash || []);
    ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.setLineDash([]);
  }
  function rect(ctx, x, y, w, h, fill, stroke, sw) {
    if (fill) { ctx.fillStyle = fill; ctx.fillRect(x, y, w, h); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = sw || 1; ctx.strokeRect(x, y, w, h); }
  }

  // ─────────────────────────── 甘特圖 ───────────────────────────
  const MONTH_DAYS = 30;

  function buildRows(items) {
    const rows = [];
    let last = null;
    for (const it of items) {
      const stage = (it.stage || "").trim();
      if (stage && stage !== last) rows.push({ type: "stage", label: stage });
      if (stage) last = stage;
      rows.push({ type: "item", item: it });
    }
    return rows;
  }

  function renderGantt(items, projectName) {
    let valid = items.filter((it) => it.name);
    const empty = !valid.length;
    if (empty) valid = [{ name: "(尚未輸入工作項目)", start_day: 1, end_day: 1 }];
    const hasCpm = !empty && valid.every((it) => "is_critical" in it);

    const totalDays = Math.max(valid.reduce((m, it) => Math.max(m, it.end_day || 0), 0), MONTH_DAYS);
    const nMonths = Math.ceil(totalDays / MONTH_DAYS);
    const axisMax = nMonths * MONTH_DAYS;
    const rows = buildRows(valid);

    // 量測工作項目欄寬
    const mctx = document.createElement("canvas").getContext("2d");
    mctx.font = font(13);
    let nameW = 240;
    for (const it of valid) {
      const w = mctx.measureText("　".repeat(it.level || 0) + it.name).width + 24;
      if (w > nameW) nameW = w;
    }
    for (const r of rows) if (r.type === "stage") {
      mctx.font = font(13, true);
      nameW = Math.max(nameW, mctx.measureText(r.label).width + 24);
    }
    nameW = Math.min(nameW, 420);
    const colNo = 56, colDur = 70;
    const labelW = colNo + nameW + colDur;
    const dayPx = Math.max(2.2, Math.min(6, 1150 / axisMax));
    const chartW = axisMax * dayPx;
    const rowH = 30;
    const pad = 20, titleH = 46, legendH = 46;
    const nRowsTotal = rows.length + 2; // 表頭 + 內容 + 累積列
    const tableH = nRowsTotal * rowH;
    const W = pad * 2 + labelW + chartW;
    const H = pad + titleH + tableH + legendH + pad;
    const [cv, ctx] = makeCanvas(W, H);

    const x0 = pad, col1 = x0 + colNo, col2 = col1 + nameW, gx = col2 + colDur, gxEnd = gx + chartW;
    const top = pad + titleH;
    const rowY = (r) => top + r * rowH; // 第 r 列的上緣
    const dayX = (d) => gx + d * dayPx;

    // 標題
    text(ctx, `${projectName}　工程預定進度表`, x0, pad + 18, { size: 18, bold: true });

    // 表頭
    rect(ctx, x0, rowY(0), gxEnd - x0, rowH, C.headerGreen);
    const hy = rowY(0) + rowH / 2;
    text(ctx, "項次", (x0 + col1) / 2, hy, { size: 13, bold: true, color: C.headerText, align: "center" });
    text(ctx, "工作項目", (col1 + col2) / 2, hy, { size: 13, bold: true, color: C.headerText, align: "center" });
    text(ctx, "工期(日)", (col2 + gx) / 2, hy, { size: 12.5, bold: true, color: C.headerText, align: "center" });
    text(ctx, "月次", (gx + gxEnd) / 2, rowY(0) + rowH * 0.27, { size: 11, bold: true, color: C.headerText, align: "center" });
    for (let m = 0; m < nMonths; m++) {
      text(ctx, String(m + 1), dayX(m * MONTH_DAYS + MONTH_DAYS / 2), rowY(0) + rowH * 0.75,
        { size: 11, bold: true, color: C.headerText, align: "center" });
    }
    line(ctx, gx, hy, gxEnd, hy, "#ffffff", 0.8);

    // 內容列
    rows.forEach((row, i) => {
      const r = i + 1, y = rowY(r), cy = y + rowH / 2;
      if (row.type === "stage") {
        rect(ctx, x0, y, gxEnd - x0, rowH, C.stageBand);
        text(ctx, row.label, col1 + 8, cy, { size: 13, bold: true });
        return;
      }
      const it = row.item;
      if (r % 2 === 0) rect(ctx, x0, y, gxEnd - x0, rowH, "#f7f7f7");
      const start = it.start_day || 1, end = it.end_day == null ? start : it.end_day;
      const dur = end - start + 1;
      text(ctx, String(it.number || ""), (x0 + col1) / 2, cy, { size: 12, align: "center" });
      text(ctx, "　".repeat(it.level || 0) + it.name, col1 + 8, cy, { size: 13 });
      text(ctx, it.milestone ? "-" : String(dur), (col2 + gx) / 2, cy, { size: 12, align: "center" });
      if (empty) return;
      if (it.milestone) {
        const mx = dayX(end), s = 8;
        ctx.beginPath();
        ctx.moveTo(mx, cy - s); ctx.lineTo(mx + s, cy); ctx.lineTo(mx, cy + s); ctx.lineTo(mx - s, cy); ctx.closePath();
        ctx.fillStyle = C.milestone; ctx.fill();
        return;
      }
      const critical = hasCpm && it.is_critical;
      const tf = hasCpm ? (parseInt(it.total_float, 10) || 0) : 0;
      const bh = rowH * 0.62, by = cy - bh / 2;
      rect(ctx, dayX(start - 1), by, dur * dayPx, bh, critical ? C.critical : C.normal, "#5a5a5a", 0.6);
      if (!critical && tf > 0) rect(ctx, dayX(end), by, tf * dayPx, bh, C.float, "#5a5a5a", 0.6);
    });

    // 累積進度列
    const cumR = rows.length + 1, cumY = rowY(cumR), cumCy = cumY + rowH / 2;
    rect(ctx, x0, cumY, gxEnd - x0, rowH, C.headerGreen);
    text(ctx, "預定進度累積百分比(%)", (x0 + col2) / 2, cumCy, { size: 12, bold: true, color: C.headerText, align: "center" });
    const tasks = empty ? [] : valid.filter((it) => !it.milestone);
    const totalWork = tasks.reduce((s, it) => s + Math.max(it.end_day - it.start_day + 1, 0), 0) || 1;
    const cumPct = (day) => {
      let done = 0;
      for (const it of tasks) {
        const d = it.end_day - it.start_day + 1;
        done += Math.min(Math.max(day - (it.start_day - 1), 0), d);
      }
      return (100 * done) / totalWork;
    };
    for (let m = 0; m < nMonths; m++) {
      text(ctx, cumPct((m + 1) * MONTH_DAYS).toFixed(0), dayX(m * MONTH_DAYS + MONTH_DAYS / 2), cumCy,
        { size: 11.5, bold: true, color: C.headerText, align: "center" });
    }

    // 格線
    const tTop = rowY(0), tBot = rowY(nRowsTotal);
    for (let m = 1; m < nMonths; m++) line(ctx, dayX(m * MONTH_DAYS), tTop, dayX(m * MONTH_DAYS), tBot, C.grid, 0.6);
    for (let r = 1; r < nRowsTotal; r++) line(ctx, x0, rowY(r), gxEnd, rowY(r), C.grid, 0.6);
    for (const vx of [col1, col2, gx]) line(ctx, vx, tTop, vx, tBot, "#888888", 0.8);
    rect(ctx, x0, tTop, gxEnd - x0, tBot - tTop, null, "#333333", 1.2);

    // S 曲線（0~100% 對應表格下緣~上緣，上下各留 4%）
    if (!empty) {
      const pctY = (p) => tBot - ((p + 4) / 108) * (tBot - tTop);
      const step = Math.max(1, Math.floor(axisMax / 200));
      ctx.beginPath();
      ctx.strokeStyle = C.curve; ctx.lineWidth = 1.8; ctx.setLineDash([6, 4]);
      for (let d = 0; d <= axisMax; d += step) {
        const x = dayX(d), y = pctY(cumPct(d));
        d === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.lineTo(dayX(axisMax), pctY(cumPct(axisMax)));
      ctx.stroke(); ctx.setLineDash([]);
      ctx.beginPath(); ctx.fillStyle = C.curve; ctx.arc(dayX(0), pctY(0), 3.5, 0, Math.PI * 2); ctx.fill();
    }

    // 圖例
    const ly = tBot + 26;
    let lx = x0;
    const legend = [[C.critical, "主要路徑（要徑）"], [C.normal, "一般路徑"], [C.float, "浮時"], [C.curve, "累積進度曲線"]];
    ctx.font = font(12.5);
    for (const [color, label] of legend) {
      if (label === "累積進度曲線") line(ctx, lx, ly, lx + 28, ly, color, 1.8, [6, 4]);
      else rect(ctx, lx, ly - 7, 28, 14, color, "#5a5a5a", 0.6);
      text(ctx, label, lx + 36, ly, { size: 12.5 });
      lx += 36 + ctx.measureText(label).width + 30;
    }
    text(ctx, `總工期：${empty ? 0 : totalDays} 日曆天`, gxEnd, ly, { size: 13, bold: true, align: "right" });
    return cv;
  }

  // ─────────────────────────── PDM 網圖 ───────────────────────────
  const PDM = { critical: "#d03b3b", normal: "#898781", ms: "#2a78d6", ink: "#0b0b0b", ink2: "#52514e", muted: "#898781", surface: "#fcfcfb" };

  function wrap(s, width) {
    const out = [];
    for (let i = 0; i < s.length; i += width) out.push(s.slice(i, i + width));
    return out;
  }

  function renderPdm(items, projectName) {
    const valid = items.filter((it) => it.name && "es" in it);
    if (!valid.length) {
      const [cv, ctx] = makeCanvas(600, 160);
      text(ctx, "尚未有工作項目可繪製網圖", 300, 80, { size: 16, align: "center" });
      return cv;
    }
    const byName = new Map(valid.map((it) => [it.name, it]));
    // 分層
    const cache = new Map();
    const layerOf = (name, visiting) => {
      if (cache.has(name)) return cache.get(name);
      visiting = visiting || new Set();
      if (visiting.has(name)) { cache.set(name, 0); return 0; }
      visiting.add(name);
      const preds = (byName.get(name)._valid_predecessors || []).filter((p) => byName.has(p));
      const l = preds.length ? Math.max(...preds.map((p) => layerOf(p, visiting))) + 1 : 0;
      cache.set(name, l);
      return l;
    };
    const layers = new Map();
    for (const it of valid) {
      const l = layerOf(it.name);
      if (!layers.has(l)) layers.set(l, []);
      layers.get(l).push(it);
    }
    for (const arr of layers.values()) arr.sort((a, b) => a.es - b.es);
    const maxLayer = Math.max(...layers.keys());

    const U = 68; // 1 單位 = 68px
    const bw = 2.6, bh = 1.5, cg = 1.3, rg = 0.5, mw = 1.3, mh = 0.9;
    const pos = new Map(); // name -> [x, y] (y 往上為正，y 為方塊下緣)
    for (const [layer, arr] of layers) {
      const n = arr.length, th = n * bh + (n - 1) * rg, sy = th / 2;
      arr.forEach((it, i) => pos.set(it.name, [layer * (bw + cg), sy - i * (bh + rg) - bh / 2]));
    }
    const ys = [...pos.values()].map((p) => p[1]);
    const midY = (Math.max(...ys) + Math.min(...ys)) / 2;
    const startX = -(bw + cg), endX = (maxLayer + 1) * (bw + cg);
    const minX = startX - 0.4, maxX = endX + mw + 0.4;
    const minY = Math.min(...ys) - 0.5, maxY = Math.max(...ys) + bh + 0.4;
    const padTop = 52, padBot = 64;
    const W = Math.max((maxX - minX) * U, 800), H = (maxY - minY) * U + padTop + padBot;
    const [cv, ctx] = makeCanvas(W, H);
    rect(ctx, 0, 0, W, H, PDM.surface);
    const X = (x) => (x - minX) * U;
    const Y = (y) => padTop + (maxY - y) * U;

    text(ctx, `${projectName}  要徑網圖（PDM 前置作業法）`, 12, 26, { size: 18, bold: true, color: PDM.ink });

    function arrow(x1, y1, x2, y2, critical) {
      const color = critical ? PDM.critical : PDM.normal;
      const w = critical ? 2.2 : 1.1;
      const ang = Math.atan2(y2 - y1, x2 - x1), hl = critical ? 11 : 9;
      line(ctx, x1, y1, x2 - Math.cos(ang) * hl * 0.8, y2 - Math.sin(ang) * hl * 0.8, color, w);
      ctx.beginPath();
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - hl * Math.cos(ang - 0.4), y2 - hl * Math.sin(ang - 0.4));
      ctx.lineTo(x2 - hl * Math.cos(ang + 0.4), y2 - hl * Math.sin(ang + 0.4));
      ctx.closePath(); ctx.fillStyle = color; ctx.fill();
    }
    function roundRect(x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
    }

    // 箭頭（先畫，節點蓋在上面）
    const hasSucc = new Set();
    const msY = Y(midY + bh / 2);
    for (const it of valid) {
      const [x, y] = pos.get(it.name);
      const left = [X(x), Y(y + bh / 2)];
      const preds = (it._valid_predecessors || []).filter((p) => pos.has(p));
      if (preds.length) {
        const binding = new Set(Core.bindingPredecessors(it, byName));
        for (const p of preds) {
          const [px, py] = pos.get(p);
          const crit = it.is_critical && byName.get(p).is_critical && binding.has(p);
          arrow(X(px + bw), Y(py + bh / 2), left[0], left[1], crit);
          hasSucc.add(p);
        }
      } else arrow(X(startX + mw), msY, left[0], left[1], it.is_critical);
    }
    for (const it of valid) if (!hasSucc.has(it.name)) {
      const [x, y] = pos.get(it.name);
      arrow(X(x + bw), Y(y + bh / 2), X(endX), msY, it.is_critical);
    }

    // 節點
    for (const it of valid) {
      const [ux, uy] = pos.get(it.name);
      const x = X(ux), y = Y(uy + bh), w = bw * U, h = bh * U;
      const crit = it.is_critical, color = crit ? PDM.critical : PDM.normal, lw = crit ? 2.2 : 1.1;
      roundRect(x, y, w, h, 4);
      ctx.fillStyle = "#ffffff"; ctx.fill();
      ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.stroke();
      const er = 0.32 * U, topDiv = y + er, botDiv = y + h - er;
      line(ctx, x, topDiv, x + w, topDiv, color, lw * 0.6);
      line(ctx, x, botDiv, x + w, botDiv, color, lw * 0.6);
      for (const cx of [x + w / 3, x + (2 * w) / 3]) {
        line(ctx, cx, y, cx, topDiv, color, lw * 0.5);
        line(ctx, cx, botDiv, cx, y + h, color, lw * 0.5);
      }
      const tm = y + er / 2, bm = y + h - er / 2, o = { size: 11.5, align: "center", color: PDM.ink };
      const dur = it.ef - it.es + 1;
      text(ctx, String(it.es), x + w / 6, tm, o);
      text(ctx, `${dur}d`, x + w / 2, tm, Object.assign({}, o, { color: PDM.ink2 }));
      text(ctx, String(it.ef), x + (5 * w) / 6, tm, o);
      text(ctx, String(it.ls), x + w / 6, bm, o);
      text(ctx, `TF=${it.total_float}`, x + w / 2, bm, Object.assign({}, o, { size: 10.5, color: PDM.ink2 }));
      text(ctx, String(it.lf), x + (5 * w) / 6, bm, o);
      const label = it.number ? `${it.number} ${it.name}` : it.name;
      const lines = label.length > 9 ? wrap(label, 9).slice(0, 3) : [label];
      const midC = (topDiv + botDiv) / 2, lh = 16;
      lines.forEach((ln, i) => text(ctx, ln, x + w / 2, midC + (i - (lines.length - 1) / 2) * lh,
        { size: 12, bold: crit, align: "center", color: PDM.ink }));
    }

    // 開始 / 完成
    for (const [ux, label] of [[startX, "開始"], [endX, "完成"]]) {
      const x = X(ux), w = mw * U, h = mh * U;
      roundRect(x, msY - h / 2, w, h, 18);
      ctx.fillStyle = PDM.ms; ctx.fill();
      text(ctx, label, x + w / 2, msY, { size: 14, bold: true, color: "#ffffff", align: "center" });
    }

    // 圖例與說明
    const fy = H - padBot + 22;
    line(ctx, 12, fy, 42, fy, PDM.critical, 2.5);
    text(ctx, "要徑（總浮時 TF = 0）", 50, fy, { size: 12, color: PDM.ink2 });
    line(ctx, 230, fy, 260, fy, PDM.normal, 1.5);
    text(ctx, "非要徑（有浮時）", 268, fy, { size: 12, color: PDM.ink2 });
    text(ctx, "節點格式：左上=最早開始(ES) 中上=工期 右上=最早完成(EF) ｜ 左下=最遲開始(LS) 中下=總浮時(TF) 右下=最遲完成(LF)",
      12, fy + 24, { size: 11, color: PDM.muted });
    return cv;
  }

  root.Charts = { renderGantt, renderPdm };
})(window);
