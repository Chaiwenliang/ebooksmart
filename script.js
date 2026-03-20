// script.js — 听书人物查询助手 v2
// 功能：自定义 API；人物名可选（留空时用描述识别）；5字段查询；图谱；复制/删除/导出历史
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

  // ============ Query Fields ============
  const FIELDS = [
    { key: 'firstAppearance', label: '首次出场' },
    { key: 'relation',        label: '与主角关系' },
    { key: 'faction',         label: '阵营' },
    { key: 'ability',         label: '主要能力' },
    { key: 'events',          label: '关键事件' },
  ];
  const FULL_WIDTH_KEYS = new Set(['events']);

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

  // ============ localStorage ============
  function lsGet(key) {
    try { return localStorage.getItem(key) || ''; } catch { return ''; }
  }
  function lsSet(key, val) {
    try { localStorage.setItem(key, String(val || '')); } catch {}
  }
  function lsGetJson(key) {
    try { const r = localStorage.getItem(key); return r ? JSON.parse(r) : null; } catch { return null; }
  }
  function lsSetJson(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
  }

  // ============ Util ============
  function escHtml(s) {
    return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function highlight(text, q) {
    const t = text || '';
    if (!q) return escHtml(t);
    const idx = t.toLowerCase().indexOf(q.toLowerCase());
    if (idx < 0) return escHtml(t);
    return escHtml(t.slice(0, idx)) + '<mark>' + escHtml(t.slice(idx, idx + q.length)) + '</mark>' + escHtml(t.slice(idx + q.length));
  }
  function setStatus(msg, loading) {
    statusText.textContent = msg || '';
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
    setTimeout(function() { settingsSaved.textContent = ''; }, 2000);
  }
  function openSettings() {
    var header = $('mainHeader');
    settingsPanel.style.top = (header.offsetHeight + 4) + 'px';
    settingsPanel.classList.add('open');
    settingsToggle.classList.add('active');
  }

  settingsToggle.addEventListener('click', function() {
    var header = $('mainHeader');
    settingsPanel.style.top = (header.offsetHeight + 4) + 'px';
    var open = settingsPanel.classList.toggle('open');
    settingsToggle.classList.toggle('active', open);
  });
  document.addEventListener('click', function(e) {
    if (settingsPanel.classList.contains('open') &&
        !settingsPanel.contains(e.target) &&
        !settingsToggle.contains(e.target)) {
      settingsPanel.classList.remove('open');
      settingsToggle.classList.remove('active');
    }
  });
  saveSettingsBtn.addEventListener('click', saveSettings);

  // ============ History CRUD ============
  function loadHistory() { return lsGetJson(K.HISTORY) || []; }
  function saveHistoryAll(list) { lsSetJson(K.HISTORY, list); }

  function upsertHistory(item) {
    var list = loadHistory();
    var key  = (item.novel||'').trim().toLowerCase() + '__' + (item.person||'').trim().toLowerCase();
    var idx  = list.findIndex(function(x) {
      return (x.novel||'').trim().toLowerCase() + '__' + (x.person||'').trim().toLowerCase() === key;
    });
    var now = new Date().toISOString();
    if (idx >= 0) {
      list[idx] = Object.assign({}, list[idx], item, { updatedAt: now });
    } else {
      list.unshift(Object.assign({ id: Date.now() + '_' + Math.random().toString(36).slice(2,7), createdAt: now }, item, { updatedAt: now }));
    }
    list.sort(function(a,b){ return (b.updatedAt||'').localeCompare(a.updatedAt||''); });
    saveHistoryAll(list);
  }
  function deleteHistoryById(id) { saveHistoryAll(loadHistory().filter(function(x){return x.id!==id;})); }

  // ============ AI Prompt & Parse ============
  function buildPrompt(novel, person, snippet) {
    var fieldLines = FIELDS.map(function(f){ return f.label + '：xxx'; }).join('\n');
    if (!person && snippet) {
      return '用户正在听有声小说《' + novel + '》，听到了如下片段或描述：\n"' + snippet + '"\n请先判断这描述的是哪个人物（第一行输出"人物：xxx"），然后严格只返回以下 ' + FIELDS.length + ' 行信息，共 ' + (FIELDS.length + 1) + ' 行，不要多余内容：\n人物：xxx\n' + fieldLines;
    }
    var snippetLine = snippet ? '\n参考片段：' + snippet : '';
    return '用户正在听有声小说《' + novel + '》。' + snippetLine + '\n请查询人物【' + person + '】，严格只返回以下 ' + FIELDS.length + ' 行，不要多余内容：\n' + fieldLines;
  }

  function parseAiResult(text, knownPerson) {
    var lines = (text || '').trim().split(/\r?\n/).map(function(l){return l.trim();}).filter(Boolean);
    var result = {};

    if (!knownPerson) {
      for (var i = 0; i < lines.length; i++) {
        if (lines[i].startsWith('人物')) {
          var colon = lines[i].indexOf('：') >= 0 ? lines[i].indexOf('：') : lines[i].indexOf(':');
          if (colon >= 0) {
            var val = lines[i].slice(colon + 1).trim();
            if (val) result._identifiedPerson = val;
          }
          break;
        }
      }
    }

    for (var li = 0; li < lines.length; li++) {
      for (var fi = 0; fi < FIELDS.length; fi++) {
        var f = FIELDS[fi];
        if (lines[li].startsWith(f.label)) {
          var c = lines[li].indexOf('：') >= 0 ? lines[li].indexOf('：') : lines[li].indexOf(':');
          if (c >= 0) {
            var v = lines[li].slice(c + 1).trim();
            if (v) result[f.key] = v;
          }
        }
      }
    }
    if (Object.keys(result).filter(function(k){return k!=='_identifiedPerson';}).length === 0) throw new Error('PARSE_FAIL');
    return result;
  }

  async function callAi(novel, person, snippet) {
    var url   = lsGet(K.API_URL)   || DEFAULT_URL;
    var key   = lsGet(K.API_KEY);
    var model = lsGet(K.API_MODEL) || DEFAULT_MODEL;
    if (!key) throw new Error('NO_KEY');

    var fetchPromise = fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
      body: JSON.stringify({
        model: model,
        temperature: 0.3,
        max_tokens: 400,
        messages: [{ role: 'user', content: buildPrompt(novel, person, snippet) }],
      }),
    });
    var timeoutPromise = new Promise(function(_, reject){
      setTimeout(function(){ reject(new Error('请求超时，请检查网络')); }, 20000);
    });
    var res = await Promise.race([fetchPromise, timeoutPromise]);
    if (!res.ok) throw new Error('HTTP_' + res.status);
    var data    = await res.json();
    var content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (typeof content !== 'string') throw new Error('NO_CONTENT');
    return content;
  }

  // ============ Result Display ============
  function showResult(data) {
    resultName.textContent     = data.person || '';
    resultNovelTag.textContent = '《' + (data.novel || '') + '》';
    resultFields.innerHTML     = '';
    FIELDS.forEach(function(f) {
      var div = document.createElement('div');
      div.className = 'res-field' + (FULL_WIDTH_KEYS.has(f.key) ? ' full' : '');
      div.innerHTML = '<div class="res-key">' + escHtml(f.label) + '</div><div class="res-val">' + escHtml(data[f.key] || '—') + '</div>';
      resultFields.appendChild(div);
    });
    resultBox.style.display = '';
    window._lastQueryResult = data;
  }

  // ============ Copy ============
  copyBtn.addEventListener('click', function() {
    var d = window._lastQueryResult;
    if (!d) return;
    var text = '【' + d.novel + '】' + d.person + '\n' + FIELDS.map(function(f){ return f.label + '：' + (d[f.key]||'—'); }).join('\n');
    navigator.clipboard.writeText(text)
      .then(function() {
        var orig = copyBtn.innerHTML;
        copyBtn.textContent = '✓ 已复制';
        setTimeout(function(){ copyBtn.innerHTML = orig; }, 1800);
      })
      .catch(function(){ alert('复制失败，请手动选取'); });
  });

  // ============ History Render ============
  function renderHistory() {
    var q    = (historySearchInput.value || '').trim();
    var lq   = q.toLowerCase();
    var list = loadHistory();
    var hits = q ? list.filter(function(x){ return ((x.novel||'')+' '+(x.person||'')).toLowerCase().includes(lq); }) : list;

    historyList.innerHTML = '';
    if (hits.length === 0) {
      var el = document.createElement('div');
      el.className   = 'hist-empty';
      el.textContent = q ? '没有匹配的记录' : '暂无历史记录';
      historyList.appendChild(el);
      return;
    }
    hits.forEach(function(item) {
      var card = document.createElement('div');
      card.className = 'hist-item';

      var head = document.createElement('div');
      head.className = 'hist-head';
      head.innerHTML =
        '<div class="hist-dot"></div>' +
        '<div class="hist-name">'      + highlight(item.person, q) + '</div>' +
        '<div class="hist-novel-tag">' + highlight(item.novel,  q) + '</div>' +
        '<button class="hist-del" title="删除">×</button>';

      var body = document.createElement('div');
      body.className = 'hist-body';
      var bhtml = item.snippet ? '<div class="hist-kv"><b>描述：</b>' + escHtml(item.snippet) + '</div>' : '';
      FIELDS.forEach(function(f){ bhtml += '<div class="hist-kv"><b>' + escHtml(f.label) + '：</b>' + escHtml(item[f.key]||'—') + '</div>'; });
      body.innerHTML = bhtml;

      head.addEventListener('click', function(e) {
        if (e.target.classList.contains('hist-del')) return;
        card.classList.toggle('open');
        novelInput.value   = item.novel   || '';
        personInput.value  = item.person  || '';
        snippetInput.value = item.snippet || '';
        lsSet(K.NOVEL, item.novel || '');
        showResult(item);
      });
      head.querySelector('.hist-del').addEventListener('click', function(e) {
        e.stopPropagation();
        if (confirm('删除「' + item.person + '」的记录？')) { deleteHistoryById(item.id); renderHistory(); }
      });

      card.appendChild(head);
      card.appendChild(body);
      historyList.appendChild(card);
    });
  }

  // ============ Export ============
  exportBtn.addEventListener('click', function() {
    var list = loadHistory();
    if (!list.length) { alert('暂无历史记录可导出'); return; }
    var text = list.map(function(item) {
      return '【' + item.novel + '】' + item.person + '\n' + FIELDS.map(function(f){ return '  ' + f.label + '：' + (item[f.key]||'—'); }).join('\n');
    }).join('\n\n');
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    a.download = '听书人物记录.txt';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  });

  // ============ Clear All ============
  clearAllBtn.addEventListener('click', function() {
    var list = loadHistory();
    if (!list.length) { alert('暂无历史记录'); return; }
    if (confirm('确定清空全部 ' + list.length + ' 条历史记录？')) { saveHistoryAll([]); renderHistory(); }
  });

  // ============ Query ============
  async function onQuery() {
    if (isBusy) return;
    var novel   = novelInput.value.trim();
    var person  = personInput.value.trim();
    var snippet = snippetInput.value.trim();

    if (!novel)              { alert('请输入小说名'); novelInput.focus(); return; }
    if (!person && !snippet) { alert('请输入人物名，或在描述框中描述该人物特征'); snippetInput.focus(); return; }
    if (!lsGet(K.API_KEY))  { openSettings(); alert('请先在 API 设置中填写 API Key'); return; }

    isBusy = true;
    queryBtn.disabled = true;
    setStatus(person ? 'AI 查询中…' : 'AI 识别人物中…', true);
    lsSet(K.NOVEL, novel);

    try {
      var content        = await callAi(novel, person, snippet);
      var parsed         = parseAiResult(content, person);
      var resolvedPerson = person || parsed._identifiedPerson || '未知人物';
      delete parsed._identifiedPerson;
      var data = Object.assign({ novel: novel, person: resolvedPerson, snippet: snippet }, parsed);

      if (!person && resolvedPerson !== '未知人物') personInput.value = resolvedPerson;

      showResult(data);
      upsertHistory(data);
      renderHistory();
      setStatus('✓ 查询完成');
      setTimeout(function(){ setStatus(''); }, 2500);

    } catch (e) {
      var msg = '查询失败，请重试';
      if      (e.message === 'NO_KEY')             msg = '未填写 API Key，请在设置中填写';
      else if (e.message === 'PARSE_FAIL')         msg = 'AI 返回格式异常，请重试';
      else if (e.name    === 'AbortError')         msg = '请求超时，请检查网络';
      else if (e.message.startsWith('HTTP_'))      msg = 'API 错误（' + e.message + '），请检查 Key 和地址';
      alert(msg);
      setStatus('');
    } finally {
      isBusy = false;
      queryBtn.disabled = false;
    }
  }

  queryBtn.addEventListener('click', onQuery);
  personInput.addEventListener('keydown', function(e){ if (e.key === 'Enter') onQuery(); });
  historySearchInput.addEventListener('input', renderHistory);

  // ============ Init ============
  loadSettings();
  novelInput.value = lsGet(K.NOVEL);
  renderHistory();

})();

// ============ Graph Feature ============
(function () {
  var graphBtn     = document.getElementById('graphBtn');
  var graphModal   = document.getElementById('graphModal');
  var graphClose   = document.getElementById('graphClose');
  var graphTitle   = document.getElementById('graphTitle');
  var graphLoading = document.getElementById('graphLoading');
  var graphCanvas  = document.getElementById('graphCanvas');
  if (!graphBtn) return;

  function lsGet(k) { try { return localStorage.getItem(k) || ''; } catch { return ''; } }
  var K_URL   = 'tnbq_api_url_v2';
  var K_KEY   = 'tnbq_api_key_v2';
  var K_MODEL = 'tnbq_api_model_v2';

  var ROLE_COLORS = { '主角':'#8b4513','伙伴':'#2e7d32','盟友':'#1565c0','对手':'#b71c1c','中立':'#6a1e8a','家人':'#e65100','default':'#546e7a' };
  function roleColor(r) {
    var keys = Object.keys(ROLE_COLORS);
    for (var i=0;i<keys.length;i++) { if (r && r.includes(keys[i])) return ROLE_COLORS[keys[i]]; }
    return ROLE_COLORS.default;
  }

  async function fetchGraphData(novel, person) {
    var url   = lsGet(K_URL)   || 'https://api.openai.com/v1/chat/completions';
    var key   = lsGet(K_KEY);
    var model = lsGet(K_MODEL) || 'gpt-4o-mini';
    if (!key) throw new Error('NO_KEY');

    var prompt = '小说《' + novel + '》中，以【' + person + '】为中心，列出该人物的主要关系网络。\n严格只返回如下 JSON，不要多余文字、不要代码块：\n{"nodes":[{"id":"人名","role":"与' + person + '的关系(5字内)"}],"edges":[{"from":"人名A","to":"人名B","label":"关系(4字内)"}]}\n要求：\n1. nodes 包含 ' + person + ' 本人（role用"主角"）以及 4~8 个相关人物\n2. edges 描述节点间的关系，每对节点最多一条边\n3. 人名保持原著写法';

    var graphFetch = fetch(url, {
      method: 'POST',
      headers: { 'Content-Type':'application/json', 'Authorization':'Bearer ' + key },
      body: JSON.stringify({ model:model, temperature:0.2, max_tokens:600, messages:[{role:'user',content:prompt}] }),
    });
    var graphTimeout = new Promise(function(_, reject){
      setTimeout(function(){ reject(new Error('请求超时')); }, 20000);
    });
    var res = await Promise.race([graphFetch, graphTimeout]);
    if (!res.ok) throw new Error('HTTP_' + res.status);
    var data    = await res.json();
    var content = (data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
    content = content.replace(/```json|```/g, '').trim();
    return JSON.parse(content);
  }

  var nodes=[], edges=[], animFrame=null, dragging=null, dragOffX=0, dragOffY=0;

  function initForce(data, centerPerson) {
    var W=graphCanvas.width, H=graphCanvas.height;
    nodes = data.nodes.map(function(n,i) {
      var isCenter = n.id === centerPerson;
      var angle = (i / data.nodes.length) * Math.PI * 2;
      var r = isCenter ? 0 : 100 + Math.random()*40;
      return { id:n.id, role:n.role||'', x:W/2+Math.cos(angle)*r, y:H/2+Math.sin(angle)*r, vx:0, vy:0, isCenter:isCenter };
    });
    edges = data.edges.map(function(e){ return { from:e.from, to:e.to, label:e.label||'' }; });
  }

  function tick() {
    var W=graphCanvas.width, H=graphCanvas.height;
    for (var i=0;i<nodes.length;i++) {
      for (var j=i+1;j<nodes.length;j++) {
        var dx=nodes[j].x-nodes[i].x, dy=nodes[j].y-nodes[i].y;
        var d=Math.sqrt(dx*dx+dy*dy)||1, f=3200/(d*d);
        nodes[i].vx-=(dx/d)*f; nodes[i].vy-=(dy/d)*f;
        nodes[j].vx+=(dx/d)*f; nodes[j].vy+=(dy/d)*f;
      }
    }
    edges.forEach(function(e) {
      var a=nodes.find(function(n){return n.id===e.from;}), b=nodes.find(function(n){return n.id===e.to;});
      if(!a||!b) return;
      var dx=b.x-a.x, dy=b.y-a.y, d=Math.sqrt(dx*dx+dy*dy)||1, f=(d-80)*0.04;
      a.vx+=(dx/d)*f; a.vy+=(dy/d)*f; b.vx-=(dx/d)*f; b.vy-=(dy/d)*f;
    });
    var PAD=40;
    nodes.forEach(function(n) {
      n.vx+=(W/2-n.x)*0.008; n.vy+=(H/2-n.y)*0.008;
      if(dragging&&n.id===dragging) return;
      n.vx*=0.76; n.vy*=0.76;
      n.x=Math.max(PAD,Math.min(W-PAD,n.x+n.vx));
      n.y=Math.max(PAD,Math.min(H-PAD,n.y+n.vy));
    });
  }

  function draw() {
    var ctx=graphCanvas.getContext('2d'), W=graphCanvas.width, H=graphCanvas.height;
    ctx.clearRect(0,0,W,H); ctx.fillStyle='#fdf9f4'; ctx.fillRect(0,0,W,H);
    edges.forEach(function(e) {
      var a=nodes.find(function(n){return n.id===e.from;}), b=nodes.find(function(n){return n.id===e.to;});
      if(!a||!b) return;
      ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y);
      ctx.strokeStyle='#ddd0bc'; ctx.lineWidth=1.5; ctx.stroke();
      if(e.label){
        var mx=(a.x+b.x)/2, my=(a.y+b.y)/2;
        ctx.font='10px PingFang SC,sans-serif';
        var tw=ctx.measureText(e.label).width;
        ctx.fillStyle='rgba(253,249,244,0.9)'; ctx.fillRect(mx-tw/2-3,my-8,tw+6,14);
        ctx.fillStyle='#5a3e28'; ctx.textAlign='center'; ctx.textBaseline='middle';
        ctx.fillText(e.label,mx,my);
      }
    });
    nodes.forEach(function(n) {
      var R=n.isCenter?27:20, c=roleColor(n.role);
      ctx.shadowColor='rgba(100,55,10,0.16)'; ctx.shadowBlur=7;
      ctx.beginPath(); ctx.arc(n.x,n.y,R,0,Math.PI*2);
      ctx.fillStyle=n.isCenter?c:c+'dd'; ctx.fill();
      ctx.strokeStyle='#fff'; ctx.lineWidth=n.isCenter?3:2; ctx.stroke();
      ctx.shadowBlur=0;
      ctx.font=(n.isCenter?'bold ':'')+( n.isCenter?12:11)+'px PingFang SC,sans-serif';
      ctx.fillStyle='#fff'; ctx.textAlign='center'; ctx.textBaseline='middle';
      ctx.fillText(n.id.length>4?n.id.slice(0,4)+'…':n.id, n.x, n.y);
      if(n.role){
        ctx.font='9px PingFang SC,sans-serif'; ctx.fillStyle=c;
        ctx.textBaseline='top'; ctx.fillText(n.role,n.x,n.y+R+3);
      }
    });
  }

  function loop()    { tick(); draw(); animFrame=requestAnimationFrame(loop); }
  function stopLoop(){ if(animFrame){cancelAnimationFrame(animFrame);animFrame=null;} }
  function nodeAt(x,y) {
    for(var i=0;i<nodes.length;i++){var n=nodes[i],R=n.isCenter?27:20,dx=n.x-x,dy=n.y-y;if(dx*dx+dy*dy<=R*R)return n;}
    return null;
  }
  function getCanvasXY(ev) {
    var r=graphCanvas.getBoundingClientRect();
    return {x:(ev.clientX-r.left)*(graphCanvas.width/r.width), y:(ev.clientY-r.top)*(graphCanvas.height/r.height)};
  }
  graphCanvas.addEventListener('mousedown',  function(e){var p=getCanvasXY(e);var n=nodeAt(p.x,p.y);if(n){dragging=n.id;dragOffX=n.x-p.x;dragOffY=n.y-p.y;}});
  graphCanvas.addEventListener('mousemove',  function(e){if(!dragging)return;var p=getCanvasXY(e);var n=nodes.find(function(nd){return nd.id===dragging;});if(n){n.x=p.x+dragOffX;n.y=p.y+dragOffY;n.vx=0;n.vy=0;}});
  graphCanvas.addEventListener('mouseup',    function(){dragging=null;});
  graphCanvas.addEventListener('mouseleave', function(){dragging=null;});
  graphCanvas.addEventListener('touchstart', function(e){e.preventDefault();var p=getCanvasXY(e.touches[0]);var n=nodeAt(p.x,p.y);if(n){dragging=n.id;dragOffX=n.x-p.x;dragOffY=n.y-p.y;}},{passive:false});
  graphCanvas.addEventListener('touchmove',  function(e){e.preventDefault();if(!dragging)return;var p=getCanvasXY(e.touches[0]);var n=nodes.find(function(nd){return nd.id===dragging;});if(n){n.x=p.x+dragOffX;n.y=p.y+dragOffY;n.vx=0;n.vy=0;}},{passive:false});
  graphCanvas.addEventListener('touchend',   function(){dragging=null;});

  function openGraph() {
    var d = window._lastQueryResult;
    if (!d) { alert('请先查询一个人物'); return; }
    graphTitle.textContent     = '《' + d.novel + '》· ' + d.person + ' 关系图谱';
    graphLoading.style.display = 'flex';
    graphCanvas.style.display  = 'none';
    graphModal.classList.add('open');
    fetchGraphData(d.novel, d.person).then(function(data) {
      graphCanvas.width=370; graphCanvas.height=440;
      initForce(data, d.person);
      graphLoading.style.display='none';
      graphCanvas.style.display='block';
      stopLoop(); loop();
    }).catch(function(err) {
      graphLoading.innerHTML='<div style="color:#b83232;font-size:12px;">生成失败：'+err.message+'<br>请检查 API 设置</div>';
    });
  }
  function closeGraph(){ graphModal.classList.remove('open'); stopLoop(); }

  graphBtn.addEventListener('click', openGraph);
  graphClose.addEventListener('click', closeGraph);
  graphModal.addEventListener('click', function(e){ if(e.target===graphModal) closeGraph(); });
})();
