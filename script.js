/* 听书人物查询 v3 — 模块化重构 */
import { STORE, FIELDS, FULL_FIELDS } from './constants.js';
import { esc, hlMark } from './utils.js';
import { lsGet, lsSet, lsGetArr, lsSetArr } from './storage.js';
import { buildPrompt, parseResponse, callAI, testConnection } from './ai.js';
import { saveHistory, delHistory } from './history.js';
import { GraphManager, fetchGraph } from './graph.js';

'use strict';

// ─── 工具 ────────────────────────────────────────────────────────────────────

function $(id) { return document.getElementById(id); }

// ─── 设置面板 ─────────────────────────────────────────────────────────────────

function loadSettings() {
  $('cfgUrl').value   = lsGet(STORE.URL);
  $('cfgKey').value   = lsGet(STORE.KEY);
  $('cfgModel').value = lsGet(STORE.MODEL);
}

$('btnSettings').addEventListener('click', function () {
  var hdr  = $('header');
  var pnl  = $('panelSettings');
  pnl.style.top = (hdr.offsetTop + hdr.offsetHeight + 4) + 'px';
  var open = pnl.classList.toggle('open');
  $('btnSettings').classList.toggle('active', open);
});

document.addEventListener('click', function (e) {
  var pnl = $('panelSettings');
  if (pnl.classList.contains('open') &&
      !pnl.contains(e.target) &&
      !$('btnSettings').contains(e.target)) {
    pnl.classList.remove('open');
    $('btnSettings').classList.remove('active');
  }
});

$('btnSaveSettings').addEventListener('click', function () {
  lsSet(STORE.URL,   $('cfgUrl').value.trim());
  lsSet(STORE.KEY,   $('cfgKey').value.trim());
  lsSet(STORE.MODEL, $('cfgModel').value.trim());
  $('saveOk').textContent = '✓ 已保存';
  setTimeout(function () { $('saveOk').textContent = ''; }, 2000);
});

$('btnTestApi').addEventListener('click', async function () {
  const btn = $('btnTestApi');
  const status = $('testStatus');
  
  const config = {
    url: $('cfgUrl').value.trim(),
    key: $('cfgKey').value.trim(),
    model: $('cfgModel').value.trim()
  };

  if (!config.url || !config.key || !config.model) {
    status.className = 'test-status err';
    status.textContent = '请填写完整配置';
    return;
  }

  btn.disabled = true;
  status.className = 'test-status';
  status.textContent = '测试中...';

  try {
    await testConnection(config);
    status.className = 'test-status ok';
    status.textContent = '✓ 连接成功';
  } catch (err) {
    status.className = 'test-status err';
    status.textContent = '✗ ' + err.message;
    console.error('API Test Failed:', err);
  } finally {
    btn.disabled = false;
  }
});

// ─── 结果显示 ─────────────────────────────────────────────────────────────────

function showResult(item) {
  $('rName').textContent  = item.person || '';
  $('rNovel').textContent = '《' + (item.novel || '') + '》';
  var grid = $('rGrid');
  grid.innerHTML = '';
  FIELDS.forEach(function (f) {
    var d = document.createElement('div');
    d.className = 'rfield' + (FULL_FIELDS.has(f.key) ? ' full' : '');
    d.innerHTML = '<div class="rkey">' + esc(f.label) + '</div>'
                + '<div class="rval">' + esc(item[f.key] || '—') + '</div>';
    grid.appendChild(d);
  });
  $('result').style.display = '';
  window._lastResult = item;
}

// ─── 复制 ────────────────────────────────────────────────────────────────────

$('btnCopy').addEventListener('click', function () {
  var d = window._lastResult;
  if (!d) return;
  var text = '【' + d.novel + '】' + d.person + '\n'
    + FIELDS.map(function (f) { return f.label + '：' + (d[f.key] || '—'); }).join('\n');
  navigator.clipboard.writeText(text).then(function () {
    $('btnCopy').textContent = '✓ 已复制';
    setTimeout(function () {
      $('btnCopy').innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> 复制';
    }, 1800);
  }).catch(function () { alert('复制失败'); });
});

// ─── 历史记录 ─────────────────────────────────────────────────────────────────

function renderHistory() {
  var q    = ($('inpSearch').value || '').trim();
  var lq   = q.toLowerCase();
  var list = lsGetArr(STORE.HISTORY);
  var hits = q
    ? list.filter(function (x) { return ((x.novel || '') + ' ' + (x.person || '')).toLowerCase().indexOf(lq) >= 0; })
    : list;

  var box = $('histList');
  box.innerHTML = '';

  if (!hits.length) {
    var e = document.createElement('div');
    e.className = 'hist-empty';
    e.textContent = q ? '没有匹配的记录' : '暂无历史记录';
    box.appendChild(e);
    return;
  }

  hits.forEach(function (item) {
    var card = document.createElement('div');
    card.className = 'hitem';

    var head = document.createElement('div');
    head.className = 'hhead';
    head.innerHTML = '<div class="hdot"></div>'
      + '<div class="hname">' + hlMark(item.person, q) + '</div>'
      + '<div class="htag">'  + hlMark(item.novel,  q) + '</div>'
      + '<button class="hdel" title="删除">×</button>';

    var body = document.createElement('div');
    body.className = 'hbody';
    var bhtml = item.snippet ? '<div class="hkv"><b>描述：</b>' + esc(item.snippet) + '</div>' : '';
    FIELDS.forEach(function (f) {
      bhtml += '<div class="hkv"><b>' + esc(f.label) + '：</b>' + esc(item[f.key] || '—') + '</div>';
    });
    body.innerHTML = bhtml;

    head.addEventListener('click', function (e) {
      if (e.target.classList.contains('hdel')) return;
      card.classList.toggle('open');
      $('inpNovel').value   = item.novel   || '';
      $('inpPerson').value  = item.person  || '';
      $('inpSnippet').value = item.snippet || '';
      lsSet(STORE.NOVEL, item.novel || '');
      showResult(item);
    });

    head.querySelector('.hdel').addEventListener('click', function (e) {
      e.stopPropagation();
      if (confirm('删除「' + item.person + '」的记录？')) { delHistory(item.id); renderHistory(); }
    });

    card.appendChild(head);
    card.appendChild(body);
    box.appendChild(card);
  });
}

$('inpSearch').addEventListener('input', renderHistory);

$('btnExport').addEventListener('click', function () {
  var list = lsGetArr(STORE.HISTORY);
  if (!list.length) { alert('暂无历史记录'); return; }
  var text = list.map(function (item) {
    return '【' + item.novel + '】' + item.person + '\n'
      + FIELDS.map(function (f) { return '  ' + f.label + '：' + (item[f.key] || '—'); }).join('\n');
  }).join('\n\n');
  var a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  a.download = '听书人物记录.txt';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
});

$('btnClearAll').addEventListener('click', function () {
  var list = lsGetArr(STORE.HISTORY);
  if (!list.length) { alert('暂无历史记录'); return; }
  if (confirm('确定清空全部 ' + list.length + ' 条记录？')) { lsSetArr(STORE.HISTORY, []); renderHistory(); }
});

// ─── 查询主流程 ───────────────────────────────────────────────────────────────

var busy = false;

async function onQuery() {
  if (busy) return;

  var novel   = $('inpNovel').value.trim();
  var person  = $('inpPerson').value.trim();
  var snippet = $('inpSnippet').value.trim();

  // 校验
  if (!novel) { alert('请输入小说名'); $('inpNovel').focus(); return; }
  if (!person && !snippet) { alert('请输入人物名，或在描述框中描述人物特征'); $('inpSnippet').focus(); return; }

  // 检查 API 配置
  const config = {
    url: lsGet(STORE.URL),
    key: lsGet(STORE.KEY),
    model: lsGet(STORE.MODEL)
  };

  if (!config.url || !config.key || !config.model) {
    // 打开设置面板
    var hdr = $('header');
    var pnl = $('panelSettings');
    pnl.style.top = (hdr.offsetTop + hdr.offsetHeight + 4) + 'px';
    pnl.classList.add('open');
    $('btnSettings').classList.add('active');
    alert('请先填写 API 设置（地址、Key、模型）');
    return;
  }

  busy = true;
  $('btnQuery').disabled = true;
  var st = $('status');
  st.textContent = person ? 'AI 查询中…' : 'AI 识别人物中…';
  st.className = 'status spin';
  lsSet(STORE.NOVEL, novel);

  try {
    var raw    = await callAI(novel, person, snippet, config);
    console.log('AI Response:', raw);
    var parsed = parseResponse(raw, person);
    console.log('Parsed Response:', parsed);

    var finalPerson = person || parsed._person || '未知人物';
    delete parsed._person;

    var item = Object.assign({ novel: novel, person: finalPerson, snippet: snippet }, parsed);

    if (!person && finalPerson !== '未知人物') $('inpPerson').value = finalPerson;

    showResult(item);
    saveHistory(item);
    renderHistory();

    st.textContent = '✓ 完成';
    st.className = 'status';
    setTimeout(function () { st.textContent = ''; }, 2500);

  } catch (err) {
    console.error('Query Error:', err);
    var msg = '查询失败，请重试';
    if      (err.message === 'NO_URL')      msg = '请先在设置中填写 API 地址';
    else if (err.message === 'NO_KEY')      msg = '请先在设置中填写 API Key';
    else if (err.message === 'NO_MODEL')    msg = '请先在设置中填写模型名称';
    else if (err.message === 'NO_CONTENT')  msg = 'API 没有返回内容，请检查模型和 Key 是否正确';
    else if (err.message === 'PARSE_FAIL')  msg = 'AI 返回格式不对，请重试';
    else if (err.message.startsWith('HTTP_')) msg = 'API 错误（' + err.message + '），请检查地址和 Key';
    else if (err.name === 'TypeError')      msg = '网络请求失败：' + err.message;
    alert(msg);
    st.textContent = '';
    st.className = 'status';
  } finally {
    busy = false;
    $('btnQuery').disabled = false;
  }
}

$('btnQuery').addEventListener('click', onQuery);
$('inpPerson').addEventListener('keydown', function (e) { if (e.key === 'Enter') onQuery(); });

// ─── 关系图谱 ─────────────────────────────────────────────────────────────────

(function () {
  var modal   = $('modalGraph');
  var canvas  = $('graphCanvas');
  var loading = $('graphLoading');
  var title   = $('graphTitle');

  const gm = new GraphManager(canvas);

  $('btnShowGraph').addEventListener('click', async function () {
    var item = window._lastResult;
    if (!item) { alert('请先查询一个人物'); return; }
    
    modal.classList.add('open');
    loading.style.display = 'flex';
    canvas.style.display = 'none';
    title.textContent = '《' + item.novel + '》人物图谱：' + item.person;
    
    gm.stopLoop();
    
    // 确保 canvas 尺寸正确
    const box = canvas.parentElement;
    canvas.width = box.clientWidth;
    canvas.height = box.clientHeight - 40; // 减去头部高度

    gm.nodes = []; gm.edges = []; gm.draw();

    try {
      var data = await fetchGraph(item.novel, item.person);
      console.log('Graph Data:', data);
      canvas.style.display = 'block';
      gm.init(data, item.person);
      gm.loop();
    } catch (e) {
      console.error('Graph Error:', e);
      alert('图谱生成失败：' + e.message);
      modal.classList.remove('open');
    } finally {
      loading.style.display = 'none';
    }
  });

  $('btnCloseGraph').addEventListener('click', function () {
    modal.classList.remove('open');
    gm.stopLoop();
  });

  canvas.addEventListener('mousedown', function (e) {
    var rect = canvas.getBoundingClientRect();
    var x = (e.clientX - rect.left) * (canvas.width / rect.width);
    var y = (e.clientY - rect.top) * (canvas.height / rect.height);
    var n = gm.nodeAt(x, y);
    if (n) { gm.drag = n; gm.dox = n.x - x; gm.doy = n.y - y; }
  });

  window.addEventListener('mousemove', function (e) {
    if (!gm.drag) return;
    var rect = canvas.getBoundingClientRect();
    gm.drag.x = (e.clientX - rect.left) * (canvas.width / rect.width) + gm.dox;
    gm.drag.y = (e.clientY - rect.top) * (canvas.height / rect.height) + gm.doy;
  });

  window.addEventListener('mouseup', function () { gm.drag = null; });
})();

// ─── 初始化 ───────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', function () {
  loadSettings();
  renderHistory();
  $('inpNovel').value = lsGet(STORE.NOVEL);
});
