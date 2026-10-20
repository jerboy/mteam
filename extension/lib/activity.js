import { AppError, validateConfig } from './core.js';

export const VISIT_ALARM = 'mteam.web-visit';
export const CHECK_ALARM = 'mteam.web-visit-check';
const DAY = 86400000;
const defaults = { enabled: false, intervalDays: 14 };

export function createActivity({ storage, alarms, openTab, readProfile, now = Date.now }) {
  let visiting = false, generation = 0;
  async function saved() {
    const data = await storage.get(['config', 'configRevision', 'visitPrefs', 'visitState']);
    return { config: validateConfig(data.config || {}), revision: data.configRevision || '',
      prefs: { ...defaults, ...data.visitPrefs }, state: data.visitState || {} };
  }
  async function schedule() {
    const { prefs, state } = await saved();
    if (!alarms) return;
    if (prefs.enabled) {
      const nextAt = state.nextAt || now() + prefs.intervalDays * DAY;
      if (!state.nextAt) await storage.set({ visitState: { ...state, nextAt } });
      await alarms.create(VISIT_ALARM, { when: Math.max(now() + 1000, nextAt) });
    } else await alarms.clear(VISIT_ALARM);
    if (state.pending) await alarms.create(CHECK_ALARM, { when: Math.max(now() + 1000, state.pending.checkAt) });
    else await alarms.clear(CHECK_ALARM);
  }
  async function status() {
    const { config, prefs, state } = await saved();
    const { pending, ...publicState } = state;
    return { ...prefs, ...publicState, checking: Boolean(pending), siteUrl: `${config.siteOrigin}/browse` };
  }
  async function configure(input = {}) {
    if (typeof input.enabled !== 'boolean' || ![7, 14, 28].includes(Number(input.intervalDays))) throw new AppError('INPUT', '请选择每 7、14 或 28 天访问。');
    const data = await saved();
    if (input.enabled && !data.config.apiKey) throw new AppError('NO_KEY', '请先保存 API Key，以便检查网页访问后的浏览时间。');
    if (input.enabled && !alarms) throw new AppError('UNSUPPORTED', '浏览器不支持扩展定时任务。');
    generation++;
    const prefs = { enabled: input.enabled, intervalDays: Number(input.intervalDays) };
    await storage.set({ visitPrefs: prefs, visitState: { ...data.state,
      nextAt: prefs.enabled ? now() + prefs.intervalDays * DAY : null, pending: null,
      status: 'idle', message: prefs.enabled ? '已开启定期打开官网；到期时会打开一个浏览器标签页。' : '定期网页访问已关闭。' } });
    await schedule(); return status();
  }
  async function reset() {
    generation++;
    await storage.set({ visitPrefs: { ...defaults }, visitState: { nextAt: null, status: 'idle', message: '账号配置已变更，请重新开启定期网页访问。' } });
    await alarms?.clear(VISIT_ALARM); await alarms?.clear(CHECK_ALARM);
  }
  async function visit({ automatic = false } = {}) {
    if (visiting) return { skipped: true, reason: 'busy' };
    visiting = true;
    const epoch = generation;
    try {
      const data = await saved(), { config, prefs, state, revision } = data;
      if (automatic && (!prefs.enabled || !state.nextAt || state.nextAt > now())) { await schedule(); return { skipped: true, reason: 'not_due' }; }
      if (state.lastAttemptAt && now() - state.lastAttemptAt < 60000) return { skipped: true, reason: 'recent_attempt' };
      const attemptedAt = now();
      await storage.set({ visitState: { ...state, lastAttemptAt: attemptedAt, nextAt: prefs.enabled ? now() + 120000 : null, status: 'opening', pending: null } });
      let before = null;
      try { before = (await readProfile()).lastWebBrowse; } catch { /* A normal browser visit still works without an API response. */ }
      if (generation !== epoch) return { skipped: true, reason: 'cancelled' };
      try { await openTab({ url: `${config.siteOrigin}/browse`, active: !automatic }); }
      catch {
        const fresh = await saved();
        await storage.set({ visitState: { ...fresh.state, status: 'failed', message: '无法打开官网，请检查浏览器窗口后重试。', nextAt: fresh.prefs.enabled ? now() + DAY : null } });
        await schedule(); throw new AppError('OPEN_TAB', '无法打开官网，请检查浏览器窗口后重试。');
      }
      if (generation !== epoch) return { opened: true, checking: false };
      const fresh = await saved();
      await storage.set({ visitState: { ...fresh.state, nextAt: fresh.prefs.enabled ? now() + fresh.prefs.intervalDays * DAY : null, lastOpenedAt: now(), status: 'checking', message: '已打开官网，将在约一分钟后读取站点最近浏览时间。',
        pending: { before, revision, checkAt: now() + 60000 } } });
      await schedule(); return { opened: true, checking: true };
    } finally { visiting = false; }
  }
  async function verify() {
    const epoch = generation;
    const data = await saved(), pending = data.state.pending;
    if (!pending || pending.checkAt > now()) return;
    if (pending.revision !== data.revision) { await reset(); return; }
    let after = null;
    try { after = (await readProfile()).lastWebBrowse; } catch { /* Never treat an unreadable timestamp as a successful login. */ }
    if (generation !== epoch) return;
    const changed = Boolean(pending.before && after && pending.before !== after);
    const fresh = await saved();
    if (fresh.revision !== pending.revision || !fresh.state.pending) return;
    await storage.set({ visitState: { ...fresh.state, pending: null, lastCheckedAt: now(), lastWebBrowse: after,
      status: changed ? 'changed' : 'unverified',
      message: changed ? '站点返回的最近网页浏览时间发生变化；账号状态仍以站内规则为准。' : '未确认最近浏览时间更新。请确认网页已登录；需要验证码时请自行完成验证。',
      nextAt: !changed && fresh.prefs.enabled ? now() + DAY : fresh.state.nextAt } });
    await schedule();
  }
  async function onAlarm(alarm) {
    if (alarm.name === VISIT_ALARM) await visit({ automatic: true });
    else if (alarm.name === CHECK_ALARM) await verify();
  }
  return { status, configure, reset, visit, onAlarm, reconcile: schedule };
}
