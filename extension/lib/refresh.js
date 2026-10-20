// One timer per panel. Hidden panels, in-flight requests and rate-limit cooldowns never queue refreshes.
export class RefreshLoop {
  constructor(run, { canRun = () => true, now = Date.now,
    setTimer = (...args) => globalThis.setTimeout(...args), clearTimer = id => globalThis.clearTimeout(id) } = {}) {
    this.run = run; this.canRun = canRun; this.now = now; this.setTimer = setTimer; this.clearTimer = clearTimer;
    this.intervalMs = 0; this.blockedUntil = 0; this.running = false; this.timer = null; this.generation = 0;
  }
  setInterval(ms) {
    this.clearTimer(this.timer); this.intervalMs = ms; this.timer = null; this.generation++;
    if (ms) this.schedule();
  }
  pauseFor(ms) { this.blockedUntil = Math.max(this.blockedUntil, this.now() + ms); }
  schedule() {
    const generation = this.generation;
    this.timer = this.setTimer(async () => {
      const interval = this.intervalMs;
      if (interval && !this.running && this.now() >= this.blockedUntil && this.canRun()) {
        this.running = true;
        try { await this.run(); } catch { this.setInterval(0); } finally { this.running = false; }
      }
      if (this.intervalMs && this.generation === generation) this.schedule();
    }, this.intervalMs);
  }
}
