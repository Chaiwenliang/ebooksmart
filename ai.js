import { FIELDS } from './constants.js';
import { normalizeUrl } from './utils.js';

export function buildPrompt(novel, person, snippet) {
  const lines = FIELDS.map(function (f) { return f.label + '：xxx'; }).join('\n');
  
  // 场景 1：只有描述/片段，没有人物名（倒查模式）
  if (!person && snippet) {
    return '你是一个精通网络小说的助手。用户正在听有声小说《' + novel + '》，听到了如下描述：\n'
      + '"""\n' + snippet + '\n"""\n'
      + '请结合小说《' + novel + '》的情节和人物特征，精准判断这段描述对应的是哪位核心人物。\n'
      + '输出要求：\n'
      + '1. 第一行必须输出 "人物：[确定的角色全名]"。\n'
      + '2. 紧接着严格返回以下 ' + FIELDS.length + ' 行该人物的信息，不要有任何多余文字或解释：\n'
      + lines;
  }

  // 场景 2：已知人物名
  const snipLine = snippet ? '\n参考片段：' + snippet : '';
  return '你是一个精通网络小说的助手。用户正在听有声小说《' + novel + '》。' + snipLine + '\n'
    + '请查询该小说中的人物【' + person + '】，并严格按照以下格式返回该人物的详细信息，不要有多余内容：\n'
    + '人物：' + person + '\n'
    + lines;
}

export function parseResponse(text, knownPerson) {
  // 1. 去掉 <think>...</think> 推理块（Qwen/DeepSeek 思考模型）
  let cleaned = (text || '').replace(/<think>[\s\S]*?<\/think>/gi, '');
  // 2. 去掉 markdown 加粗和代码块标记
  cleaned = cleaned.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/```json|```/g, '').trim();

  const lines = cleaned.split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);
  const out = {};

  // 识别人物名（无人名模式）
  if (!knownPerson) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.indexOf('人物') >= 0 || line.indexOf('姓名') >= 0 || line.indexOf('角色') >= 0) {
        const ci = line.indexOf('：') >= 0 ? line.indexOf('：') : line.indexOf(':');
        if (ci >= 0) {
          out._person = line.slice(ci + 1).replace(/[\[\]]/g, '').trim();
          break;
        }
      }
    }
  }

  // 提取各字段
  for (let li = 0; li < lines.length; li++) {
    for (let fi = 0; fi < FIELDS.length; fi++) {
      const label = FIELDS[fi].label;
      if (lines[li].indexOf(label) >= 0) {
        const c = lines[li].indexOf('：') >= 0 ? lines[li].indexOf('：') : lines[li].indexOf(':');
        if (c >= 0) {
          const v = lines[li].slice(c + 1).trim();
          if (v) out[FIELDS[fi].key] = v;
        }
      }
    }
  }

  const fieldKeys = Object.keys(out).filter(function (k) { return k !== '_person'; });
  if (fieldKeys.length === 0) throw new Error('PARSE_FAIL');
  return out;
}

export async function callAI(novel, person, snippet, config) {
  const { url, key, model } = config;

  if (!url)   throw new Error('NO_URL');
  if (!key)   throw new Error('NO_KEY');
  if (!model) throw new Error('NO_MODEL');

  const finalUrl = normalizeUrl(url);

  const res = await fetch(finalUrl, {
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

  const data    = await res.json();
  const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (!content) throw new Error('NO_CONTENT');
  return content;
}

/**
 * 测试 API 连接是否正常
 * @param {Object} config { url, key, model }
 * @returns {Promise<boolean>}
 */
export async function testConnection(config) {
  const { url, key, model } = config;
  if (!url || !key || !model) throw new Error('MISSING_CONFIG');

  const finalUrl = normalizeUrl(url);
  console.log('Testing connection to:', finalUrl);

  const res = await fetch(finalUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + key,
    },
    body: JSON.stringify({
      model: model,
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 5,
    }),
  });

  if (!res.ok) {
    // 尝试获取错误详情
    let errorMsg = `HTTP_${res.status}`;
    try {
      const errData = await res.json();
      if (errData && errData.error && errData.error.message) {
        errorMsg = errData.error.message;
      }
    } catch (e) { /* ignore */ }
    throw new Error(errorMsg);
  }

  const data = await res.json();
  if (data && data.choices && data.choices.length > 0) {
    return true;
  }
  throw new Error('INVALID_RESPONSE');
}
