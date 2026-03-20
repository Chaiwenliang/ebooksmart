// script.js：弹窗逻辑（原生 HTML/CSS/JS，无任何框架）
// 功能：只输入“小说名（记住一次）+ 人名”，点击按钮后调用 AI 查询 3 行结果并展示；同时本地保存历史记录（可搜索）
// 说明：纯本地工具，不读取网页内容，不抓文本。

(() => {
  // ========= localStorage key（持久化，关闭浏览器不丢失） =========
  const KEY_NOVEL_NAME = "audio_novel_helper__novel_name_v1";
  const KEY_HISTORY = "audio_novel_helper__history_v1";

  // ========= 已指定并要求“写死”的 AI API 信息（无需用户配置） =========
  const AI_API_URL = "https://code-api.x-aio.ai/v1/chat/completions";
  const AI_API_KEY = "sk-60b6b2dcd29a408d9cf64a54010";
  const AI_MODEL_NAME = "DeepSeek-V3.2";
  const AI_TEMPERATURE = 0.3;

  /** @type {HTMLInputElement} */
  const novelInput = document.getElementById("novelInput");
  /** @type {HTMLInputElement} */
  const personInput = document.getElementById("personInput");
  /** @type {HTMLTextAreaElement} */
  const snippetInput = document.getElementById("snippetInput");
  /** @type {HTMLButtonElement} */
  const queryBtn = document.getElementById("queryBtn");
  /** @type {HTMLDivElement} */
  const statusText = document.getElementById("statusText");
  /** @type {HTMLDivElement} */
  const resultText = document.getElementById("resultText");
  /** @type {HTMLInputElement} */
  const historySearchInput = document.getElementById("historySearchInput");
  /** @type {HTMLDivElement} */
  const historyList = document.getElementById("historyList");

  let isBusy = false;

  function nowIso() {
    return new Date().toISOString();
  }

  function normalize(str) {
    return (str || "").trim().toLowerCase();
  }

  function setStatus(text) {
    statusText.textContent = text || "";
  }

  function escapeHtml(text) {
    return (text || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  // ========= 小说名：本地记住，下次自动填 =========
  function loadNovelName() {
    try {
      return (localStorage.getItem(KEY_NOVEL_NAME) || "").trim();
    } catch (e) {
      return "";
    }
  }

  function saveNovelName(name) {
    try {
      localStorage.setItem(KEY_NOVEL_NAME, (name || "").trim());
    } catch (e) {
      // 忽略：不影响查询与展示
    }
  }

  // ========= 历史记录：纯本地保存 =========
  function loadHistory() {
    try {
      const raw = localStorage.getItem(KEY_HISTORY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed;
    } catch (e) {
      return [];
    }
  }

  function saveHistory(list) {
    try {
      localStorage.setItem(KEY_HISTORY, JSON.stringify(list));
    } catch (e) {
      // 忽略：不影响当前结果展示
    }
  }

  function upsertHistory(item) {
    const list = loadHistory();
    const key = `${normalize(item.novel)}__${normalize(item.person)}`;
    const idx = list.findIndex((x) => `${normalize(x.novel)}__${normalize(x.person)}` === key);
    if (idx >= 0) {
      list[idx] = { ...list[idx], ...item, updatedAt: nowIso() };
    } else {
      list.push({
        id: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
        createdAt: nowIso(),
        updatedAt: nowIso(),
        ...item,
      });
    }
    // 最新的放前面
    list.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
    saveHistory(list);
  }

  function highlight(text, query) {
    const t = text || "";
    const q = (query || "").trim();
    if (!q) return escapeHtml(t);
    const lt = t.toLowerCase();
    const lq = q.toLowerCase();
    const idx = lt.indexOf(lq);
    if (idx < 0) return escapeHtml(t);
    const before = escapeHtml(t.slice(0, idx));
    const hit = escapeHtml(t.slice(idx, idx + q.length));
    const after = escapeHtml(t.slice(idx + q.length));
    return `${before}<mark>${hit}</mark>${after}`;
  }

  // ========= UI：历史列表渲染 + 点击回填 =========
  function buildHistoryCard(item, query) {
    const card = document.createElement("div");
    card.className = "item-card";

    const header = document.createElement("div");
    header.className = "item-card__header";

    const nameEl = document.createElement("div");
    nameEl.className = "item-card__name";
    nameEl.innerHTML = highlight(item.person, query);

    const badge = document.createElement("div");
    badge.className = "item-card__badge";
    badge.textContent = "点击查看";

    header.appendChild(nameEl);
    header.appendChild(badge);

    const details = document.createElement("div");
    details.className = "item-card__details";
    details.innerHTML = `
      <div class="kv"><b>小说：</b>${escapeHtml(item.novel || "")}</div>
      ${
        item.snippet
          ? `<div class="kv"><b>片段：</b>${escapeHtml(item.snippet)}</div>`
          : `<div class="kv"><b>片段：</b><span class="muted">（未提供）</span></div>`
      }
      <div class="kv"><b>首次出场：</b>${escapeHtml(item.firstAppearance || "")}</div>
      <div class="kv"><b>与主角关系：</b>${escapeHtml(item.relation || "")}</div>
      <div class="kv"><b>关键事件：</b>${escapeHtml(item.events || "")}</div>
    `;

    header.addEventListener("click", () => {
      // 1) 展开/收起
      card.classList.toggle("expanded");
      // 2) 同时把这条记录展示到“结果区”，并回填输入框，方便再次查询
      novelInput.value = item.novel || "";
      personInput.value = item.person || "";
      snippetInput.value = item.snippet || "";
      saveNovelName(novelInput.value);
      showResult({
        novel: item.novel,
        person: item.person,
        firstAppearance: item.firstAppearance,
        relation: item.relation,
        events: item.events,
      });
    });

    card.appendChild(header);
    card.appendChild(details);
    return card;
  }

  function renderHistory() {
    const q = (historySearchInput.value || "").trim();
    const list = loadHistory();
    const lowerQ = q.toLowerCase();
    const hits = q
      ? list.filter((x) => {
          const hay = `${x.novel || ""} ${x.person || ""}`.toLowerCase();
          return hay.includes(lowerQ);
        })
      : list;

    historyList.innerHTML = "";
    if (hits.length === 0) {
      const empty = document.createElement("div");
      empty.className = "muted";
      empty.textContent = q ? "没有匹配的历史记录。" : "暂无历史记录。";
      historyList.appendChild(empty);
      return;
    }

    for (const item of hits) {
      historyList.appendChild(buildHistoryCard(item, q));
    }
  }

  // ========= 结果展示 =========
  function showResult(r) {
    const lines = [
      `首次出场：${r.firstAppearance || ""}`,
      `与主角关系：${r.relation || ""}`,
      `关键事件：${r.events || ""}`,
    ];
    resultText.classList.remove("muted");
    resultText.textContent = lines.join("\n");
  }

  function showEmptyResult() {
    resultText.classList.add("muted");
    resultText.textContent = "暂无结果。请输入小说名与人物名后点击“AI查询人物”。";
  }

  // ========= AI 提示词（固定）+ 解析（严格 3 行） =========
  function buildAiPrompt(novelName, personName, snippet) {
    // 在“固定提示词”基础上：若用户提供片段，则作为额外上下文，帮助更精准检索人物信息
    const s = (snippet || "").trim();
    const snippetLine = s ? `\n补充片段：${s}` : "";
    return `用户正在听有声小说《${novelName}》，${snippetLine}\n请你在这部小说中，查询人物【${personName}】的信息，严格只返回3行，不要多余内容：\n首次出场：第xx回\n与主角关系：xxx\n关键事件：xxx`;
  }

  function parseAi3Lines(text) {
    const raw = (text || "").trim();
    if (!raw) throw new Error("EMPTY");

    // 允许模型返回 \r\n 或 \n；同时忽略多余空行，但最终必须恰好 3 行
    const lines = raw
      .split(/\r?\n/)
      .map((x) => x.trim())
      .filter((x) => x.length > 0);

    if (lines.length !== 3) throw new Error("NOT_3_LINES");

    // 支持中文冒号“：”与英文冒号“:”
    function cutValue(line, prefix) {
      if (!line.startsWith(prefix)) throw new Error("PREFIX");
      const idx = line.indexOf("：") >= 0 ? line.indexOf("：") : line.indexOf(":");
      if (idx < 0) throw new Error("NO_COLON");
      const v = line.slice(idx + 1).trim();
      if (!v) throw new Error("EMPTY_VALUE");
      return v;
    }

    return {
      firstAppearance: cutValue(lines[0], "首次出场"),
      relation: cutValue(lines[1], "与主角关系"),
      events: cutValue(lines[2], "关键事件"),
      raw: lines.join("\n"),
    };
  }

  async function callAiApi(novelName, personName, snippet) {
    // 注意：若出现link dead报错，请检查该API接口的网络连通性
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
      const res = await fetch(AI_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${AI_API_KEY}`,
        },
        body: JSON.stringify({
          model: AI_MODEL_NAME,
          temperature: AI_TEMPERATURE,
          messages: [{ role: "user", content: buildAiPrompt(novelName, personName, snippet) }],
        }),
        signal: controller.signal,
      });

      if (!res.ok) throw new Error(`HTTP_${res.status}`);
      const data = await res.json();
      const content =
        data &&
        data.choices &&
        data.choices[0] &&
        data.choices[0].message &&
        data.choices[0].message.content;
      if (typeof content !== "string") throw new Error("NO_CONTENT");
      return content;
    } finally {
      clearTimeout(timeout);
    }
  }

  function ensureInputsOrAlert() {
    const novelName = (novelInput.value || "").trim();
    const personName = (personInput.value || "").trim();
    const snippet = (snippetInput.value || "").trim();
    if (!novelName) {
      alert("请先输入小说名");
      return null;
    }
    if (!personName) {
      alert("请先输入人物名");
      return null;
    }
    return { novelName, personName, snippet };
  }

  async function onQueryClick() {
    if (isBusy) return;
    const v = ensureInputsOrAlert();
    if (!v) return;

    saveNovelName(v.novelName);
    setStatus("AI 查询中…");
    isBusy = true;
    queryBtn.disabled = true;

    try {
      const content = await callAiApi(v.novelName, v.personName, v.snippet);
      const parsed = parseAi3Lines(content);

      showResult({
        novel: v.novelName,
        person: v.personName,
        firstAppearance: parsed.firstAppearance,
        relation: parsed.relation,
        events: parsed.events,
      });

      upsertHistory({
        novel: v.novelName,
        person: v.personName,
        snippet: v.snippet,
        firstAppearance: parsed.firstAppearance,
        relation: parsed.relation,
        events: parsed.events,
        raw: parsed.raw,
      });

      renderHistory();
      setStatus("完成");
    } catch (e) {
      // 按你要求：失败时给出清晰提示，但不影响其他功能使用
      alert("AI查询失败：请检查API接口连通性或密钥有效性");
      setStatus("");
    } finally {
      isBusy = false;
      queryBtn.disabled = false;
    }
  }

  // ========= 事件绑定与初始化 =========
  novelInput.value = loadNovelName();
  if (!novelInput.value) {
    // 没有小说名时保持结果区为空提示
    showEmptyResult();
  }

  novelInput.addEventListener("input", () => {
    // 轻量持久化：用户输入时同步保存，避免忘记
    saveNovelName(novelInput.value);
  });

  queryBtn.addEventListener("click", onQueryClick);
  personInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") onQueryClick();
  });

  // 片段输入框通常需要换行，这里不绑定 Enter 触发查询，避免误触

  historySearchInput.addEventListener("input", () => renderHistory());

  // 初次渲染历史记录
  renderHistory();
})();

