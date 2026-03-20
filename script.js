/* 听书人物查询 v3 — 干净重写 */
'use strict';

// ─── 常量 ────────────────────────────────────────────────────────────────────

const STORE = {
  URL:     'tbq3_url',
  KEY:     'tbq3_key',
  MODEL:   'tbq3_model',
  NOVEL:   'tbq3_novel',
  HISTORY: 'tbq3_history',
};

const FIELDS = [
  { key: 'appear',   label: '首次出场' },
  { key: 'relation', label: '与主角关系' },
  { key: 'faction',  label: '阵营' },
  { key: 'ability',  label: '主要能力' },
  { key: 'events',   label: '关键事件' },
];

const FULL_FIELDS = new Set(['events']);

// ─── 工具 ────────────────────────────────────────────────────────────────────

function $(id) { return document.getElementById(id); }

function esc(s) {
  return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function hlMark(text, q) {
  const t = text || '';
  if (!q) return esc(t);
  const i = t.toLowerCase().indexOf(q.toLowerCase());
  if (i < 0) return esc(t);
  return esc(t.slice(0, i)) + '<mark>' + esc(t.slice(i, i + q.length)) + '</mark>' + esc(t.slice(i + q.length));
}

// ─── 本地存储 ─────────────────────────────────────────────────────────────────

function lsGet(k)       { try { return localStorage.getItem(k) || ''; } catch { return ''; } }
function lsSet(k, v)    { try { localStorage.setItem(k, v || ''); } catch {} }
function lsGetArr(k)    { try { return JSON.parse(localStorage.getItem(k)) || []; } catch { return []; } }
function lsSetArr(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }

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

// ─── AI 请求 ──────────────────────────────────────────────────────────────────

function buildPrompt(novel, person, snippet) {
  var lines = FIELDS.map(function (f) { return f.label + '：xxx'; }).join('\n');
  if (!person && snippet) {
    return '用户正在听有声小说《' + novel + '》，听到了如下描述：\n"' + snippet + '"\n'
      + '请先判断这描述的是哪个人物，第一行输出"人物：xxx"，然后严格只返回以下 ' + FIELDS.length + ' 行，'
      + '共 ' + (FIELDS.length + 1) + ' 行，不要多余内容：\n人物：xxx\n' + lines;
  }
  var snipLine = snippet ? '\n参考片段：' + snippet : '';
  return '用户正在听有声小说《' + novel + '》。' + snipLine + '\n'
    + '请查询人物【' + person + '】，严格只返回以下 ' + FIELDS.length + ' 行，不要多余内容：\n' + lines;
}

function parseResponse(text, knownPerson) {
  // 1. 去掉 <think>...</think> 推理块（Qwen/DeepSeek 思考模型）
  var cleaned = (text || '').replace(/<think>[\s\S]*?<\/think>/gi, '');
  // 2. 去掉 markdown 加粗
  cleaned = cleaned.replace(/\*\*([^*]+)\*\*/g, '$1').trim();

  var lines = cleaned.split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);
  var out = {};

  // 识别人物名（无人名模式）
  if (!knownPerson) {
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].indexOf('人物') >= 0) {
        var ci = lines[i].indexOf('：') >= 0 ? lines[i].indexOf('：') : lines[i].indexOf(':');
        if (ci >= 0) { out._person = lines[i].slice(ci + 1).trim(); break; }
      }
    }
  }

  // 提取各字段
  for (var li = 0; li < lines.length; li++) {
    for (var fi = 0; fi < FIELDS.length; fi++) {
      if (lines[li].indexOf(FIELDS[fi].label) >= 0) {
        var c = lines[li].indexOf('：') >= 0 ? lines[li].indexOf('：') : lines[li].indexOf(':');
        if (c >= 0) {
          var v = lines[li].slice(c + 1).trim();
          if (v) out[FIELDS[fi].key] = v;
        }
      }
    }
  }

  var fieldKeys = Object.keys(out).filter(function (k) { return k !== '_person'; });
  if (fieldKeys.length === 0) throw new Error('PARSE_FAIL');
  return out;
}

async function callAI(novel, person, snippet) {
  var url   = lsGet(STORE.URL);
  var key   = lsGet(STORE.KEY);
  var model = lsGet(STORE.MODEL);

  if (!url)   throw new Error('NO_URL');
  if (!key)   throw new Error('NO_KEY');
  if (!model) throw new Error('NO_MODEL');

  var res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': 'Bearer ' + key,
    },
    body: JSON.stringify({
      model: model,
      temperature: 0.3,
      max_tokens: 500,
      messages: [{ role: 'user', content: buildPrompt(novel, person, snippet) }],
    }),
  });

  if (!res.ok) throw new Error('HTTP_' + res.status);

  var data    = await res.json();
  var content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (!content) throw new Error('NO_CONTENT');
  return content;
}

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

function saveHistory(item) {
  var list = lsGetArr(STORE.HISTORY);
  var key  = (item.novel || '').toLowerCase() + '__' + (item.person || '').toLowerCase();
  var idx  = list.findIndex(function (x) {
    return (x.novel || '').toLowerCase() + '__' + (x.person || '').toLowerCase() === key;
  });
  var now = new Date().toISOString();
  if (idx >= 0) {
    list[idx] = Object.assign({}, list[idx], item, { updatedAt: now });
  } else {
    list.unshift(Object.assign({ id: Date.now() + '_' + Math.random().toString(36).slice(2, 6), createdAt: now }, item, { updatedAt: now }));
  }
  list.sort(function (a, b) { return (b.updatedAt || '').localeCompare(a.updatedAt || ''); });
  lsSetArr(STORE.HISTORY, list);
}

function delHistory(id) {
  lsSetArr(STORE.HISTORY, lsGetArr(STORE.HISTORY).filter(function (x) { return x.id !== id; }));
}

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
  if (!lsGet(STORE.URL) || !lsGet(STORE.KEY) || !lsGet(STORE.MODEL)) {
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
    var raw    = await callAI(novel, person, snippet);
    var parsed = parseResponse(raw, person);

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

  var COLORS = {
    '主角': '#8b4513', '伙伴': '#2e7d32', '盟友': '#1565c0',
    '对手': '#b71c1c', '中立': '#6a1e8a', '家人': '#e65100', 'default': '#546e7a',
  };
  function roleColor(r) {
    var keys = Object.keys(COLORS);
    for (var i = 0; i < keys.length; i++) { if (r && r.indexOf(keys[i]) >= 0) return COLORS[keys[i]]; }
    return COLORS.default;
  }

  async function fetchGraph(novel, person) {
    var url   = lsGet(STORE.URL);
    var key   = lsGet(STORE.KEY);
    var model = lsGet(STORE.MODEL);
    if (!url || !key || !model) throw new Error('请先完成 API 设置');

    var prompt = '小说《' + novel + '》中，以【' + person + '】为中心列出主要关系网络。'
      + '严格只返回 JSON，不要代码块、不要多余文字：\n'
      + '{"nodes":[{"id":"人名","role":"关系5字内"}],"edges":[{"from":"A","to":"B","label":"关系4字内"}]}\n'
      + '要求：nodes 含 ' + person + '（role="主角"）及 4~8 个相关人物；edges 每对最多一条边；人名用原著写法。';

    var res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
      body: JSON.stringify({ model: model, temperature: 0.2, max_tokens: 600,
        messages: [{ role: 'user', content: prompt }] }),
    });
    if (!res.ok) throw new Error('HTTP_' + res.status);
    var data = await res.json();
    var txt  = (data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
    txt = txt.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/```json|```/g, '').trim();
    return JSON.parse(txt);
  }

  var nodes = [], edges = [], frame = null, drag = null, dox = 0, doy = 0;

  function initGraph(data, center) {
    var W = canvas.width, H = canvas.height;
    nodes = data.nodes.map(function (n, i) {
      var isC = n.id === center;
      var a = (i / data.nodes.length) * Math.PI * 2;
      var r = isC ? 0 : 105 + Math.random() * 30;
      return { id: n.id, role: n.role || '', x: W/2 + Math.cos(a)*r, y: H/2 + Math.sin(a)*r, vx: 0, vy: 0, isC: isC };
    });
    edges = data.edges.map(function (e) { return { from: e.from, to: e.to, label: e.label || '' }; });
  }

  function tick() {
    var W = canvas.width, H = canvas.height;
    for (var i = 0; i < nodes.length; i++) {
      for (var j = i + 1; j < nodes.length; j++) {
        var dx = nodes[j].x - nodes[i].x, dy = nodes[j].y - nodes[i].y;
        var d = Math.sqrt(dx*dx + dy*dy) || 1, f = 3200 / (d*d);
        nodes[i].vx -= (dx/d)*f; nodes[i].vy -= (dy/d)*f;
        nodes[j].vx += (dx/d)*f; nodes[j].vy += (dy/d)*f;
      }
    }
    edges.forEach(function (e) {
      var a = nodes.find(function (n) { return n.id === e.from; });
      var b = nodes.find(function (n) { return n.id === e.to; });
      if (!a || !b) return;
      var dx = b.x-a.x, dy = b.y-a.y, d = Math.sqrt(dx*dx+dy*dy)||1, f = (d-80)*0.04;
      a.vx += (dx/d)*f; a.vy += (dy/d)*f; b.vx -= (dx/d)*f; b.vy -= (dy/d)*f;
    });
    var PAD = 42;
    nodes.forEach(function (n) {
      n.vx += (W/2 - n.x) * 0.008; n.vy += (H/2 - n.y) * 0.008;
      if (drag && n.id === drag) return;
      n.vx *= 0.76; n.vy *= 0.76;
      n.x = Math.max(PAD, Math.min(W-PAD, n.x + n.vx));
      n.y = Math.max(PAD, Math.min(H-PAD, n.y + n.vy));
    });
  }

  function draw() {
    var ctx = canvas.getContext('2d'), W = canvas.width, H = canvas.height;
    ctx.clearRect(0,0,W,H);
    ctx.fillStyle = '#fdf9f4'; ctx.fillRect(0,0,W,H);

    edges.forEach(function (e) {
      var a = nodes.find(function(n){return n.id===e.from;}), b = nodes.find(function(n){return n.id===e.to;});
      if (!a || !b) return;
      ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y);
      ctx.strokeStyle = '#ddd0bc'; ctx.lineWidth = 1.5; ctx.stroke();
      if (e.label) {
        var mx=(a.x+b.x)/2, my=(a.y+b.y)/2;
        ctx.font = '10px PingFang SC,sans-serif';
        var tw = ctx.measureText(e.label).width;
        ctx.fillStyle = 'rgba(253,249,244,.92)'; ctx.fillRect(mx-tw/2-3, my-8, tw+6, 14);
        ctx.fillStyle = '#5a3e28'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(e.label, mx, my);
      }
    });

    nodes.forEach(function (n) {
      var R = n.isC ? 27 : 20, c = roleColor(n.role);
      ctx.shadowColor = 'rgba(100,55,10,.14)'; ctx.shadowBlur = 6;
      ctx.beginPath(); ctx.arc(n.x, n.y, R, 0, Math.PI*2);
      ctx.fillStyle = n.isC ? c : c + 'dd'; ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = n.isC ? 3 : 2; ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.font = (n.isC ? 'bold ' : '') + (n.isC ? 12 : 11) + 'px PingFang SC,sans-serif';
      ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(n.id.length > 4 ? n.id.slice(0,4) + '…' : n.id, n.x, n.y);
      if (n.role) {
        ctx.font = '9px PingFang SC,sans-serif'; ctx.fillStyle = c;
        ctx.textBaseline = 'top'; ctx.fillText(n.role, n.x, n.y + R + 3);
      }
    });
  }

  function loop()     { tick(); draw(); frame = requestAnimationFrame(loop); }
  function stopLoop() { if (frame) { cancelAnimationFrame(frame); frame = null; } }

  function nodeAt(x, y) {
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i], R = n.isC ? 27 : 20, dx = n.x-x, dy = n.y-y;
      if (dx*dx + dy*dy <= R*R) return n;
    }
    return null;
  }

  function canvasXY(ev) {
    var r = canvas.getBoundingClientRect();
    return { x: (ev.clientX-r.left)*(canvas.width/r.width), y: (ev.clientY-r.top)*(canvas.height/r.height) };
  }

  canvas.addEventListener('mousedown',  function(e){ var p=canvasXY(e),n=nodeAt(p.x,p.y); if(n){drag=n.id;dox=n.x-p.x;doy=n.y-p.y;} });
  canvas.addEventListener('mousemove',  function(e){ if(!drag)return; var p=canvasXY(e),n=nodes.find(function(nd){return nd.id===drag;}); if(n){n.x=p.x+dox;n.y=p.y+doy;n.vx=0;n.vy=0;} });
  canvas.addEventListener('mouseup',    function(){ drag=null; });
  canvas.addEventListener('mouseleave', function(){ drag=null; });
  canvas.addEventListener('touchstart', function(e){ e.preventDefault(); var p=canvasXY(e.touches[0]),n=nodeAt(p.x,p.y); if(n){drag=n.id;dox=n.x-p.x;doy=n.y-p.y;} }, {passive:false});
  canvas.addEventListener('touchmove',  function(e){ e.preventDefault(); if(!drag)return; var p=canvasXY(e.touches[0]),n=nodes.find(function(nd){return nd.id===drag;}); if(n){n.x=p.x+dox;n.y=p.y+doy;n.vx=0;n.vy=0;} }, {passive:false});
  canvas.addEventListener('touchend',   function(){ drag=null; });

  $('btnGraph').addEventListener('click', function () {
    var d = window._lastResult;
    if (!d) { alert('请先查询一个人物'); return; }
    title.textContent      = '《' + d.novel + '》· ' + d.person;
    loading.style.display  = 'flex';
    canvas.style.display   = 'none';
    modal.classList.add('open');

    fetchGraph(d.novel, d.person).then(function (data) {
      canvas.width = 370; canvas.height = 440;
      initGraph(data, d.person);
      loading.style.display = 'none';
      canvas.style.display  = 'block';
      stopLoop(); loop();
    }).catch(function (err) {
      loading.innerHTML = '<div style="color:#b83232;font-size:12px;text-align:center;padding:0 20px">图谱生成失败<br>' + esc(err.message) + '</div>';
    });
  });

  $('btnCloseGraph').addEventListener('click', function () { modal.classList.remove('open'); stopLoop(); });
  modal.addEventListener('click', function (e) { if (e.target === modal) { modal.classList.remove('open'); stopLoop(); } });
})();

// ─── 初始化 ───────────────────────────────────────────────────────────────────

loadSettings();
$('inpNovel').value = lsGet(STORE.NOVEL);
renderHistory();
