import { lsGet } from './storage.js';
import { STORE } from './constants.js';
import { normalizeUrl } from './utils.js';

const COLORS = {
  '主角': '#8b4513', '伙伴': '#2e7d32', '盟友': '#1565c0',
  '对手': '#b71c1c', '中立': '#6a1e8a', '家人': '#e65100', 'default': '#546e7a',
};

export function roleColor(r) {
  const keys = Object.keys(COLORS);
  for (let i = 0; i < keys.length; i++) { if (r && r.indexOf(keys[i]) >= 0) return COLORS[keys[i]]; }
  return COLORS.default;
}

export async function fetchGraph(novel, person) {
  const url   = lsGet(STORE.URL);
  const key   = lsGet(STORE.KEY);
  const model = lsGet(STORE.MODEL);
  if (!url || !key || !model) throw new Error('请先完成 API 设置');

  const prompt = '小说《' + novel + '》中，以【' + person + '】为中心列出主要关系网络。'
    + '严格只返回 JSON，不要代码块、不要多余文字：\n'
    + '{"nodes":[{"id":"人名","role":"关系5字内"}],"edges":[{"from":"A","to":"B","label":"关系4字内"}]}\n'
    + '要求：nodes 含 ' + person + '（role="主角"）及 4~8 个相关人物；edges 每对最多一条边；人名用原著写法。';

  const finalUrl = normalizeUrl(url);

  const res = await fetch(finalUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key },
    body: JSON.stringify({ model: model, temperature: 0.2, max_tokens: 600,
      messages: [{ role: 'user', content: prompt }] }),
  });
  if (!res.ok) throw new Error('HTTP_' + res.status);
  const data = await res.json();
  let txt  = (data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
  txt = txt.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/```json|```/g, '').trim();
  return JSON.parse(txt);
}

export class GraphManager {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.nodes = [];
    this.edges = [];
    this.frame = null;
    this.drag = null;
  }

  init(data, center) {
    const W = this.canvas.width, H = this.canvas.height;
    this.nodes = data.nodes.map((n, i) => {
      const isC = n.id === center;
      const a = (i / data.nodes.length) * Math.PI * 2;
      const r = isC ? 0 : 105 + Math.random() * 30;
      return { id: n.id, role: n.role || '', x: W/2 + Math.cos(a)*r, y: H/2 + Math.sin(a)*r, vx: 0, vy: 0, isC: isC };
    });
    this.edges = data.edges.map(e => ({ from: e.from, to: e.to, label: e.label || '' }));
  }

  tick() {
    const W = this.canvas.width, H = this.canvas.height;
    const { nodes, edges, drag } = this;
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const dx = nodes[j].x - nodes[i].x, dy = nodes[j].y - nodes[i].y;
        const d = Math.sqrt(dx*dx + dy*dy) || 1, f = 3200 / (d*d);
        nodes[i].vx -= (dx/d)*f; nodes[i].vy -= (dy/d)*f;
        nodes[j].vx += (dx/d)*f; nodes[j].vy += (dy/d)*f;
      }
    }
    edges.forEach(e => {
      const a = nodes.find(n => n.id === e.from);
      const b = nodes.find(n => n.id === e.to);
      if (!a || !b) return;
      const dx = b.x-a.x, dy = b.y-a.y, d = Math.sqrt(dx*dx+dy*dy)||1, f = (d-80)*0.04;
      a.vx += (dx/d)*f; a.vy += (dy/d)*f; b.vx -= (dx/d)*f; b.vy -= (dy/d)*f;
    });
    const PAD = 42;
    nodes.forEach(n => {
      n.vx += (W/2 - n.x) * 0.008; n.vy += (H/2 - n.y) * 0.008;
      if (drag && n.id === drag.id) return;
      n.vx *= 0.76; n.vy *= 0.76;
      n.x = Math.max(PAD, Math.min(W-PAD, n.x + n.vx));
      n.y = Math.max(PAD, Math.min(H-PAD, n.y + n.vy));
    });
  }

  draw() {
    const { ctx, canvas, nodes, edges } = this;
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0,0,W,H);
    ctx.fillStyle = '#fdf9f4'; ctx.fillRect(0,0,W,H);

    edges.forEach(e => {
      const a = nodes.find(n => n.id === e.from), b = nodes.find(n => n.id === e.to);
      if (!a || !b) return;
      ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y);
      ctx.strokeStyle = '#ddd0bc'; ctx.lineWidth = 1.5; ctx.stroke();
      if (e.label) {
        const mx=(a.x+b.x)/2, my=(a.y+b.y)/2;
        ctx.font = '10px PingFang SC,sans-serif';
        const tw = ctx.measureText(e.label).width;
        ctx.fillStyle = 'rgba(253,249,244,.92)'; ctx.fillRect(mx-tw/2-3, my-8, tw+6, 14);
        ctx.fillStyle = '#5a3e28'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(e.label, mx, my);
      }
    });

    nodes.forEach(n => {
      const R = n.isC ? 27 : 20, c = roleColor(n.role);
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

  loop()     { this.tick(); this.draw(); this.frame = requestAnimationFrame(() => this.loop()); }
  stopLoop() { if (this.frame) { cancelAnimationFrame(this.frame); this.frame = null; } }

  nodeAt(x, y) {
    for (let i = 0; i < this.nodes.length; i++) {
      const n = this.nodes[i], R = n.isC ? 27 : 20, dx = n.x-x, dy = n.y-y;
      if (dx*dx + dy*dy <= R*R) return n;
    }
    return null;
  }
}
