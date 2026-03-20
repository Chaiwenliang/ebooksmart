// script.js — 听书人物查询助手 v2
// 功能：自定义 API Key/地址/模型；5个查询字段；复制/删除/清空/导出历史
(() => {

  // ============ Storage Keys ============
  const K = {
    NOVEL:     'tnbq_novel_v2',
    HISTORY:   'tnbq_history_v2',
    API_URL:   'tnbq_api_url_v2',
    API_KEY:   'tnbq_api_key_v2',
    API_MODEL: 'tnbq_api_model_v2',
  };
  const DEFAULT_URL   = 'https://api.openai.com/v1/chat/completions';
  const DEFAULT_MODEL = 'gpt-4o-mini';

  // ============ Query Fields Definition ============
  // 5 fields: first 4 shown in 2-col grid, last one full-width
  const FIELDS = [
    { key: 'firstAppearance', label: '首次出场' },
    { key: 'relation',        label: '与主角关系' },
    { key: 'faction',         label: '阵营' },
    { key: 'ability',         label: '主要能力' },
    { key: 'events',          label: '关键事件' },
  ];
  const FULL_WIDTH_KEYS = new Set(['events']); // these get full-width display

  // ============ DOM ============
  const $ = id => document.getElementById(id);
  const novelInput         = $('novelInput');
  const personInput        = $('personInput');
  const snippetInput       = $('snippetInput');
  const queryBtn           = $('queryBtn');
  const statusText         = $('statusText');
  const resultBox          = $('resultBox');
  const resultName         = $('resultName');
  const resultNovelTag     = $('resultNovelTag');
  const resultFields       = $('resultFields');
  const copyBtn            = $('copyBtn');
  const historySearchInput = $('historySearchInput');
  const historyList        = $('historyList');
  const settingsToggle     = $('settingsToggle');
  const settingsPanel      = $('settingsPanel');
  const apiUrlInput        = $('apiUrlInput');
  const apiKeyInput        = $('apiKeyInput');
  const apiModelInput      = $('apiModelInput');
  const saveSettingsBtn    = $('saveSettingsBtn');
  const settingsSaved      = $('settingsSaved');
  const exportBtn          = $('exportBtn');
  const clearAllBtn        = $('clearAllBtn');

  let isBusy = false;
  let lastResult = null; // for copy button

  // ============ localStorage helpers ============
  function lsGet(key) {
    try { return localStorage.getItem(key) || ''; } catch { return ''; }
  }
  function lsSet(key, val) {
    try { localStorage.setItem(key, String(val || '')); } catch {}
  }
  function lsGetJson(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }
  function lsSetJson(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
  }

  // ============ Util ============
  function escHtml(s) {
    return (s || '')
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function highlight(text, q) {
    const t = text || '';
    if (!q) return escHtml(t);
    const idx = t.toLowerCase().indexOf(q.toLowerCase());
    if (idx < 0) return escHtml(t);
    return escHtml(t.slice(0, idx))
      + `<mark>${escHtml(t.slice(idx, idx + q.length))}</mark>`
      + escHtml(t.slice(idx + q.length));
  }

  function setStatus(msg, loading = false) {
    statusText.textContent = msg;
    statusText.className = 'status-txt' + (loading ? ' loading' : '');
  }

  // ============ Settings ============
  function loadSettings() {
    apiUrlInput.value   = lsGet(K.API_URL)   || DEFAULT_URL;
    apiKeyInput.value   = lsGet(K.API_KEY);
    apiModelInput.value = lsGet(K.API_MODEL) || DEFAULT_MODEL;
  }

  function saveSettings() {
    lsSet(K.API_URL,   apiUrlInput.value.trim()   || DEFAULT_URL);
    lsSet(K.API_KEY,   apiKeyInput.value.trim());
    lsSet(K.API_MODEL, apiModelInput.value.trim() || DEFAULT_MODEL);
    settingsSaved.textContent = '✓ 已保存';
    setTimeout(() => { settingsSaved.textContent = ''; }, 2000);
  }

  settingsToggle.addEventListener('click', () => {
    const header = document.getElementById('mainHeader');
    // Position panel just below the header, accounting for header margin/padding
    settingsPanel.style.top = (header.offsetHeight + 4) + 'px';
    const open = settingsPanel.classList.toggle('open');
    settingsToggle.classList.toggle('active', open);
  });

  // Close settings panel when clicking outside
  document.addEventListener('click', e => {
    if (settingsPanel.classList.contains('open') &&
        !settingsPanel.contains(e.target) &&
        !settingsToggle.contains(e.target)) {
      settingsPanel.classList.remove('open');
      settingsToggle.classList.remove('active');
    }
  });
  saveSettingsBtn.addEventListener('click', saveSettings);

  // ============ History CRUD ============
  function loadHistory() {
    return lsGetJson(K.HISTORY) || [];
  }

  function saveHistoryAll(list) {
    lsSetJson(K.HISTORY, list);
  }

  function upsertHistory(item) {
    const list = loadHistory();
    const key = `${(item.novel||'').trim().toLowerCase()}__${(item.person||'').trim().toLowerCase()}`;
    const idx = list.findIndex(x =>
      `${(x.novel||'').trim().toLowerCase()}__${(x.person||'').trim().toLowerCase()}` === key
    );
    const now = new Date().toISOString();
    if (idx >= 0) {
      list[idx] = { ...list[idx], ...item, updatedAt: now };
    } else {
      list.unshift({
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        createdAt: now,
        updatedAt: now,
        ...item,
      });
    }
    list.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    saveHistoryAll(list);
  }

  function deleteHistoryById(id) {
    saveHistoryAll(loadHistory().filter(x => x.id !== id));
  }

  // ============ AI Prompt & Parse ============
  function buildPrompt(novel, person, snippet) {
    const snippetLine = snippet ? `\n参考片段：${snippet}` : '';
    const fieldLines  = FIELDS.map(f => `${f.label}：xxx`).join('\n');
    return `用户正在听有声小说《${novel}》。${snippetLine}\n请查询人物【${person}】，严格只返回以下 ${FIELDS.length} 行，不要多余内容：\n${fieldLines}`;
  }

  function parseAiResult(text) {
    const lines = (text || '').trim()
      .split(/\r?\n/)
      .map(l => l.trim())
      .filter(Boolean);

    const result = {};
    for (const line of lines) {
      for (const f of FIELDS) {
        if (line.startsWith(f.label)) {
          const colon = line.indexOf('：') >= 0 ? line.indexOf('：') : line.indexOf(':');
          if (colon >= 0) {
            const val = line.slice(colon + 1).trim();
            if (val) result[f.key] = val;
          }
        }
      }
    }
    // Require at least one field to be filled
    if (Object.keys(result).length === 0) throw new Error('PARSE_FAIL');
    return result;
  }

  async function callAi(novel, person, snippet) {
    const url   = lsGet(K.API_URL)   || DEFAULT_URL;
    const key   = lsGet(K.API_KEY);
    const model = lsGet(K.API_MODEL) || DEFAULT_MODEL;

    if (!key) throw new Error('NO_KEY');

    const ctrl    = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 20000);

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${key}`,
        },
        body: JSON.stringify({
          model,
          temperature: 0.3,
          max_tokens:  400,
          messages: [{ role: 'user', content: buildPrompt(novel, person, snippet) }],
        }),
        signal: ctrl.signal,
      });

      if (!res.ok) throw new Error(`HTTP_${res.status}`);

      const data    = await res.json();
      const content = data?.choices?.[0]?.message?.content;
      if (typeof content !== 'string') throw new Error('NO_CONTENT');
      return content;
    } finally {
      clearTimeout(timeout);
    }
  }

  // ============ Result Display ============
  function showResult(data) {
    resultName.textContent    = data.person || '';
    resultNovelTag.textContent = `《${data.novel || ''}》`;
    resultFields.innerHTML    = '';

    FIELDS.forEach(f => {
      const val  = data[f.key] || '—';
      const div  = document.createElement('div');
      div.className = 'res-field' + (FULL_WIDTH_KEYS.has(f.key) ? ' full' : '');
      div.innerHTML = `<div class="res-key">${escHtml(f.label)}</div>`
                    + `<div class="res-val">${escHtml(val)}</div>`;
      resultFields.appendChild(div);
    });

    resultBox.style.display = '';
    lastResult = data;
  }

  // ============ Copy Button ============
  copyBtn.addEventListener('click', () => {
    if (!lastResult) return;
    const header = `【${lastResult.novel}】${lastResult.person}`;
    const body   = FIELDS.map(f => `${f.label}：${lastResult[f.key] || '—'}`).join('\n');
    const text   = `${header}\n${body}`;

    navigator.clipboard.writeText(text)
      .then(() => {
        const orig = copyBtn.innerHTML;
        copyBtn.textContent = '✓ 已复制';
        setTimeout(() => { copyBtn.innerHTML = orig; }, 1800);
      })
      .catch(() => { alert('复制失败，请手动选取文字'); });
  });

  // ============ History Render ============
  function renderHistory() {
    const q      = (historySearchInput.value || '').trim();
    const lq     = q.toLowerCase();
    const list   = loadHistory();
    const hits   = q
      ? list.filter(x => `${x.novel || ''} ${x.person || ''}`.toLowerCase().includes(lq))
      : list;

    historyList.innerHTML = '';

    if (hits.length === 0) {
      const el = document.createElement('div');
      el.className   = 'hist-empty';
      el.textContent = q ? '没有匹配的记录' : '暂无历史记录';
      historyList.appendChild(el);
      return;
    }

    for (const item of hits) {
      const card = document.createElement('div');
      card.className = 'hist-item';

      // Head
      const head = document.createElement('div');
      head.className = 'hist-head';
      head.innerHTML = `
        <div class="hist-dot"></div>
        <div class="hist-name">${highlight(item.person, q)}</div>
        <div class="hist-novel-tag">${highlight(item.novel, q)}</div>
        <button class="hist-del" title="删除此记录">×</button>
      `;

      // Body
      const body = document.createElement('div');
      body.className = 'hist-body';
      let bodyHtml = '';
      if (item.snippet) {
        bodyHtml += `<div class="hist-kv"><b>片段：</b>${escHtml(item.snippet)}</div>`;
      }
      FIELDS.forEach(f => {
        bodyHtml += `<div class="hist-kv"><b>${escHtml(f.label)}：</b>${escHtml(item[f.key] || '—')}</div>`;
      });
      body.innerHTML = bodyHtml;

      // Click head → toggle + backfill
      head.addEventListener('click', e => {
        if (e.target.classList.contains('hist-del')) return;
        card.classList.toggle('open');
        // backfill inputs
        novelInput.value   = item.novel   || '';
        personInput.value  = item.person  || '';
        snippetInput.value = item.snippet || '';
        lsSet(K.NOVEL, item.novel || '');
        showResult(item);
      });

      // Delete button
      head.querySelector('.hist-del').addEventListener('click', e => {
        e.stopPropagation();
        if (confirm(`删除「${item.person}」的历史记录？`)) {
          deleteHistoryById(item.id);
          renderHistory();
        }
      });

      card.appendChild(head);
      card.appendChild(body);
      historyList.appendChild(card);
    }
  }

  // ============ Export ============
  exportBtn.addEventListener('click', () => {
    const list = loadHistory();
    if (list.length === 0) { alert('暂无历史记录可导出'); return; }
    const lines = list.map(item => {
      const header = `【${item.novel}】${item.person}`;
      const body   = FIELDS.map(f => `  ${f.label}：${item[f.key] || '—'}`).join('\n');
      return `${header}\n${body}`;
    });
    const blob = new Blob([lines.join('\n\n')], { type: 'text/plain;charset=utf-8' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = '听书人物记录.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });

  // ============ Clear All ============
  clearAllBtn.addEventListener('click', () => {
    const list = loadHistory();
    if (list.length === 0) { alert('暂无历史记录'); return; }
    if (confirm(`确定清空全部 ${list.length} 条历史记录？此操作不可恢复。`)) {
      saveHistoryAll([]);
      renderHistory();
    }
  });

  // ============ Query ============
  async function onQuery() {
    if (isBusy) return;

    const novel   = novelInput.value.trim();
    const person  = personInput.value.trim();
    const snippet = snippetInput.value.trim();

    if (!novel)  { alert('请输入小说名'); novelInput.focus();  return; }
    if (!person) { alert('请输入人物名'); personInput.focus(); return; }

    const apiKey = lsGet(K.API_KEY);
    if (!apiKey) {
      const header = document.getElementById('mainHeader');
      settingsPanel.style.top = (header.offsetHeight + 4) + 'px';
      settingsPanel.classList.add('open');
      settingsToggle.classList.add('active');
      alert('请先在上方"API 设置"中填写 API Key');
      return;
    }

    isBusy = true;
    queryBtn.disabled = true;
    setStatus('AI 查询中…', true);
    lsSet(K.NOVEL, novel);

    try {
      const content = await callAi(novel, person, snippet);
      const parsed  = parseAiResult(content);
      const data    = { novel, person, snippet, ...parsed };

      showResult(data);
      upsertHistory(data);
      renderHistory();
      setStatus('✓ 查询完成');
      setTimeout(() => setStatus(''), 2500);

    } catch (e) {
      let msg = '查询失败';
      if (e.message === 'NO_KEY')      msg = '未填写 API Key，请先在设置中填写';
      else if (e.message === 'PARSE_FAIL') msg = 'AI 返回格式异常，请重试';
      else if (e.name   === 'AbortError')  msg = '请求超时，请检查网络';
      else if (e.message.startsWith('HTTP_')) msg = `API 错误（${e.message}），请检查 Key 和地址`;
      alert(msg);
      setStatus('');
    } finally {
      isBusy            = false;
      queryBtn.disabled = false;
    }
  }

  queryBtn.addEventListener('click', onQuery);
  personInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') onQuery();
  });
  historySearchInput.addEventListener('input', renderHistory);

  // ============ Init ============
  loadSettings();
  novelInput.value = lsGet(K.NOVEL);
  renderHistory();

})();
