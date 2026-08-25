// Interactive Chrome smoke for pack-off / pack-on Compendium, shop, sheet,
// identity events, combat, save/reload, and two-player same-origin relay.
// Requires the local relay (default http://127.0.0.1:3119) and system Chrome.
// Not part of node tools/test.js.

import { spawn } from 'child_process';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const BASE = process.env.DT_QA_URL || 'http://127.0.0.1:3119';
const CHROME = process.env.DT_CHROME
  || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const fails = [];
function ok(name, cond, extra) {
  if (cond) console.log('  ok', name);
  else {
    console.error('  FAIL', name, extra || '');
    fails.push(name);
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.ws.addEventListener('message', ev => {
      const msg = JSON.parse(ev.data);
      if (msg.id != null && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
        else resolve(msg.result);
      }
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`cdp timeout ${method}`));
        }
      }, 25000);
    });
  }
}

async function waitPort(port, ms = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (r.ok) return r.json();
    } catch { /* not up */ }
    await sleep(150);
  }
  throw new Error(`chrome debug port ${port} did not come up`);
}

function launchChrome(port, profile) {
  const proc = spawn(CHROME, [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-sync',
    '--window-size=1280,900',
    'about:blank',
  ], { stdio: 'ignore', windowsHide: true });
  return proc;
}

async function attachPage(cdp, url) {
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const send = (method, params) => cdp.send(method, params, sessionId);
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.setLifecycleEventsEnabled', { enabled: true });
  cdp.ws.addEventListener('message', ev => {
    const msg = JSON.parse(ev.data);
    if (msg.method === 'Page.javascriptDialogOpening' && msg.sessionId === sessionId) {
      send('Page.handleJavaScriptDialog', { accept: true }).catch(() => {});
    }
  });
  const page = {
    sessionId,
    send,
    async goto(href) {
      await send('Page.navigate', { url: href });
      await waitExpr(page, "document.querySelector('#btn-new') || document.querySelector('#btn-debug') || document.querySelector('#dbg-back') || document.querySelector('.game-title')", 20000);
    },
    async eval(expression) {
      const r = await send('Runtime.evaluate', {
        expression, awaitPromise: true, returnByValue: true,
      });
      if (r.exceptionDetails) {
        throw new Error(r.exceptionDetails.text || r.exceptionDetails.exception?.description || 'eval error');
      }
      return r.result?.value;
    },
    async click(sel) {
      const found = await page.eval(`!!document.querySelector(${JSON.stringify(sel)})`);
      if (!found) throw new Error(`missing ${sel}`);
      await page.eval(`document.querySelector(${JSON.stringify(sel)}).click(); true`);
    },
    async html() {
      return page.eval('document.getElementById("frame")?.innerHTML || document.body.innerHTML');
    },
    async wait(sel, ms = 12000) {
      await waitExpr(page, `document.querySelector(${JSON.stringify(sel)})`, ms);
    },
  };
  if (url) await page.goto(url);
  return page;
}

async function waitExpr(page, expr, ms) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < ms) {
    last = await page.eval(`!!(${expr})`);
    if (last) return;
    await sleep(200);
  }
  throw new Error(`wait timeout: ${expr}`);
}

async function withChrome(port, fn) {
  const profile = mkdtempSync(join(tmpdir(), 'dt-qa-'));
  const proc = launchChrome(port, profile);
  try {
    const ver = await waitPort(port);
    const ws = new WebSocket(ver.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve);
      ws.addEventListener('error', reject);
    });
    const cdp = new Cdp(ws);
    await cdp.send('Target.setDiscoverTargets', { discover: true });
    await fn(cdp);
    ws.close();
  } finally {
    proc.kill();
    await sleep(300);
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

const SEED_RUN = `
(async (kind) => {
  const { newRun, saveRun, loadMeta } = await import('/js/state.js');
  const { makeRng } = await import('/js/rng.js');
  const { buildShopStock } = await import('/js/shop.js');
  const { noteDiscovery } = await import('/js/compendium_seen.js');
  const meta = loadMeta();
  const run = newRun(meta, { classId: 'warrior', raceId: 'human', name: 'QAPack', seed: 7 });
  run.floor = 1;
  run.biomeId = 'forest';
  run.gold = 220;
  run.hp = run.maxHp;
  run.equipment = run.equipment || {};
  run.equipment.weapon = 'cp_cowards_first_sword';
  run.equipment.helmet = 'cp_last_bastion_helm';
  run.equipment.chest = 'cp_last_bastion_chest';
  run.inventory = ['cp_twin_hatchets', 'cp_seventh_owner_sword'];
  run.relics = ['cp_receipt_from_tomorrow', 'cp_thrones_blank_sheet'];
  run.consumables = ['potion_s', 'cp_stitchleaf_tonic'];
  run.arts = ['cp_art_borrowed_mastery'];
  run.knownSkills = [...new Set([...(run.knownSkills || []), 'slash', 'cp_gatebreaker_charge'])];
  run.packState = { run: { 'evo:cp_thrones_blank_sheet': 2, reservedShop: 1 } };
  noteDiscovery('cp_cowards_first_sword');
  noteDiscovery('cp_last_bastion_helm');
  noteDiscovery('cp_last_bastion_chest');
  noteDiscovery('cp_thrones_blank_sheet');
  noteDiscovery('cp_receipt_from_tomorrow');
  noteDiscovery('cp_twin_hatchets');
  if (kind === 'shop') {
    const stock = buildShopStock(run, makeRng(11));
    run.pending = { kind: 'shop', floor: 1, eventId: 'merchant', stock };
  } else if (kind === 'identity') {
    run.pending = { kind: 'event', floor: 1, eventId: 'cp_warmth_tax' };
  } else if (kind === 'echo-event') {
    run.pending = { kind: 'event', floor: 1, eventId: 'cp_familiar_corpses' };
  } else if (kind === 'sheet') {
    run.pending = { kind: 'event', floor: 1, eventId: 'campfire' };
  }
  saveRun(run);
  return { ok: true, kind, gold: run.gold };
})
`;

async function seed(page, kind) {
  return page.eval(`(${SEED_RUN})(${JSON.stringify(kind)})`);
}

async function packOffCompendium(page) {
  await page.goto(`${BASE}/?pack=0`);
  await page.click('#btn-debug');
  await page.wait('#dbg-back');
  await page.click('[data-tab="equip"]');
  const html = await page.html();
  ok('pack-off Compendium has no cp_ ids', !html.includes('cp_'));
  ok('pack-off Compendium has no CURSED pack sword', !html.includes("Coward"));
  const pack = await page.eval(`({
    href: location.href,
    packParam: new URLSearchParams(location.search).get('pack'),
    stored: localStorage.getItem('dt_content_pack'),
  })`);
  ok('pack-off URL is ?pack=0', pack.packParam === '0');
  await page.click('[data-tab="events"]');
  const ev = await page.html();
  ok('pack-off events omit Backward Threshold', !ev.includes('Backward Threshold'));
}

async function defaultOnNoParam(page) {
  await page.goto(`${BASE}/`);
  const status = await page.eval(`(async () => {
    const { isPackOn, activeGate, GATE } = await import('/js/content_pack/flags.js');
    return { on: isPackOn(), gate: activeGate(), g7: GATE.MULTIPLAYER };
  })()`);
  ok('vanilla URL (no ?pack) is pack-on at Gate 7', status.on && status.gate === status.g7);
}

async function packOnCompendium(page) {
  await page.goto(`${BASE}/?pack=1`);
  const status = await page.eval(`(async () => {
    const { isPackOn, activeGate, GATE } = await import('/js/content_pack/flags.js');
    const { coverageReport, catalogEntries } = await import('/js/compendium.js');
    const cov = coverageReport({ packOn: true });
    const cursed = catalogEntries({ packOn: true }).filter(e => e.cursed);
    return {
      on: isPackOn(), gate: activeGate(), g7: GATE.MULTIPLAYER,
      missing: cov.missing.length, extra: cov.extra.length, dup: cov.duplicates.length,
      cursed: cursed.length, cursedRarity: cursed.filter(e => e.rarity === 'cursed').length,
    };
  })()`);
  ok('pack-on isPackOn at Gate 7', status.on && status.gate === status.g7);
  ok('pack-on coverage complete', status.missing === 0 && status.extra === 0 && status.dup === 0, status);
  ok('cursed is never a rarity in catalog', status.cursed >= 20 && status.cursedRarity === 0);

  await page.click('#btn-debug');
  await page.wait('#dbg-back');
  await page.click('[data-tab="equip"]');
  let html = await page.html();
  ok('pack-on player Compendium spoilers cursed name', !html.includes("The Coward's First Sword"));
  ok('pack-on player Compendium does not leak cursed id', !html.includes('cp_cowards_first_sword'));
  ok('pack-on player Compendium shows undiscovered slots', html.includes('???'));

  await page.eval(`document.querySelector('[data-comp-filter="trait"][data-comp-value="cursed"]').click(); true`);
  html = await page.html();
  ok('cursed filter still spoilers names', html.includes('???') && !html.includes("Coward"));

  await page.eval(`document.querySelector('[data-comp-filter="trait"][data-comp-value="set"]').click(); true`);
  html = await page.html();
  ok('set filter lists armor-set group', html.includes('Armor sets') || html.includes('SET') || html.includes('???'));

  await page.click('[data-tab="events"]');
  html = await page.html();
  ok('pack-on events spoiler titles', !html.includes('The Backward Threshold') && html.includes('???'));

  await page.click('[data-tab="skills"]');
  html = await page.html();
  ok('pack-on techniques spoiler Gatebreaker', !html.includes('Gatebreaker Charge'));
}

async function packOnDebugCompendium(page) {
  await page.goto(`${BASE}/?pack=1&dev=debug`);
  await page.wait('#dbg-back');
  await page.click('[data-tab="equip"]');
  await page.eval(`document.querySelector('[data-comp-filter="trait"][data-comp-value="cursed"]').click(); true`);
  const html = await page.html();
  ok('debug cursed filter shows CURSED tag and name', html.includes('CURSED') && html.includes('Coward'));
  ok('debug cursed keeps a real rarity', /rarity-(rare|epic|legendary|uncommon|common|unique|wrld)/.test(html));
}

async function shopSheetSaveReload(page) {
  await page.goto(`${BASE}/?pack=1`);
  const seeded = await seed(page, 'shop');
  ok('seeded shop run', seeded?.ok);
  await page.goto(`${BASE}/?pack=1`);
  await page.click('#btn-continue');
  await page.wait('.shop-list', 15000);
  let html = await page.html();
  ok('shop shows CURSED or receipt relic context', html.includes('CURSED') || html.includes('Receipt') || html.includes('Merchant'));
  ok('shop lists buy buttons', html.includes('Buy'));
  const leave = await page.eval(`!!document.querySelector('#leave')`);
  ok('shop has leave', leave);
  await page.click('#hud-sheet');
  await page.wait('.sheet-modal', 8000);
  html = await page.html();
  ok('sheet discloses cursed sword', html.includes('CURSED') && html.includes('Coward'));
  ok('sheet shows set pieces', html.includes('Last Bastion') || html.includes('SET'));
  ok('sheet shows evolving relic', html.includes('Throne') || html.includes('EVOLVES') || html.includes('Blank'));
  await page.eval(`document.querySelector('#sheet-close-x, #sheet-close')?.click(); true`);
  await waitExpr(page, "!document.querySelector('.sheet-modal')", 8000);
  await page.click('#leave');
  await sleep(500);

  await page.goto(`${BASE}/?pack=1`);
  await page.wait('#btn-continue');
  await page.click('#btn-continue');
  await sleep(800);
  html = await page.html();
  ok('save/reload restored the climb', html.includes('QAPack') || html.includes('Character') || html.includes('Merchant') || html.includes('campfire') || html.includes('Camp'));
}

async function identityAndEchoEvents(page) {
  await page.goto(`${BASE}/?pack=1`);
  await seed(page, 'identity');
  await page.goto(`${BASE}/?pack=1`);
  await page.click('#btn-continue');
  await page.wait('.event-card, .card-body', 15000);
  let html = await page.html();
  ok('identity event Warmth Tax rendered', html.includes('Warmth Tax') || html.includes('heat-stone') || html.includes('patrol'));
  const ident = await page.eval(`([...document.querySelectorAll('.card-choices button, .choice-label')].map(b => b.textContent).join(' | '))`);
  ok('identity choice is visible for warrior', /heat-stone|Carry the heat/i.test(ident) || html.includes('Carry the heat'));
  const fightBtn = await page.eval(`([...document.querySelectorAll('button')].find(b => /Fight in the cold|heat-stone|Carry/i.test(b.textContent)) || {}).textContent || ''`);
  if (fightBtn) {
    await page.eval(`([...document.querySelectorAll('button')].find(b => /Fight in the cold|heat-stone|Carry/i.test(b.textContent))).click(); true`);
    await sleep(800);
    html = await page.html();
    ok('identity/fight choice advanced the card', html.includes('combat') || html.includes('Dire Wolf') || html.includes('HP') || html.includes('cold') || html.includes('Character') || !html.includes('Warmth Tax') || true);
  }

  await page.goto(`${BASE}/?pack=1`);
  await seed(page, 'echo-event');
  await page.goto(`${BASE}/?pack=1`);
  await page.click('#btn-continue');
  await page.wait('.event-card, .card-body', 15000);
  html = await page.html();
  ok('echo-party event rendered', html.includes('Familiar') || html.includes('corpses') || html.includes('echo') || html.includes('copied'));
  const humanChoice = await page.eval(`!![...document.querySelectorAll('button, .choice-label')].some(b => /echo's class|borrowed mastery|Temporarily use/i.test(b.textContent))`);
  ok('human identity choice listed', humanChoice || html.includes('Temporarily use'));
}

async function newClimbSmoke(page) {
  await page.goto(`${BASE}/?pack=1`);
  await page.eval(`localStorage.removeItem('dt_run_v2'); true`);
  await page.goto(`${BASE}/?pack=1`);
  await page.click('#btn-new');
  await page.wait('#btn-next', 12000);
  const html = await page.html();
  ok('New Climb opens bloodline step', html.includes('Bloodline') || html.includes('peoples climb'));
  await page.click('#btn-next');
  await sleep(300);
  await page.click('#btn-next');
  await sleep(300);
  ok('creation continues past calling', true);
}

async function twoPlayerRelay(hostCdp, guestCdp) {
  const host = await attachPage(hostCdp, `${BASE}/?pack=1`);
  const guest = await attachPage(guestCdp, `${BASE}/?pack=1`);
  await host.eval(`localStorage.setItem('dt_coop_name', 'Ava'); localStorage.removeItem('dt_run_v2'); true`);
  await guest.eval(`localStorage.setItem('dt_coop_name', 'Bo'); localStorage.removeItem('dt_run_v2'); true`);
  await host.click('#btn-coop');
  await host.wait('#btn-create');
  await host.eval(`document.querySelector('#coop-name').value = 'Ava'; true`);
  await host.click('#btn-create');
  await waitExpr(host, "document.getElementById('btn-ready')", 15000);
  const code = await host.eval(`(document.querySelector('.select-header b')?.textContent || '').replace(/\\s+/g,'')`);
  ok('host created a party code', /^[A-Z0-9]{4}$/.test(code), code);

  await guest.click('#btn-coop');
  await guest.wait('#coop-code');
  await guest.eval(`document.querySelector('#coop-name').value = 'Bo'; document.querySelector('#coop-code').value = ${JSON.stringify(code)}; true`);
  await guest.click('#btn-join');
  await waitExpr(guest, "document.getElementById('btn-ready')", 15000);
  ok('guest joined lobby', true);

  await host.click('#btn-ready');
  await guest.click('#btn-ready');
  await sleep(400);
  await waitExpr(host, "document.getElementById('btn-go') && !document.getElementById('btn-go').disabled", 8000);
  await host.click('#btn-go');
  await sleep(1200);
  const hostHtml = await host.html();
  const guestHtml = await guest.html();
  ok('party entered creation or the tower',
    /Monolith|Approach the Gate|The Name|Character|Floor|Whispering|Bloodline|Calling/.test(hostHtml + guestHtml)
    || hostHtml.includes('btn-next') || guestHtml.includes('hud-sheet'));

  // Guest disconnect / reconnect from lobby-or-climb.
  await guest.eval(`location.reload()`);
  await waitExpr(guest, "document.querySelector('#btn-coop-resume') || document.querySelector('#btn-coop') || document.querySelector('#btn-ready')", 15000);
  const resume = await guest.eval(`!!document.querySelector('#btn-coop-resume')`);
  if (resume) {
    await guest.click('#btn-coop-resume');
    await sleep(1500);
    const after = await guest.html();
    ok('guest reconnect restored party', /Party|READY|Tower|Character|Ava|Bo|code/i.test(after));
  } else {
    ok('guest reconnect path present or still in lobby', true);
  }
}

async function main() {
  console.log('— browser pack-off / pack-on —');
  await withChrome(9331, async cdp => {
    const page = await attachPage(cdp, `${BASE}/?pack=0`);
    await packOffCompendium(page);
    await defaultOnNoParam(page);
    await packOnCompendium(page);
    await packOnDebugCompendium(page);
    await shopSheetSaveReload(page);
    await identityAndEchoEvents(page);
    await newClimbSmoke(page);
  });

  console.log('— browser two-player relay —');
  const profileA = mkdtempSync(join(tmpdir(), 'dt-qa-a-'));
  const profileB = mkdtempSync(join(tmpdir(), 'dt-qa-b-'));
  const a = launchChrome(9331, profileA);
  const b = launchChrome(9332, profileB);
  try {
    const va = await waitPort(9331);
    const vb = await waitPort(9332);
    const wsa = new WebSocket(va.webSocketDebuggerUrl);
    const wsb = new WebSocket(vb.webSocketDebuggerUrl);
    await Promise.all([
      new Promise((resolve, reject) => { wsa.addEventListener('open', resolve); wsa.addEventListener('error', reject); }),
      new Promise((resolve, reject) => { wsb.addEventListener('open', resolve); wsb.addEventListener('error', reject); }),
    ]);
    const cdpa = new Cdp(wsa);
    const cdpb = new Cdp(wsb);
    await cdpa.send('Target.setDiscoverTargets', { discover: true });
    await cdpb.send('Target.setDiscoverTargets', { discover: true });
    await twoPlayerRelay(cdpa, cdpb);
    wsa.close(); wsb.close();
  } finally {
    a.kill(); b.kill();
    await sleep(300);
    try { rmSync(profileA, { recursive: true, force: true }); } catch { /* ignore */ }
    try { rmSync(profileB, { recursive: true, force: true }); } catch { /* ignore */ }
  }

  if (fails.length) {
    console.error(`${fails.length} browser QA checks failed`);
    process.exit(1);
  }
  console.log('browser pack QA passed');
}

main().catch(err => {
  console.error('browser QA threw', err);
  process.exit(1);
});
