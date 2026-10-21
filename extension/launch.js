import { rpc } from './lib/ui.js';

const status = document.getElementById('launch-status'), retry = document.getElementById('retry');
async function launch() {
  retry.hidden = true;
  status.textContent = '正在打开…';
  try { await rpc('open.app'); status.textContent = '已打开'; }
  catch { status.textContent = '无法打开，请重新加载扩展后重试。'; retry.hidden = false; }
}
retry.addEventListener('click', launch);
launch();
