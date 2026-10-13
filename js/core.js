/* 排程核心邏輯（由 Python 版 scheduling.py / numbering.py / text_generator.py /
 * templates_lib.py / style.py 移植），純計算、不碰畫面，瀏覽器與 Node 都能跑。 */
(function (root) {
  "use strict";

  // ───────────────────────── 樣式 / 色票 ─────────────────────────
  const CATEGORY_COLORS = {
    "準備工程": "#2a78d6",
    "土方/路基工程": "#eb6834",
    "排水工程": "#1baf7a",
    "路面工程": "#eda100",
    "交通安全設施": "#e87ba4",
    "環境綠美化": "#008300",
    "結構工程": "#4a3aa7",
    "其他": "#e34948",
  };
  const CATEGORY_ORDER = Object.keys(CATEGORY_COLORS);
  const DEFAULT_ITEM_COLOR = "#898781";
  function colorFor(category) {
    return CATEGORY_COLORS[(category || "").trim()] || DEFAULT_ITEM_COLOR;
  }

  // ───────────────────────── 排程（scheduling.py） ─────────────────────────
  // 里程碑功能已取消，舊資料的 milestone 設定一律不採用
  function isMilestone() { return false; }

  function itemDuration(item) {
    if (isMilestone(item)) return 0;
    return Math.max(parseInt(item.duration, 10) || 1, 1);
  }

  function cleanPredecessors(item, byName) {
    let raw = item.predecessors || [];
    if (typeof raw === "string") raw = raw.trim() ? [raw] : [];
    const names = [], missing = [];
    for (let n of raw) {
      n = (n || "").trim();
      if (!n || n === item.name) continue;
      if (byName.has(n)) { if (!names.includes(n)) names.push(n); }
      else missing.push(n);
    }
    return [names, missing];
  }

  function computeSchedule(items) {
    const byName = new Map();
    for (const it of items) if (it.name) byName.set(it.name, it);
    const resolved = new Map();
    const visiting = new Set();

    function resolve(name) {
      if (resolved.has(name)) return resolved.get(name);
      if (visiting.has(name)) {
        const r = [1, itemDuration(byName.get(name))];
        resolved.set(name, r);
        return r;
      }
      visiting.add(name);
      const item = byName.get(name);
      const [predNames, missing] = cleanPredecessors(item, byName);
      item._valid_predecessors = predNames;
      item._missing_predecessors = missing;
      const lag = parseInt(item.lag, 10) || 0;
      const duration = itemDuration(item);
      let start;
      if (predNames.length) {
        const ends = predNames.map((p) => { const [ps, pd] = resolve(p); return ps + pd - 1; });
        start = Math.max(...ends) + lag + 1;
      } else {
        start = 1 + lag;
      }
      const r = [start, duration];
      resolved.set(name, r);
      visiting.delete(name);
      return r;
    }

    for (const it of items) {
      if (!it.name) continue;
      const [start, duration] = resolve(it.name);
      it.start_day = start;
      it.end_day = start + duration - 1;
    }
    return items;
  }

  function computeCriticalPath(items) {
    const valid = items.filter((it) => it.name);
    const byName = new Map(valid.map((it) => [it.name, it]));
    const successors = new Map(valid.map((it) => [it.name, []]));
    for (const it of valid) {
      let preds = it._valid_predecessors;
      if (!preds) preds = cleanPredecessors(it, byName)[0];
      for (const p of preds) successors.get(p).push(it);
    }
    const projectFinish = valid.reduce((m, it) => Math.max(m, it.end_day || 0), 0);
    const lfCache = new Map();
    const visiting = new Set();

    function computeLf(name) {
      if (lfCache.has(name)) return lfCache.get(name);
      if (visiting.has(name)) return projectFinish; // 循環保護
      visiting.add(name);
      const succs = successors.get(name) || [];
      let lf;
      if (!succs.length) lf = projectFinish;
      else {
        lf = Infinity;
        for (const s of succs) {
          const sLf = computeLf(s.name);
          const sDur = s.end_day - s.start_day + 1;
          const sLs = sLf - sDur + 1;
          const lag = parseInt(s.lag, 10) || 0;
          lf = Math.min(lf, sLs - lag - 1);
        }
      }
      visiting.delete(name);
      lfCache.set(name, lf);
      return lf;
    }

    for (const it of valid) {
      const es = it.start_day, ef = it.end_day;
      const duration = ef - es + 1;
      const lf = computeLf(it.name);
      const ls = lf - duration + 1;
      it.es = es; it.ef = ef; it.ls = ls; it.lf = lf;
      it.total_float = ls - es;
      it.is_critical = it.total_float <= 0;
    }
    return items;
  }

  function bindingPredecessors(item, byName) {
    const preds = item._valid_predecessors || [];
    if (!preds.length) return [];
    const ends = preds.filter((p) => byName.has(p)).map((p) => byName.get(p).end_day);
    const maxEnd = Math.max(...ends);
    return preds.filter((p) => byName.has(p) && byName.get(p).end_day === maxEnd);
  }

  // ───────────────────────── 編號（numbering.py） ─────────────────────────
  function effectiveParent(item, byName) {
    const name = item.name;
    const parent = (item.parent || "").trim();
    if (isMilestone(item) || !parent || parent === name || !byName.has(parent)) return "";
    if (isMilestone(byName.get(parent))) return "";
    const seen = new Set([name]);
    let cur = parent;
    while (cur) {
      if (seen.has(cur)) return "";
      seen.add(cur);
      const ci = byName.get(cur);
      cur = ci ? (ci.parent || "").trim() : "";
    }
    return parent;
  }

  function computeNumbering(items) {
    const valid = items.filter((it) => it.name);
    const byName = new Map(valid.map((it) => [it.name, it]));
    const children = new Map();
    let roots = [];
    for (const it of valid) {
      const p = effectiveParent(it, byName);
      it._effective_parent = p;
      if (p) { if (!children.has(p)) children.set(p, []); children.get(p).push(it); }
      else roots.push(it);
    }
    const order = [];
    for (const it of valid) {
      if (isMilestone(it)) { it.number = "0"; it.level = 0; order.push(it); }
    }
    roots = roots.filter((it) => !isMilestone(it));
    (function walk(list, prefix, level) {
      list.forEach((it, i) => {
        const number = prefix ? `${prefix}.${i + 1}` : `${i + 1}`;
        it.number = number; it.level = level;
        order.push(it);
        walk(children.get(it.name) || [], number, level + 1);
      });
    })(roots, "", 0);
    return order;
  }

  function siblingIds(items, id) {
    const valid = items.filter((it) => it.name);
    const byName = new Map(valid.map((it) => [it.name, it]));
    const target = valid.find((it) => it.id === id);
    if (!target) return [[], -1];
    const tp = effectiveParent(target, byName);
    const sibs = valid.filter((it) => effectiveParent(it, byName) === tp).map((it) => it.id);
    return [sibs, sibs.indexOf(id)];
  }

  function moveItem(items, id, direction) {
    const [sibs, idx] = siblingIds(items, id);
    if (idx < 0) return;
    let other;
    if (direction === "up" && idx > 0) other = sibs[idx - 1];
    else if (direction === "down" && idx < sibs.length - 1) other = sibs[idx + 1];
    else return;
    const i1 = items.findIndex((it) => it.id === id);
    const i2 = items.findIndex((it) => it.id === other);
    if (i1 < 0 || i2 < 0) return;
    [items[i1], items[i2]] = [items[i2], items[i1]];
  }

  function indentItem(items, id) {
    const [sibs, idx] = siblingIds(items, id);
    if (idx <= 0) return;
    const target = items.find((it) => it.id === id);
    const prev = items.find((it) => it.id === sibs[idx - 1]);
    if (target && prev) target.parent = prev.name || "";
  }

  function outdentItem(items, id) {
    const valid = items.filter((it) => it.name);
    const byName = new Map(valid.map((it) => [it.name, it]));
    const target = valid.find((it) => it.id === id);
    if (!target) return;
    const cur = effectiveParent(target, byName);
    if (!cur) return;
    const pItem = byName.get(cur);
    target.parent = pItem ? effectiveParent(pItem, byName) : "";
  }

  // ───────────────────────── 整合：算出顯示用清單 ─────────────────────────
  function getScheduledItems(project) {
    // 里程碑與階段功能已取消：舊專案檔裡殘留的設定一律忽略，里程碑當成一般工項
    const copy = project.items.map((it) => Object.assign({}, it, { milestone: false, stage: "" }));
    computeSchedule(copy);
    computeCriticalPath(copy);
    return computeNumbering(copy);
  }

  function totalDuration(items) {
    return items.reduce((m, it) => Math.max(m, it.end_day || 0), 0);
  }

  // ───────────────────────── 金額 / 累積進度 ─────────────────────────
  function parseAmount(v) {
    const n = parseFloat(String(v == null ? "" : v).replace(/[,，\s]/g, ""));
    return isFinite(n) && n > 0 ? n : 0;
  }
  function itemAmount(item) { return isMilestone(item) ? 0 : parseAmount(item.amount); }
  function totalAmount(items) {
    return items.reduce((s, it) => s + (it.name ? itemAmount(it) : 0), 0);
  }
  function formatAmount(n) { return Math.round(n).toLocaleString("en-US"); }

  // 回傳 day → 累積進度(%)。有填金額時，每個工項的金額平均分攤到工期的每一天；
  // 全部都沒填金額時，退回以工期為權重。
  function cumulativePercent(items) {
    const tasks = items.filter((it) => it.name && !isMilestone(it) && it.end_day - it.start_day + 1 > 0);
    const useAmount = totalAmount(tasks) > 0;
    const dur = (it) => it.end_day - it.start_day + 1;
    const weight = (it) => (useAmount ? itemAmount(it) : dur(it));
    const total = tasks.reduce((s, it) => s + weight(it), 0) || 1;
    return (day) => {
      let done = 0;
      for (const it of tasks) {
        const d = dur(it);
        done += (weight(it) * Math.min(Math.max(day - (it.start_day - 1), 0), d)) / d;
      }
      return (100 * done) / total;
    };
  }

  // ───────────────────────── 文字說明（text_generator.py） ─────────────────────────
  // Word 說明文字。回傳的每段都是 runs 陣列：{ t: 文字, edit: true 表示制式文字、需依個案修改（Word 以紅字標示）}
  const cleanName = (n) => String(n || "").replace(/[(（][^)）]*[)）]/g, "").trim();
  // 名稱本身已含「及」時改用頓號串接，避免「A及B及C」
  const joinNames = (names) => (names.length > 1 && !names.some((n) => n.includes("及"))
    ? names.slice(0, -1).join("、") + "及" + names[names.length - 1] : names.join("、"));

  // 主要工作項目：取最上層工項，去掉括號補充與字尾「工程」
  function mainWorkNames(items) {
    const names = [];
    for (const it of items) {
      if (!it.name || it.milestone || (it.level || 0) > 0) continue;
      const n = cleanName(it.name).replace(/工程$/, "");
      if (n && !names.includes(n)) names.push(n);
    }
    return names;
  }

  // 把最上層工項分成施工階段：全部都有填「階段」就照階段分；否則把施工期間重疊的工項併成同一階段
  function buildStages(tops) {
    const sorted = tops.slice().sort((x, y) => x.start_day - y.start_day || x.end_day - y.end_day);
    const stages = [];
    const byStage = sorted.length > 0 && sorted.every((it) => (it.stage || "").trim());
    for (const it of sorted) {
      const key = byStage ? it.stage.trim() : null;
      let st = byStage ? stages.find((x) => x.key === key) : stages[stages.length - 1];
      if (!st || (!byStage && it.start_day > st.end)) {
        st = { key, items: [], start: it.start_day, end: it.end_day };
        stages.push(st);
      }
      st.items.push(it);
      st.start = Math.min(st.start, it.start_day);
      st.end = Math.max(st.end, it.end_day);
    }
    return stages;
  }

  function generateReport(projectName, items) {
    const valid = items.filter((it) => it.name);
    const tasks = valid.filter((it) => !it.milestone);
    const tops = tasks.filter((it) => (it.level || 0) === 0);
    const total = valid.reduce((m, it) => Math.max(m, it.end_day || 0), 0);
    const months = (total / 30).toFixed(1).replace(/\.0$/, "");
    const note = (it) => (it.note || "").trim().replace(/[。.；;，,]+$/, "");

    const intro = [
      { t: `本工程預定工期為 ${total}日曆天（約${months}個月），主要工作包含${mainWorkNames(valid).join("、")}等。` },
      { t: "施工採分區、分階段及適度交叉作業方式辦理，以提升施工效率並確保工程如期完成。", edit: true },
    ];

    const stages = buildStages(tops).map((st, i) => {
      const multi = st.items.length > 1;
      const title = st.key ? st.key.replace(/[:：]\s*$/, "") : joinNames(st.items.map((it) => cleanName(it.name)));
      const runs = [{ t: `${i + 1}. ${title}（第${st.start}～${st.end}日）：`, bold: true }];
      st.items.forEach((it, k) => {
        const parts = [];
        if (multi) parts.push(k === 0 ? `${cleanName(it.name)}自第${it.start_day}日起施作` : `${cleanName(it.name)}於第${it.start_day}～${it.end_day}日同步施作`);
        const kids = tasks.filter((c) => c._effective_parent === it.name).map((c) => cleanName(c.name));
        if (kids.length) parts.push(`依序辦理${joinNames(kids)}`);
        if (note(it)) parts.push(note(it));
        const end = k === st.items.length - 1 ? "。" : "；";
        if (!kids.length && !note(it)) {
          // 沒有可用的說明，放一句制式文字提醒補寫
          runs.push({ t: (parts.length ? parts.join("，") + "，" : "") });
          runs.push({ t: `依核定施工計畫辦理${cleanName(it.name)}相關作業，並落實品質及安全管理`, edit: true });
          runs.push({ t: end });
        } else {
          runs.push({ t: parts.join("，") + end });
        }
      });
      return runs.filter((r) => r.t);
    });

    // 進度管制節點：要徑上工期最長的三個工項
    const crit = tasks.filter((it) => it.is_critical).sort((x, y) => (y.end_day - y.start_day) - (x.end_day - x.start_day)).slice(0, 3)
      .sort((x, y) => x.start_day - y.start_day).map((it) => cleanName(it.name));
    const closing = [];
    if (crit.length) closing.push({ t: `施工期間將以${joinNames(crit)}為主要進度管制節點，` });
    else closing.push({ t: "施工期間將" });
    closing.push({ t: "定期檢討施工進度，並針對降雨、管線遷移及施工介面等影響因素，適時調整工序與資源配置，降低工期延誤風險。", edit: true });

    return { intro, stages, closing };
  }

  // ───────────────────────── 範本（templates_lib.py） ─────────────────────────
  const TEMPLATES = {
    road: {
      label: "道路工程",
      // 金額為預設值，以總工程費 5,000 萬為基準分配；「路面工程」由子項目填金額，上層不填以免重複計入
      items: [
        { name: "施工前準備", section: "", duration: 30, amount: 2500000, predecessors: [], lag: 0, note: "含機具進場、工地圍籬、假設工程、施工放樣及交通維持計畫申請", category: "準備工程" },
        { name: "路基開挖及土方工程", section: "", duration: 60, amount: 10000000, predecessors: ["施工前準備"], lag: 0, note: "依土質狀況調整開挖坡度與擋土支撐方式", category: "土方/路基工程" },
        { name: "排水工程(涵管/側溝)", section: "", duration: 45, amount: 7500000, predecessors: ["施工前準備"], lag: 15, note: "配合路基開挖進度分區施作，避開豪雨期間", category: "排水工程" },
        { name: "路面工程", section: "", duration: 95, predecessors: ["路基開挖及土方工程", "排水工程(涵管/側溝)"], lag: 0, note: "", category: "路面工程" },
        { name: "路床及級配層舖築", section: "", duration: 40, amount: 7500000, predecessors: ["路基開挖及土方工程", "排水工程(涵管/側溝)"], lag: 0, note: "分層滾壓，每層壓實度須達規範要求", category: "路面工程", parent: "路面工程" },
        { name: "瀝青混凝土基層舖築", section: "", duration: 30, amount: 8000000, predecessors: ["路床及級配層舖築"], lag: 0, note: "", category: "路面工程", parent: "路面工程" },
        { name: "瀝青混凝土面層舖築", section: "", duration: 25, amount: 7000000, predecessors: ["瀝青混凝土基層舖築"], lag: 0, note: "面層攤鋪應注意氣溫及雨天不可施工限制", category: "路面工程", parent: "路面工程" },
        { name: "交通標誌標線及安全設施", section: "", duration: 20, amount: 3500000, predecessors: ["瀝青混凝土面層舖築"], lag: 0, note: "", category: "交通安全設施" },
        { name: "植栽綠美化", section: "", duration: 30, amount: 2500000, predecessors: ["路基開挖及土方工程"], lag: 30, note: "與路面工程平行施作，不影響要徑", category: "環境綠美化" },
        { name: "竣工整理", section: "", duration: 15, amount: 1500000, predecessors: ["交通標誌標線及安全設施", "植栽綠美化"], lag: 0, note: "", category: "其他" },
      ],
    },
  };

  function getTemplate(key) {
    const t = TEMPLATES[key];
    return t ? JSON.parse(JSON.stringify(t.items)) : [];
  }
  function listTemplates() {
    return Object.keys(TEMPLATES).map((k) => ({ key: k, label: TEMPLATES[k].label }));
  }

  root.Core = {
    CATEGORY_COLORS, CATEGORY_ORDER, colorFor,
    isMilestone, computeSchedule, computeCriticalPath, bindingPredecessors,
    effectiveParent, computeNumbering, moveItem, indentItem, outdentItem,
    getScheduledItems, totalDuration, generateReport, getTemplate, listTemplates,
    parseAmount, itemAmount, totalAmount, formatAmount, cumulativePercent,
  };
})(typeof window !== "undefined" ? window : globalThis);
