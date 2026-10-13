/* 畫面與資料儲存（瀏覽器 localStorage，可多專案；可匯出/匯入專案檔分享給同仁） */
(function () {
  "use strict";
  const STORE_KEY = "engineering-schedule.v1";
  const $ = (s, el) => (el || document).querySelector(s);
  const h = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  // ─────────────── 儲存 ───────────────
  let memoryStore = null;
  let storageOk = true;
  function loadStore() {
    let data = null;
    try { data = JSON.parse(localStorage.getItem(STORE_KEY) || "null"); } catch (e) { storageOk = false; data = memoryStore; }
    if (!data || !data.projects || !Object.keys(data.projects).length) {
      const p = newProject("本計畫");
      data = { currentId: p.id, projects: { [p.id]: p } };
    }
    if (!data.projects[data.currentId]) data.currentId = Object.keys(data.projects)[0];
    return data;
  }
  function saveStore() {
    store.projects[store.currentId].updated = Date.now();
    try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (e) { storageOk = false; memoryStore = store; }
  }
  function newProject(name, items) {
    const its = (items || []).map((it, i) => Object.assign({}, it, { id: i + 1 }));
    return { id: "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name, items: its, next_id: its.length + 1, updated: Date.now() };
  }

  let store = loadStore();
  const project = () => store.projects[store.currentId];

  // ─────────────── 修改操作 ───────────────
  function commit() { saveStore(); render(); }

  function nameTaken(name, exceptId) {
    return project().items.some((it) => it.name === name && it.id !== exceptId);
  }

  function renameReferences(oldName, newName) {
    for (const it of project().items) {
      if (Array.isArray(it.predecessors)) it.predecessors = it.predecessors.map((p) => (p === oldName ? newName : p));
      if ((it.parent || "") === oldName) it.parent = newName;
    }
  }

  function updateField(id, field, value) {
    const it = project().items.find((x) => x.id === id);
    if (!it) return;
    if (field === "name") {
      value = value.trim();
      if (!value) { toast("工作項目名稱不可空白"); render(); return; }
      if (nameTaken(value, id)) { toast(`已經有「${value}」這個工作項目，名稱不可重複`); render(); return; }
      renameReferences(it.name, value);
    }
    if (field === "duration") value = Math.max(parseInt(value, 10) || 1, 1);
    if (field === "lag") value = Math.max(parseInt(value, 10) || 0, 0);
    if (field === "milestone") value = !!value;
    if (typeof value === "string") value = value.trim();
    it[field] = value;
    commit();
  }

  function addItem(form) {
    const el = (n) => form.elements.namedItem(n);
    form = { name: el("name"), parent: el("parent"), stage: el("stage"), duration: el("duration"), milestone: el("milestone"),
      category: el("category"), lag: el("lag"), note: el("note"),
      preds: [...form.elements].filter((x) => x.name === "pred" && x.checked).map((x) => x.value) };
    const name = form.name.value.trim();
    if (!name) { toast("請輸入工作項目名稱"); form.name.focus(); return; }
    if (nameTaken(name)) { toast(`已經有「${name}」這個工作項目，名稱不可重複`); return; }
    const p = project();
    p.items.push({
      id: p.next_id++,
      name,
      section: "",
      parent: form.parent.value,
      stage: form.stage.value.trim(),
      duration: Math.max(parseInt(form.duration.value, 10) || 1, 1),
      milestone: form.milestone.checked,
      category: form.category.value,
      predecessors: form.preds,
      lag: Math.max(parseInt(form.lag.value, 10) || 0, 0),
      note: form.note.value.trim(),
    });
    commit();
    setTimeout(() => { const n = $("#addForm input[name=name]"); if (n) n.focus(); }, 0);
  }

  function deleteItem(id) {
    const p = project();
    const it = p.items.find((x) => x.id === id);
    if (!it || !confirm(`確定要刪除「${it.name}」這個工作項目嗎？`)) return;
    p.items = p.items.filter((x) => x.id !== id);
    for (const o of p.items) {
      if (Array.isArray(o.predecessors)) o.predecessors = o.predecessors.filter((n) => n !== it.name);
      if ((o.parent || "") === it.name) o.parent = "";
    }
    commit();
  }

  // ─────────────── 畫面 ───────────────
  let scheduled = [];

  function predPicker(selected, exclude, namesAll, id) {
    const names = namesAll.filter((n) => n !== exclude);
    const sel = (selected || []).filter((n) => names.includes(n));
    const summary = sel.length ? sel.map(h).join("、") : '<span class="muted">（無）</span>';
    const boxes = names.length
      ? names.map((n) => `<label><input type="checkbox" name="pred" value="${h(n)}" ${sel.includes(n) ? "checked" : ""}> ${h(n)}</label>`).join("")
      : '<div class="muted">尚無其他工項</div>';
    return `<details class="pred" ${id != null ? `data-id="${id}"` : ""}><summary>${summary}</summary><div class="pred-list">${boxes}</div></details>`;
  }

  function options(list, selected, emptyLabel) {
    return `<option value="">${emptyLabel}</option>` +
      list.map((n) => `<option value="${h(n)}" ${n === selected ? "selected" : ""}>${h(n)}</option>`).join("");
  }

  function render() {
    const p = project();
    scheduled = Core.getScheduledItems(p);
    const total = Core.totalDuration(scheduled);
    const names = p.items.map((it) => it.name).filter(Boolean);

    // 專案選單
    $("#projectSelect").innerHTML = Object.values(store.projects)
      .sort((a, b) => (b.updated || 0) - (a.updated || 0))
      .map((x) => `<option value="${x.id}" ${x.id === store.currentId ? "selected" : ""}>${h(x.name)}</option>`).join("");
    const pn = $("#projectName");
    if (document.activeElement !== pn) pn.value = p.name;
    $("#totalBadge").textContent = `總工期：${total} 日曆天`;
    $("#itemCount").textContent = `${p.items.length} 項`;

    // 表格
    const rows = scheduled.map((it) => {
      const tf = it.total_float || 0;
      const missing = (it._missing_predecessors || []).length
        ? `<div class="warn">找不到：${it._missing_predecessors.map(h).join("、")}</div>` : "";
      return `<tr data-id="${it.id}" class="${it.is_critical ? "crit" : ""}">
        <td class="num">${h(it.number)}</td>
        <td class="name-cell" style="padding-left:${6 + (it.level || 0) * 18}px">
          <div class="nc">${it.level ? '<span class="tree">└</span>' : ""}<input data-f="name" value="${h(it.name)}"></div></td>
        <td><select data-f="parent">${options(names.filter((n) => n !== it.name), it.parent || "", "（最上層）")}</select></td>
        <td><input data-f="stage" value="${h(it.stage)}" placeholder="選填"></td>
        <td class="dur">${it.milestone ? '<span class="ms">◆ 里程碑</span>' : `<input type="number" min="1" data-f="duration" value="${h(it.duration)}">`}
          <label class="ms-toggle" title="設為里程碑（工期 0）"><input type="checkbox" data-f="milestone" ${it.milestone ? "checked" : ""}>里程碑</label></td>
        <td><span class="swatch" style="background:${Core.colorFor(it.category)}"></span><select data-f="category">${options(Core.CATEGORY_ORDER, it.category || "", "（未分類）")}</select></td>
        <td>${predPicker(it.predecessors, it.name, names, it.id)}${missing}</td>
        <td><input type="number" min="0" data-f="lag" value="${h(it.lag || 0)}"></td>
        <td><input data-f="note" value="${h(it.note)}" placeholder="施工注意事項（帶入 Word 說明）"></td>
        <td class="day">${it.start_day}</td><td class="day">${it.end_day}</td>
        <td class="day ${it.is_critical ? "tf0" : ""}">${it.is_critical ? "要徑" : tf}</td>
        <td class="ops">
          <button data-op="up" title="跟前一個同層工項交換">↑</button><button data-op="down" title="跟下一個同層工項交換">↓</button>
          <button data-op="outdent" title="升一層">⇤</button><button data-op="indent" title="降一層，成為前一個同層工項的子項目">⇥</button>
          <button data-op="del" class="del" title="刪除">✕</button></td></tr>`;
    }).join("");

    const addRow = `<tr id="addRow"><td class="num muted">新增</td>
      <td><input name="name" form="addForm" placeholder="新工作項目名稱"></td>
      <td><select name="parent" form="addForm">${options(names, "", "（最上層）")}</select></td>
      <td><input name="stage" form="addForm" placeholder="選填"></td>
      <td class="dur"><input type="number" min="1" name="duration" form="addForm" value="30">
        <label class="ms-toggle"><input type="checkbox" name="milestone" form="addForm">里程碑</label></td>
      <td><select name="category" form="addForm">${options(Core.CATEGORY_ORDER, "", "（未分類）")}</select></td>
      <td id="addPred">${predPicker([], null, names, null)}</td>
      <td><input type="number" min="0" name="lag" form="addForm" value="0"></td>
      <td><input name="note" form="addForm" placeholder="選填"></td>
      <td colspan="3" class="muted">自動計算</td>
      <td><button type="submit" form="addForm" class="btn primary sm">＋ 新增</button></td></tr>`;
    $("#itemsBody").innerHTML = rows + addRow;
    // details 裡的 checkbox 需要掛到 addForm
    document.querySelectorAll("#addPred input[name=pred]").forEach((x) => x.setAttribute("form", "addForm"));
    $("#emptyHint").hidden = p.items.length > 0;

    // 要徑
    const crit = scheduled.filter((it) => it.is_critical).map((it) => it.name);
    $("#critPath").innerHTML = crit.length ? `要徑：<b>${crit.map(h).join("　→　")}</b>` : "";

    scheduleCharts();
  }

  let chartTimer = null;
  function scheduleCharts() {
    clearTimeout(chartTimer);
    chartTimer = setTimeout(drawCharts, 60);
  }
  function drawCharts() {
    const p = project();
    const g = Charts.renderGantt(scheduled, p.name);
    const d = Charts.renderPdm(scheduled, p.name);
    $("#gantt").replaceChildren(g);
    $("#pdm").replaceChildren(d);
  }

  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove("show"), 3200);
  }

  const safeName = (s) => s.replace(/[\\/:*?"<>|]/g, "_");

  // ─────────────── 事件 ───────────────
  function bind() {
    const body = $("#itemsBody");
    body.addEventListener("change", (e) => {
      const el = e.target;
      const tr = el.closest("tr[data-id]");
      if (!tr) return;
      const id = parseInt(tr.dataset.id, 10);
      if (el.name === "pred") {
        const det = el.closest("details");
        const vals = [...det.querySelectorAll("input[name=pred]:checked")].map((x) => x.value);
        const it = project().items.find((x) => x.id === id);
        it.predecessors = vals;
        saveStore();
        // 下拉保持展開，只更新摘要與數字
        scheduled = Core.getScheduledItems(project());
        const keepOpen = det.dataset.id;
        render();
        const again = document.querySelector(`details.pred[data-id="${keepOpen}"]`);
        if (again) again.open = true;
        return;
      }
      if (el.dataset.f) updateField(id, el.dataset.f, el.type === "checkbox" ? el.checked : el.value);
    });
    body.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && e.target.matches("tr[data-id] input")) e.target.blur();
    });
    body.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-op]");
      if (!b) return;
      const id = parseInt(b.closest("tr").dataset.id, 10);
      const items = project().items;
      switch (b.dataset.op) {
        case "up": Core.moveItem(items, id, "up"); break;
        case "down": Core.moveItem(items, id, "down"); break;
        case "indent": Core.indentItem(items, id); break;
        case "outdent": Core.outdentItem(items, id); break;
        case "del": deleteItem(id); return;
      }
      commit();
    });
    // 點外面關閉前置工項下拉
    document.addEventListener("click", (e) => {
      document.querySelectorAll("details.pred[open]").forEach((d) => { if (!d.contains(e.target)) d.open = false; });
    });

    $("#addForm").addEventListener("submit", (e) => { e.preventDefault(); addItem(e.target); });

    $("#projectSelect").addEventListener("change", (e) => { store.currentId = e.target.value; saveStore(); render(); });
    $("#projectName").addEventListener("change", (e) => {
      project().name = e.target.value.trim() || "本計畫";
      commit();
    });
    $("#btnNew").addEventListener("click", () => {
      const name = prompt("新專案（計畫）名稱：", "新計畫");
      if (!name) return;
      const p = newProject(name.trim());
      store.projects[p.id] = p; store.currentId = p.id; commit();
    });
    $("#btnCopy").addEventListener("click", () => {
      const cur = project();
      const p = newProject(cur.name + "（複本）", JSON.parse(JSON.stringify(cur.items)));
      store.projects[p.id] = p; store.currentId = p.id; commit();
      toast("已複製成新專案");
    });
    $("#btnDelete").addEventListener("click", () => {
      const cur = project();
      if (!confirm(`確定要刪除專案「${cur.name}」嗎？刪除後無法復原（建議先「匯出專案檔」備份）。`)) return;
      delete store.projects[cur.id];
      if (!Object.keys(store.projects).length) { const p = newProject("本計畫"); store.projects[p.id] = p; }
      store.currentId = Object.keys(store.projects)[0];
      commit();
    });

    $("#btnTemplate").addEventListener("click", () => {
      const tpl = Core.listTemplates()[0];
      if (project().items.length && !confirm(`這會用「${tpl.label}」標準範本取代目前所有工作項目，確定要帶入嗎？`)) return;
      const items = Core.getTemplate(tpl.key).map((it, i) => Object.assign(it, { id: i + 1 }));
      project().items = items; project().next_id = items.length + 1;
      commit();
    });
    $("#btnClear").addEventListener("click", () => {
      if (!confirm("確定要清空所有工作項目嗎？")) return;
      project().items = []; commit();
    });

    $("#btnExcel").addEventListener("click", () => {
      const p = project();
      if (!scheduled.length) return toast("請先新增工作項目");
      Exporter.download(Exporter.buildXlsx(p.name, scheduled), `${safeName(p.name)}_工程預定進度表.xlsx`);
    });
    $("#btnWord").addEventListener("click", () => {
      const p = project();
      if (!scheduled.length) return toast("請先新增工作項目");
      const g = Charts.renderGantt(scheduled, p.name), d = Charts.renderPdm(scheduled, p.name);
      Exporter.download(Exporter.buildDocx(p.name, scheduled, g, d), `${safeName(p.name)}_工程預定進度說明.docx`);
    });
    $("#btnPng").addEventListener("click", () => {
      const p = project();
      Charts.renderGantt(scheduled, p.name).toBlob((b) => Exporter.download(b, `${safeName(p.name)}_甘特圖.png`));
    });
    $("#btnPdmPng").addEventListener("click", () => {
      const p = project();
      Charts.renderPdm(scheduled, p.name).toBlob((b) => Exporter.download(b, `${safeName(p.name)}_要徑網圖.png`));
    });

    $("#btnExportJson").addEventListener("click", () => {
      const p = project();
      const data = { format: "engineering-schedule", version: 1, name: p.name, items: p.items, next_id: p.next_id };
      Exporter.download(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }), `${safeName(p.name)}.排程.json`);
    });
    $("#btnImportJson").addEventListener("click", () => $("#fileInput").click());
    $("#fileInput").addEventListener("change", async (e) => {
      const files = [...e.target.files];
      e.target.value = "";
      let last = null;
      for (const f of files) {
        try {
          const data = JSON.parse(await f.text());
          const list = Array.isArray(data.projects) ? data.projects : [data];
          for (const d of list) {
            if (!Array.isArray(d.items)) throw new Error("格式不符");
            const p = newProject(d.name || f.name.replace(/\.json$/i, ""), d.items);
            store.projects[p.id] = p; last = p;
          }
        } catch (err) {
          toast(`「${f.name}」不是有效的排程專案檔`);
        }
      }
      if (last) { store.currentId = last.id; commit(); toast(`已匯入「${last.name}」`); }
    });
  }

  bind();
  render();
  if (!storageOk) toast("此瀏覽器無法保存資料，關閉頁面前請先「匯出專案檔」");
})();
