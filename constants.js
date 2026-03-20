export const STORE = {
  URL:     'tbq3_url',
  KEY:     'tbq3_key',
  MODEL:   'tbq3_model',
  NOVEL:   'tbq3_novel',
  HISTORY: 'tbq3_history',
};

export const FIELDS = [
  { key: 'appear',   label: '首次出场' },
  { key: 'relation', label: '与主角关系' },
  { key: 'faction',  label: '阵营' },
  { key: 'ability',  label: '主要能力' },
  { key: 'events',   label: '关键事件' },
];

export const FULL_FIELDS = new Set(['events']);
