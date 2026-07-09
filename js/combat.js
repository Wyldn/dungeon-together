// Turn-based combat engine. game.js hands us built enemies and a container;
// we run the whole fight and resolve a Promise with the outcome.

import { SKILLS } from './data/skills.js';
import { CONSUMABLES } from './data/items.js';
import { derived, gearHas, changeSanity, heal, restoreMana } from './character.js';
import { ICONS } from './icons.js';
import { SFX } from './audio.js';
import { screenShake } from './fx.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function buildEnemy(spec, floor, biomeStart, { boss = false, hpMult = 1 } = {}) {
  const depth = Math.max(0, floor - biomeStart);
  const scale = 1 + depth * 0.045;
  return {
    ...spec,
    boss,
    elite: !!spec.elite,
    maxHp: Math.round(spec.hp * scale * hpMult),
    hp: Math.round(spec.hp * scale * hpMult),
    atk: Math.round(spec.atk * scale),
    def: Math.round(spec.def * (1 + depth * 0.02)),
    statuses: {},
    phaseTriggers: [],
    turnCount: 0,
    uid: Math.random().toString(36).slice(2, 8),
  };
}

export function startCombat({ container, run, rng, enemies, modifier = null, introText = null, onHud }) {
  return new Promise(resolve => {
    const C = new Fight(container, run, rng, enemies, modifier, introText, onHud, resolve);
    C.begin();
  });
}

class Fight {
  constructor(container, run, rng, enemies, modifier, introText, onHud, resolve) {
    this.el = container;
    this.run = run;
    this.rng = rng;
    this.enemies = enemies;
    this.mod = modifier || {};
    this.introText = introText;
    this.onHud = onHud;
    this.resolve = resolve;
    this.player = { statuses: {}, buffs: [] };
    this.target = 0;
    this.locked = true;
    this.usedDeathward = false;
    this.turn = 0;
  }

  /* ---------------- helpers ---------------- */
  d() { return derived(this.run); }
  aliveEnemies() { return this.enemies.filter(e => e.hp > 0); }
  buffValue(stat) {
    let mult = 1, add = 0;
    for (const b of this.player.buffs) {
      if (b.stat === stat) { if (b.mult) mult *= b.mult; if (b.add) add += b.add; }
    }
    return { mult, add };
  }

  log(msg, cls = '') {
    const div = document.createElement('div');
    if (cls) div.className = cls;
    div.textContent = msg;
    this.logEl.prepend(div);
    while (this.logEl.children.length > 40) this.logEl.lastChild.remove();
  }

  float(hostEl, text, cls) {
    const f = document.createElement('div');
    f.className = `float-text ${cls}`;
    f.textContent = text;
    hostEl.appendChild(f);
    setTimeout(() => f.remove(), 1000);
  }

  /* ---------------- rendering ---------------- */
  begin() {
    this.el.innerHTML = `
      <div class="combat-screen">
        ${this.mod.name ? `<div class="modifier-banner">⚠ ${this.mod.name} — ${this.mod.desc}</div>` : ''}
        <div class="battlefield">
          <div class="enemy-row"></div>
          <div class="player-row"></div>
        </div>
        <div class="combat-log panel"></div>
        <div class="action-bar"></div>
        <div class="combat-utility"></div>
      </div>`;
    this.enemyRow = this.el.querySelector('.enemy-row');
    this.playerRow = this.el.querySelector('.player-row');
    this.logEl = this.el.querySelector('.combat-log');
    this.actionBar = this.el.querySelector('.action-bar');
    this.utilBar = this.el.querySelector('.combat-utility');

    this.renderEnemies();
    this.renderPlayer();
    if (this.introText) this.log(this.introText, 'log-sys');

    const anyBoss = this.enemies.some(e => e.boss);
    if (anyBoss) SFX.bossIntro(); else SFX.cardDeal();

    (async () => {
      await sleep(600);
      if (this.mod.enemyFirst) {
        this.log('You walked into an ambush — the enemy strikes first!', 'log-sys');
        await this.enemyPhase();
      }
      this.playerPhase();
    })();
  }

  renderEnemies() {
    this.enemyRow.innerHTML = '';
    this.enemies.forEach((e, i) => {
      const div = document.createElement('div');
      div.className = `combatant enemy ${e.elite ? 'elite' : ''} ${e.boss ? 'boss' : ''} ${e.hp <= 0 ? 'dead' : 'targetable'} ${i === this.target ? 'target' : ''}`;
      div.dataset.i = i;
      div.innerHTML = `
        <div class="fighter-sprite" id="sprite-${e.uid}">${e.glyph}</div>
        <div class="fighter-name">${e.name}</div>
        <div class="fighter-hp"><div class="bar"><div class="bar-fill hp" style="width:${clamp(e.hp / e.maxHp * 100, 0, 100)}%"></div></div></div>
        <div class="fighter-statuses">${this.statusPips(e.statuses)}</div>`;
      div.onclick = () => { if (e.hp > 0) { this.target = i; this.renderEnemies(); SFX.click(); } };
      this.enemyRow.appendChild(div);
    });
    if (this.enemies[this.target]?.hp <= 0) {
      this.target = this.enemies.findIndex(e => e.hp > 0);
    }
  }

  renderPlayer() {
    const s = this.player.statuses;
    this.playerRow.innerHTML = `
      <div class="combatant">
        <div class="fighter-sprite" id="sprite-player">${ICONS[this.run.classId]}</div>
        <div class="fighter-name">${this.run.name}</div>
        <div class="fighter-statuses">${this.statusPips(s)}${this.player.buffs.map(b => `<span class="status-pip">▲${b.label} ${b.turns}</span>`).join('')}</div>
      </div>`;
    this.onHud();
  }

  statusPips(st) {
    const pips = [];
    if (st.poison) pips.push(`<span class="status-pip">☠ ${st.poison}</span>`);
    if (st.burn) pips.push(`<span class="status-pip">🔥 ${st.burn}</span>`);
    if (st.frozen) pips.push(`<span class="status-pip">❄ frozen</span>`);
    if (st.stunned) pips.push(`<span class="status-pip">✦ stunned</span>`);
    if (st.shield) pips.push(`<span class="status-pip">◈ ward ${st.shield.turns}</span>`);
    return pips.join('');
  }

  renderActions() {
    this.actionBar.innerHTML = '';
    const costMult = this.mod.costMult || 1;
    for (const id of this.run.skills) {
      const sk = SKILLS[id];
      if (!sk) continue;
      const cost = Math.ceil((sk.cost || 0) * costMult);
      const btn = document.createElement('button');
      btn.className = 'skill-btn';
      btn.disabled = this.run.mp < cost;
      btn.innerHTML = `
        <div class="sk-name"><span>${sk.name}</span><span class="sk-cost">${cost ? cost + ' MP' : 'FREE'}</span></div>
        <div class="sk-desc">${sk.desc}</div>`;
      btn.onclick = () => { if (!this.locked) this.useSkill(sk, cost); };
      this.actionBar.appendChild(btn);
    }
    this.utilBar.innerHTML = '';
    const pots = this.run.consumables;
    if (pots.length) {
      const uniq = [...new Set(pots)];
      for (const cid of uniq) {
        const c = CONSUMABLES.find(x => x.id === cid);
        const count = pots.filter(x => x === cid).length;
        const b = document.createElement('button');
        b.className = 'btn small';
        b.textContent = `${c.name} ×${count}`;
        b.onclick = () => { if (!this.locked) this.useConsumable(c); };
        this.utilBar.appendChild(b);
      }
    }
    const anyBoss = this.enemies.some(e => e.boss);
    if (!anyBoss) {
      const flee = document.createElement('button');
      flee.className = 'btn small ghost';
      flee.textContent = '🏃 Flee';
      flee.onclick = () => { if (!this.locked) this.tryFlee(); };
      this.utilBar.appendChild(flee);
    }
  }

  /* ---------------- player turn ---------------- */
  playerPhase() {
    if (this.checkEnd()) return;
    this.turn++;
    const st = this.player.statuses;
    // start-of-turn: mana regen
    const regen = this.d().manaRegen;
    restoreMana(this.run, regen);
    // frozen/stunned: skip
    if (st.frozen || st.stunned) {
      this.log(`You are ${st.frozen ? 'frozen solid' : 'stunned'} — turn lost!`, 'log-hit');
      delete st.frozen; delete st.stunned;
      this.renderPlayer();
      this.locked = true;
      setTimeout(() => this.enemyPhaseThenPlayer(), 700);
      return;
    }
    this.locked = false;
    this.renderActions();
    this.renderPlayer();
  }

  async useSkill(sk, cost) {
    this.locked = true;
    this.actionBar.querySelectorAll('button').forEach(b => b.disabled = true);
    this.run.mp -= cost;
    const d = this.d();
    const targets = sk.target === 'all' ? this.aliveEnemies()
      : sk.target === 'self' ? []
      : [this.enemies[this.target]].filter(e => e && e.hp > 0);

    const spriteP = this.el.querySelector('#sprite-player');
    spriteP.classList.add('attack');
    setTimeout(() => spriteP.classList.remove('attack'), 420);

    if (sk.target === 'self') {
      this.applySelfSkill(sk, d);
    } else {
      for (const e of targets) {
        await sleep(120);
        this.hitEnemy(e, sk, d);
      }
    }
    if (sk.sanityGain) { changeSanity(this.run, sk.sanityGain); }
    this.renderEnemies();
    this.renderPlayer();
    await sleep(650);
    this.enemyPhaseThenPlayer();
  }

  applySelfSkill(sk, d) {
    if (sk.shield) {
      this.player.statuses.shield = { mult: sk.shield, turns: 2 };
      this.log(`You raise a ward — ${Math.round(sk.shield * 100)}% damage blocked.`, 'log-good');
    }
    if (sk.healPct) {
      const amt = heal(this.run, this.run.maxHp * sk.healPct);
      this.float(this.el.querySelector('#sprite-player'), `+${amt}`, 'heal');
      SFX.heal();
    }
    for (const b of [sk.buff, sk.buff2].filter(Boolean)) {
      this.player.buffs.push({ ...b, turns: b.turns, label: b.stat === 'dodge' ? 'DODGE' : 'PWR' });
      this.log(`${sk.name}: you feel ${b.stat === 'dodge' ? 'untouchable' : 'stronger'}.`, 'log-good');
    }
    SFX.heal();
  }

  hitEnemy(e, sk, d) {
    const stat = d[sk.stat] || d.str;
    const buff = this.buffValue('str');
    let base = (stat * 2.2 + d.atk * 2 + this.run.level * 1.5 + 4) * (sk.power / 100) * buff.mult;
    // crit
    let critChance = d.crit + (sk.critBonus || 0);
    const isCrit = this.rng.chance(clamp(critChance, 0, 85) / 100);
    let dmg = base * (0.85 + this.rng.next() * 0.3);
    if (isCrit) dmg *= 1.6;
    dmg *= d.dmgMult * (this.mod.dmgMult || 1);
    if (e.boss) dmg *= d.bossDmgMult;
    if (!sk.ignoreDef) dmg -= e.def;
    dmg = Math.max(1, Math.round(dmg));

    // execute
    if (sk.execute && !e.boss && e.hp / e.maxHp <= sk.execute) {
      dmg = e.hp;
      this.log(`ASSASSINATE — ${e.name} is slain outright!`, 'log-sys');
    }

    e.hp = Math.max(0, e.hp - dmg);
    const sprite = this.el.querySelector(`#sprite-${e.uid}`);
    if (sprite) {
      sprite.classList.add('hit');
      setTimeout(() => sprite.classList.remove('hit'), 360);
      this.float(sprite.parentElement, isCrit ? `${dmg}!` : `${dmg}`, isCrit ? 'crit' : 'dmg');
    }
    isCrit ? SFX.crit() : SFX.hit();
    if (isCrit) screenShake();
    this.log(`${sk.name} hits ${e.name} for ${dmg}${isCrit ? ' — CRITICAL!' : ''}`, isCrit ? 'log-sys' : '');

    // on-hit statuses (skill + gear)
    const burnCh = (sk.burn || 0) + d.burn;
    const freezeCh = (sk.freeze || 0) + d.freeze;
    if (e.hp > 0) {
      if (sk.poison && this.rng.chance(sk.poison)) { e.statuses.poison = 3; this.log(`${e.name} is poisoned.`, 'log-good'); }
      if (burnCh && this.rng.chance(burnCh)) { e.statuses.burn = 2; this.log(`${e.name} catches fire.`, 'log-good'); SFX.fire(); }
      if (freezeCh && this.rng.chance(freezeCh)) { e.statuses.frozen = 1; this.log(`${e.name} is frozen solid.`, 'log-good'); SFX.freeze(); }
      if (sk.stun && this.rng.chance(sk.stun)) { e.statuses.stunned = 1; this.log(`${e.name} is stunned.`, 'log-good'); }
    }
    // lifesteal
    const ls = (sk.lifesteal || 0) + d.lifesteal;
    if (ls > 0) {
      const amt = heal(this.run, dmg * ls);
      if (amt > 0) this.float(this.el.querySelector('#sprite-player'), `+${amt}`, 'heal');
    }
    if (e.hp <= 0) this.log(`${e.name} is defeated!`, 'log-sys');
  }

  useConsumable(c) {
    this.locked = true;
    const idx = this.run.consumables.indexOf(c.id);
    if (idx === -1) return;
    this.run.consumables.splice(idx, 1);
    if (c.heal) { const amt = heal(this.run, c.heal); this.float(this.el.querySelector('#sprite-player'), `+${amt}`, 'heal'); SFX.heal(); }
    if (c.mana) { restoreMana(this.run, c.mana); this.float(this.el.querySelector('#sprite-player'), `+${c.mana} MP`, 'mana'); }
    if (c.sanity) { changeSanity(this.run, c.sanity); SFX.heal(); }
    if (c.cure) { this.player.statuses = {}; this.log('Ailments cured.', 'log-good'); }
    if (c.bombDmg) {
      for (const e of this.aliveEnemies()) {
        const dmg = c.bombDmg;
        e.hp = Math.max(0, e.hp - dmg);
        const sprite = this.el.querySelector(`#sprite-${e.uid}`);
        if (sprite) this.float(sprite.parentElement, `${dmg}`, 'dmg');
      }
      SFX.crit(); screenShake();
      this.log('The bomb detonates!', 'log-sys');
    }
    this.log(`Used ${c.name}.`, 'log-good');
    this.renderEnemies();
    this.renderPlayer();
    setTimeout(() => this.enemyPhaseThenPlayer(), 600);
  }

  tryFlee() {
    this.locked = true;
    const d = this.d();
    const avgSpd = this.aliveEnemies().reduce((s, e) => s + e.spd, 0) / this.aliveEnemies().length;
    const chance = clamp(0.45 + (d.dex - avgSpd) * 0.03 + d.lk * 0.012, 0.15, 0.9);
    if (this.rng.chance(chance)) {
      this.log('You slip away into the dark.', 'log-sys');
      SFX.miss();
      this.finish('fled');
    } else {
      this.log('No escape — they cut off your retreat!', 'log-hit');
      SFX.bad();
      setTimeout(() => this.enemyPhaseThenPlayer(), 600);
    }
  }

  /* ---------------- enemy turn ---------------- */
  async enemyPhaseThenPlayer() {
    // tick enemy dots + our buffs, then enemies act
    await this.tickEnemyStatuses();
    if (this.checkEnd()) return;
    await this.enemyPhase();
    if (this.checkEnd()) return;
    // end-of-round upkeep
    this.tickPlayerBuffs();
    if (this.mod.sanityDrain) {
      changeSanity(this.run, -this.mod.sanityDrain);
      this.log(`The cursed ground gnaws at your mind. (-${this.mod.sanityDrain} Sanity)`, 'log-hit');
      SFX.sanity();
      if (this.run.sanity <= 0) { this.checkEnd(); return; }
    }
    this.playerPhase();
  }

  async tickEnemyStatuses() {
    for (const e of this.aliveEnemies()) {
      if (e.statuses.poison) {
        const dmg = Math.max(2, Math.round(e.maxHp * 0.07));
        e.hp = Math.max(0, e.hp - dmg);
        const sprite = this.el.querySelector(`#sprite-${e.uid}`);
        if (sprite) this.float(sprite.parentElement, `${dmg}`, 'dmg');
        this.log(`${e.name} suffers ${dmg} poison damage.`);
        e.statuses.poison--;
        if (e.statuses.poison <= 0) delete e.statuses.poison;
      }
      if (e.statuses.burn) {
        const dmg = Math.max(2, Math.round(e.maxHp * 0.055));
        e.hp = Math.max(0, e.hp - dmg);
        const sprite = this.el.querySelector(`#sprite-${e.uid}`);
        if (sprite) this.float(sprite.parentElement, `${dmg}`, 'dmg');
        this.log(`${e.name} burns for ${dmg}.`);
        e.statuses.burn--;
        if (e.statuses.burn <= 0) delete e.statuses.burn;
      }
      if (e.regen && e.hp > 0 && e.hp < e.maxHp) {
        const amt = Math.round(e.maxHp * e.regen);
        e.hp = Math.min(e.maxHp, e.hp + amt);
        this.log(`${e.name} regenerates ${amt}.`, 'log-hit');
      }
    }
    this.renderEnemies();
    await sleep(250);
  }

  async enemyPhase() {
    for (const e of this.aliveEnemies()) {
      if (this.run.hp <= 0) return;
      e.turnCount++;

      // boss mechanics
      if (e.summons && e.turnCount % 3 === 0 && this.enemies.filter(x => x.hp > 0).length < 3) {
        const minion = buildEnemy(
          { id: 'skeleton', name: 'Risen Skeleton', glyph: '💀', hp: 30, atk: 9, def: 2, spd: 7, gold: [0, 0], xp: 5 },
          this.run.floor, this.run.floor);
        this.enemies.push(minion);
        this.log(`${e.name} drags a servant up from the dust!`, 'log-hit');
        this.renderEnemies();
        await sleep(400);
        continue;
      }
      if (e.heads) {
        const pct = e.hp / e.maxHp;
        for (const threshold of [0.6, 0.3]) {
          if (pct <= threshold && !e.phaseTriggers.includes(threshold)) {
            e.phaseTriggers.push(threshold);
            e.atk = Math.round(e.atk * 1.2);
            e.hp = Math.min(e.maxHp, e.hp + Math.round(e.maxHp * 0.1));
            this.log('A severed head regrows — angrier. The Hydra swells with grief.', 'log-hit');
            SFX.bossIntro();
            this.renderEnemies();
            await sleep(500);
          }
        }
      }
      if (e.phases && e.hp / e.maxHp <= 0.5 && !e.phaseTriggers.includes('enrage')) {
        e.phaseTriggers.push('enrage');
        e.atk = Math.round(e.atk * 1.3);
        e.hp = Math.min(e.maxHp, e.hp + Math.round(e.maxHp * 0.12));
        this.log(`${e.name}: "${e.taunt}"`, 'log-sys');
        this.log('The Demon King stops holding back.', 'log-hit');
        changeSanity(this.run, -8);
        SFX.bossIntro(); screenShake();
        this.renderEnemies(); this.renderPlayer();
        await sleep(700);
      }

      if (e.statuses.frozen || e.statuses.stunned) {
        this.log(`${e.name} is ${e.statuses.frozen ? 'frozen' : 'stunned'} — it cannot act.`, 'log-good');
        delete e.statuses.frozen; delete e.statuses.stunned;
        this.renderEnemies();
        await sleep(350);
        continue;
      }

      // attack
      const sprite = this.el.querySelector(`#sprite-${e.uid}`);
      if (sprite) { sprite.classList.add('attack'); setTimeout(() => sprite.classList.remove('attack'), 420); }
      await sleep(240);

      const d = this.d();
      const dodgeBuff = this.buffValue('dodge');
      const dodgeCh = clamp(d.dodge + dodgeBuff.add, 0, 80);
      if (this.rng.chance(dodgeCh / 100)) {
        this.float(this.el.querySelector('#sprite-player'), 'MISS', 'miss');
        this.log(`${e.name} attacks — you evade!`, 'log-good');
        SFX.miss();
        await sleep(380);
        continue;
      }

      let dmg = e.atk * 1.35 * (0.85 + this.rng.next() * 0.3) * (this.mod.dmgMult || 1);
      if (this.rng.chance(d.enemyCrit / 100)) dmg *= 1.5;
      dmg -= d.def;
      if (e.caster && e.turnCount % 2 === 0) { dmg *= 1.4; this.log(`${e.name} channels a darker spell!`, 'log-hit'); }
      const shield = this.player.statuses.shield;
      if (shield) dmg *= (1 - shield.mult);
      dmg = Math.max(1, Math.round(dmg * d.dmgTakenMult));

      this.run.hp = Math.max(0, this.run.hp - dmg);
      this.float(this.el.querySelector('#sprite-player'), `-${dmg}`, 'dmg');
      SFX.hit();
      this.log(`${e.name} hits you for ${dmg}.`, 'log-hit');

      // rider effects
      if (e.sanityHit) {
        const lost = changeSanity(this.run, -e.sanityHit);
        if (lost < 0) { this.log(`Its presence claws at your mind. (${lost} Sanity)`, 'log-hit'); SFX.sanity(); }
      }
      if (e.lifesteal) {
        e.hp = Math.min(e.maxHp, e.hp + Math.round(dmg * e.lifesteal));
        this.log(`${e.name} drinks deep.`, 'log-hit');
      }
      if (e.poison && this.rng.chance(e.poison)) { this.player.statuses.poison = 3; this.log('You are poisoned!', 'log-hit'); }
      if (e.burn && this.rng.chance(e.burn)) { this.player.statuses.burn = 2; this.log('You are set ablaze!', 'log-hit'); }
      if (e.freeze && this.rng.chance(e.freeze)) { this.player.statuses.frozen = 1; this.log('You are frozen!', 'log-hit'); SFX.freeze(); }

      // deathward checks
      if (this.run.hp <= 0) this.deathSaves();

      this.renderPlayer();
      this.renderEnemies();
      await sleep(420);
    }

    // player dots
    const st = this.player.statuses;
    if (st.poison && this.run.hp > 0) {
      const dmg = Math.max(2, Math.round(this.run.maxHp * 0.05));
      this.run.hp = Math.max(0, this.run.hp - dmg);
      this.float(this.el.querySelector('#sprite-player'), `-${dmg}`, 'dmg');
      this.log(`Poison courses through you for ${dmg}.`, 'log-hit');
      st.poison--; if (st.poison <= 0) delete st.poison;
      if (this.run.hp <= 0) this.deathSaves();
    }
    if (st.burn && this.run.hp > 0) {
      const dmg = Math.max(2, Math.round(this.run.maxHp * 0.045));
      this.run.hp = Math.max(0, this.run.hp - dmg);
      this.float(this.el.querySelector('#sprite-player'), `-${dmg}`, 'dmg');
      this.log(`You burn for ${dmg}.`, 'log-hit');
      st.burn--; if (st.burn <= 0) delete st.burn;
      if (this.run.hp <= 0) this.deathSaves();
    }
    if (st.shield) { st.shield.turns--; if (st.shield.turns <= 0) delete st.shield; }
    this.renderPlayer();
  }

  deathSaves() {
    // phoenix feather (once per run), then cracked hourglass (once per battle)
    if (gearHas(this.run, 'revive') && !this.run.usedRevive) {
      this.run.usedRevive = true;
      this.run.hp = Math.round(this.run.maxHp * 0.3);
      this.log('The Phoenix Feather ignites — you rise from the ashes!', 'log-sys');
      SFX.evolve();
      return;
    }
    if (gearHas(this.run, 'deathward') && !this.usedDeathward) {
      this.usedDeathward = true;
      this.run.hp = 1;
      this.log('The Cracked Hourglass shatters — time stumbles, and you are spared. Barely.', 'log-sys');
      SFX.unlock();
    }
  }

  tickPlayerBuffs() {
    this.player.buffs = this.player.buffs.filter(b => --b.turns > 0);
  }

  /* ---------------- end conditions ---------------- */
  checkEnd() {
    if (this.run.hp <= 0) { this.finish('dead'); return true; }
    if (this.run.sanity <= 0) { this.finish('madness'); return true; }
    if (this.aliveEnemies().length === 0) {
      // loot
      const d = this.d();
      let gold = 0, xp = 0;
      for (const e of this.enemies) {
        gold += this.rng.int(e.gold[0], e.gold[1]);
        xp += e.xp;
      }
      gold = Math.round(gold * d.goldMult * d.combatGoldMult * (this.mod.goldMult || 1));
      xp = Math.round(xp * 1.3 * d.xpMult);
      this.finish('win', { gold, xp });
      return true;
    }
    return false;
  }

  finish(result, extra = {}) {
    this.locked = true;
    this.rng.advance?.();
    setTimeout(() => this.resolve({ result, ...extra }), result === 'win' ? 500 : 900);
  }
}
