/* 巨集求解 Web Worker */
importScripts('sim.js');

let cancelled = false;
self.onmessage = function (e) {
  const m = e.data;
  if (m.type === 'cancel') { cancelled = true; return; }
  if (m.type !== 'solve') return;
  cancelled = false;
  try {
    const ctx = FFSim.makeCtx(m.player, m.recipe);
    const res = FFSim.solveBest(ctx, {
      target: m.target, width: m.width, timeLimitMs: m.timeLimitMs, rounds: m.rounds, iterations: m.iterations,
      onProgress: p => self.postMessage({ type: 'progress', p }),
    });
    self.postMessage({ type: 'done', keys: res.keys, finished: res.finished, reachedTarget: res.reachedTarget, ctx });
  } catch (err) {
    self.postMessage({ type: 'error', message: String(err && err.message || err) });
  }
};
