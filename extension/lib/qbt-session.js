import { AppError } from './core.js';
import { downloaderPermission, passwordHeaderRules, QBT_HEADER_RULE_IDS } from './qbittorrent.js';

export function createQbtSession({ permissions, declarativeNetRequest: rules, runtime }) {
  return {
    async prepare(config) {
      let permitted;
      try { permitted = await permissions.contains({ origins: [downloaderPermission(config.url)] }); }
      catch { throw new AppError('QBT_PERMISSION', '无法检查下载器权限，请重新加载扩展。'); }
      if (!permitted) throw new AppError('QBT_PERMISSION', '请在设置中编辑并保存此下载器，授权访问。');
      try {
        // Also removes rule 23001 left by versions that used a single expression.
        await rules.updateSessionRules({ removeRuleIds: [...QBT_HEADER_RULE_IDS],
          addRules: config.auth === 'password' ? passwordHeaderRules(config, runtime.id) : [] });
      } catch {
        // Browser errors may contain private hostnames. Expose the failing phase,
        // never the raw error, and do not send credentials without these rules.
        throw new AppError('QBT_RULES', '浏览器无法配置下载器连接规则，请更新或重新加载扩展。');
      }
    },
    async cleanup() {
      await rules.updateSessionRules({ removeRuleIds: [...QBT_HEADER_RULE_IDS] });
    }
  };
}
