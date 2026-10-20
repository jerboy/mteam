export const $ = id => document.getElementById(id);

export async function rpc(type, payload = {}) {
  let reply;
  try { reply = await chrome.runtime.sendMessage({ type, ...payload }); }
  catch { throw new Error('扩展后台未响应，请重新打开面板或在扩展管理页重新加载。'); }
  if (!reply?.ok) {
    const error = new Error(reply?.error?.message || '操作未完成，请重试。');
    error.code = reply?.error?.code; error.retryAfterSeconds = reply?.error?.retryAfterSeconds; throw error;
  }
  return reply.data;
}

export function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = String(text);
  return element;
}

export function notice(element, text, tone = false) {
  element.replaceChildren();
  element.textContent = text;
  element.classList.toggle('success', tone === true);
  element.classList.toggle('neutral', tone === 'neutral');
  element.hidden = !text;
}

export const PROMO_NAMES = { FREE: 'FREE', _2X_FREE: '2× FREE', PERCENT_50: '50%', PERCENT_70: '30%', _2X: '2×', _2X_PERCENT_50: '2× / 50%' };
export function promotion(item) {
  // Unknown or unparseable dates do not imply a guaranteed active discount.
  if (!PROMO_NAMES[item.discount]) return '';
  if (item.discountEndTime) {
    const time = parseDate(item.discountEndTime);
    if (!time || time.getTime() <= Date.now()) return '';
  }
  return PROMO_NAMES[item.discount];
}

export function parseDate(value) {
  if (!value) return null;
  // M-Team's timezone-less date strings are in Asia/Shanghai, not the browser's local zone.
  const text = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(value) ? `${value.replace(' ', 'T')}+08:00` : value;
  const date = new Date(text);
  return Number.isFinite(date.getTime()) ? date : null;
}

export function formatDate(value) {
  const date = parseDate(value);
  return date ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date) : '日期未知';
}
