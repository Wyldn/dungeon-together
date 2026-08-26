import { parentPort, workerData } from 'node:worker_threads';
import { runMeasuredClimb, armPack } from './content_pack_balance_lib.js';
import { GATE } from '../js/content_pack/flags.js';

globalThis.localStorage = globalThis.localStorage || {
  getItem: () => null, setItem: () => {}, removeItem: () => {},
};

armPack(!!workerData.packOn, GATE.MULTIPLAYER);

const jobs = workerData.jobs || [];
for (const job of jobs) {
  try {
    const row = await runMeasuredClimb(job);
    parentPort.postMessage({ ok: true, row });
  } catch (err) {
    parentPort.postMessage({
      ok: false,
      error: String(err?.stack || err),
      job: { classId: job.classId, raceId: job.raceId, seed: job.seed, packOn: job.packOn },
    });
  }
}
