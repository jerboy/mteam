import { AppError, formatSize } from './core.js';

export const TASK_PAGE_SIZE = 50;

export function taskHash(value) {
  if (typeof value !== 'string' || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(value)) {
    throw new AppError('QBT_TASK', '任务标识无效，请刷新列表。');
  }
  return value.toLowerCase();
}

export function taskQuery({ filter = 'all', page = 0 } = {}) {
  if (!['all', 'downloading', 'completed'].includes(filter) || !Number.isSafeInteger(page) || page < 0 || page > 100000) {
    throw new AppError('QBT_TASK', '任务列表参数无效。');
  }
  return { filter, sort: 'added_on', reverse: 'true', limit: String(TASK_PAGE_SIZE + 1), offset: String(page * TASK_PAGE_SIZE) };
}

export function normalizeTask(raw) {
  if (!raw || typeof raw.name !== 'string' || !raw.name || typeof raw.save_path !== 'string') {
    throw new AppError('QBT_RESPONSE', '无法读取下载任务。');
  }
  const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
  return {
    hash: taskHash(raw.hash), name: raw.name, savePath: raw.save_path,
    contentPath: typeof raw.content_path === 'string' ? raw.content_path : '',
    addedOn: number(raw.added_on), size: number(raw.size),
    progress: Math.min(1, number(raw.progress)), downloadSpeed: number(raw.dlspeed),
    uploadSpeed: number(raw.upspeed), state: typeof raw.state === 'string' ? raw.state : 'unknown'
  };
}

export function taskIdentity(task) {
  return { name: task.name, savePath: task.savePath, contentPath: task.contentPath, addedOn: task.addedOn };
}

export function sameTask(task, expected) {
  return expected && Object.entries(taskIdentity(task)).every(([key, value]) => expected[key] === value);
}

const STATES = {
  downloading: '下载中', forcedDL: '下载中', stalledDL: '等待连接', metaDL: '获取元数据', forcedMetaDL: '获取元数据',
  queuedDL: '排队中', checkingDL: '校验中', stoppedDL: '已暂停', pausedDL: '已暂停',
  uploading: '做种中', forcedUP: '做种中', stalledUP: '做种中', queuedUP: '等待做种',
  stoppedUP: '已完成 · 已暂停', pausedUP: '已完成 · 已暂停', checkingUP: '校验中',
  checkingResumeData: '检查数据', moving: '移动中', missingFiles: '文件缺失', error: '出错'
};

export function taskStatus(task) {
  return STATES[task.state] || '未知状态';
}

export function taskMetrics(task) {
  // Do not round an unfinished task up to 100%.
  const percent = task.progress === 1 ? '100' : (Math.floor(task.progress * 1000) / 10).toFixed(1);
  const speed = task.progress === 1 ? `↑ ${formatSize(task.uploadSpeed)}/s` : `↓ ${formatSize(task.downloadSpeed)}/s`;
  return `${percent}% · ${formatSize(task.size)} · ${speed}`;
}
