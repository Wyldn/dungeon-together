// Structured combat-log events → player-facing lines.
// Emitters build events; this module renders them. Do not merge by comparing strings.

/** Live-region markup for the on-screen combat log. */
export const COMBAT_LOG_ARIA = {
  role: 'log',
  'aria-live': 'polite',
  'aria-relevant': 'additions',
  'aria-atomic': 'false',
  'aria-label': 'Combat log',
};

export function combatLogAriaAttrs() {
  return Object.entries(COMBAT_LOG_ARIA)
    .map(([k, v]) => `${k}="${v}"`)
    .join(' ');
}

/** Authored basic-attack verbs keyed by creature id. Fallback is "hit". */
export const BASIC_ATTACK_VERBS = {
  rat: 'nibbled',
  mcf2_rat: 'nibbled',
  bandit: 'stabbed',
  spider: 'poisoned',
  wolf: 'bit',
  boar: 'gored',
  vampire: 'bit',
  mcf2_bat: 'bit',
  bat: 'bit',
};

/** Single-token move names that read as English verbs in the past tense. */
const SIMPLE_MOVE_VERBS = {
  slash: 'slashed',
  strike: 'struck',
  cleave: 'cleaved',
  backstab: 'backstabbed',
  smite: 'smote',
  flurry: 'flurried',
  pillage: 'pillaged',
  rebuke: 'rebuked',
  sunder: 'sundered',
  nibble: 'nibbled',
  stab: 'stabbed',
  poison: 'poisoned',
  bite: 'bit',
  hit: 'hit',
  cut: 'cut',
  shoot: 'shot',
};

export function formatAmt(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '0';
  if (Number.isInteger(v)) return String(v);
  return String(Math.round(v * 100) / 100);
}

export function basicVerbFor(enemy) {
  if (enemy?.verb) return enemy.verb;
  if (enemy?.attackVerb) return enemy.attackVerb;
  const id = enemy?.id;
  if (id && BASIC_ATTACK_VERBS[id]) return BASIC_ATTACK_VERBS[id];
  return 'hit';
}

export function simpleMoveVerb(move) {
  if (!move) return null;
  const key = String(move).trim().toLowerCase();
  if (!key || /\s/.test(key) || /['’]/.test(key)) return null;
  return SIMPLE_MOVE_VERBS[key] || null;
}

/**
 * Action clause without the actor: "slashed Dire Wolf" / "used Cleave on Dire Wolf" / "hit you".
 * Prefer an authored verb, then a simple move verb, then the move name, then "hit".
 */
export function actionClause({ move, verb, target, basic = false } = {}) {
  const who = target || 'the foe';
  if (verb) return `${verb} ${who}`;
  const simple = simpleMoveVerb(move);
  if (simple) return `${simple} ${who}`;
  if (move) return `used ${move} on ${who}`;
  if (basic) return `hit ${who}`;
  return `hit ${who}`;
}

function hitSuffix(ev = {}) {
  const bits = [];
  if (ev.guarded) bits.push('guarded');
  if (ev.shielded) bits.push('shielded');
  if (ev.blocked) bits.push('blocked');
  if (ev.immune) bits.push('immune');
  const extra = bits.length ? ` (${bits.join(', ')})` : '';
  const crit = ev.crit ? ' — CRITICAL!' : '';
  return `${extra}${crit}`;
}

function damagePhrase(ev) {
  if (ev.immune) return `0 damage${hitSuffix({ ...ev, crit: false })}`;
  if (Array.isArray(ev.hits) && ev.hits.length > 1) {
    return `${ev.hits.map(formatAmt).join(', ')} damage${hitSuffix(ev)}`;
  }
  return `${formatAmt(ev.dmg)} damage${hitSuffix(ev)}`;
}

export function actorLabel(name, view = {}) {
  if (!name) return 'Someone';
  if (name === 'You' || name === 'you') return 'You';
  if (view.selfName && name === view.selfName) return 'You';
  return name;
}

export function targetLabel(name, view = {}) {
  if (!name) return 'the foe';
  if (name === 'You' || name === 'you') return 'you';
  if (view.selfName && name === view.selfName) return 'you';
  return name;
}

function line(msg, cls) {
  return { msg, cls: cls || '' };
}

function allyCls(side) {
  return side === 'foe' ? 'log-foe' : 'log-ally';
}

function formatHit(ev, view) {
  const actor = actorLabel(ev.actor, view);
  const target = targetLabel(ev.target, view);
  const miss = ev.miss || ev.dodged || ev.evaded;
  if (miss) {
    if (ev.reason === 'whiff') {
      return [line('Confusion takes the wheel — you swing at phantoms and hit nothing!', 'log-foe')];
    }
    if (ev.reason === 'evade') {
      return [line(`${actor} attacks — you evade!`, 'log-ally')];
    }
    return [line(`${actor} attacks — a miss!`, 'log-ally')];
  }
  const clause = actionClause({
    move: ev.move,
    verb: ev.verb,
    target,
    basic: ev.basic || (!ev.move && !!ev.verb),
  });
  if (ev.dmg == null && !ev.hits) {
    return [line(`${actor} ${clause}.`, allyCls(ev.side))];
  }
  const phrase = damagePhrase(ev);
  const end = ev.crit ? '' : '.';
  return [line(`${actor} ${clause} for ${phrase}${end}`, allyCls(ev.side))];
}

function outcomeBit(o = {}, view = {}) {
  const name = targetLabel(o.target, view);
  if (o.miss || o.dodged) return `${name} dodged`;
  if (o.immune) return `${name} 0 (immune)`;
  const n = formatAmt(o.dmg);
  const tag = o.guarded ? ' (guarded)' : o.shielded ? ' (shielded)' : o.crit ? ' crit' : '';
  return `${name} ${n}${tag}`;
}

function formatAoe(ev, view) {
  const actor = actorLabel(ev.actor, view);
  const move = ev.move || 'an attack';
  const parts = (ev.outcomes || []).map(o => outcomeBit(o, view));
  if (!parts.length) return [line(`${actor} used ${move}.`, allyCls(ev.side))];
  if (parts.length === 1 && ev.outcomes[0] && !ev.outcomes[0].miss && !ev.outcomes[0].immune) {
    return formatHit({
      ...ev,
      target: ev.outcomes[0].target,
      dmg: ev.outcomes[0].dmg,
      crit: ev.outcomes[0].crit,
      guarded: ev.outcomes[0].guarded,
      shielded: ev.outcomes[0].shielded,
      immune: ev.outcomes[0].immune,
      miss: false,
    }, view);
  }
  return [line(`${actor} used ${move} — ${parts.join(', ')}.`, allyCls(ev.side))];
}

function formatDot(ev, view) {
  const target = targetLabel(ev.target, view);
  const n = formatAmt(ev.dmg);
  const frail = ev.note ? ` (${ev.note})` : '';
  const cls = ev.side === 'ally' || target === 'you' ? (target === 'you' ? 'log-foe' : '') : '';
  if (ev.kind === 'poison') {
    if (target === 'you') return [line(`Poison courses through you for ${n}.`, 'log-foe')];
    return [line(`${actorLabel(ev.target, view)} suffers ${n} poison damage${frail}.`, cls)];
  }
  if (ev.kind === 'burn') {
    if (target === 'you') return [line(`You burn for ${n}.`, 'log-foe')];
    return [line(`${actorLabel(ev.target, view)} burns for ${n}.`, cls)];
  }
  if (ev.kind === 'torment') {
    if (target === 'you') return [line(`Torment claws you for ${n}.`, 'log-foe')];
    return [line(`${actorLabel(ev.target, view)} writhes for ${n} torment.`, cls)];
  }
  return [line(`${actorLabel(ev.target, view)} suffers ${n} ${ev.kind || 'damage'}${frail}.`, cls)];
}

function formatStatus(ev, view) {
  const target = targetLabel(ev.target, view);
  const cls = ev.side === 'foe' ? 'log-foe' : 'log-ally';
  if (ev.resisted) {
    return [line(`${actorLabel(ev.target, view)} resists ${ev.status}.`, cls)];
  }
  if (ev.text) return [line(ev.text, ev.cls || cls)];
  const name = actorLabel(ev.target, view);
  const you = target === 'you';
  const table = {
    poison: you ? 'You are poisoned!' : `${name} is poisoned.`,
    burn: you ? 'You are set ablaze!' : `${name} catches fire.`,
    freeze: you ? 'You are frozen!' : `${name} is frozen solid.`,
    frozen: you ? 'You are frozen!' : `${name} is frozen solid.`,
    stun: you ? 'You are stunned!' : `${name} is stunned.`,
    stunned: you ? 'You are stunned!' : `${name} is stunned.`,
    paralyze: you ? 'Your nerves seize — paralysis!' : `${name} is paralyzed.`,
    paralyzed: you ? 'Your nerves seize — paralysis!' : `${name} is paralyzed.`,
    hex: you ? 'A hex settles on you!' : `${name} is hexed — it will suffer more.`,
    hexed: you ? 'A hex settles on you!' : `${name} is hexed — it will suffer more.`,
    mark: `${name} is marked as quarry.`,
    marked: `${name} is marked as quarry.`,
    weaken: you ? 'You feel weakened!' : `${name} is weakened.`,
    frail: you ? 'You feel frail!' : `${name} is frail.`,
    tormented: you ? 'Torment claws at you!' : `${name} is tormented.`,
    confused: you ? 'Your thoughts tangle!' : `${name} is confused.`,
    lazy: you ? 'Your limbs grow heavy!' : `${name} grows lazy.`,
  };
  const msg = table[ev.status] || (you ? `You are ${ev.status}!` : `${name} is ${ev.status}.`);
  return [line(msg, ev.cls || cls)];
}

function formatHeal(ev, view) {
  if (ev.text) return [line(ev.text, ev.cls || 'log-ally')];
  const actor = actorLabel(ev.actor, view);
  const target = targetLabel(ev.target, view);
  const n = formatAmt(ev.amt ?? ev.dmg ?? 0);
  if (target === 'you' && actor !== 'You') {
    const move = ev.move ? ` with ${ev.move}` : '';
    return [line(`${actor} mends you${move}. (+${n} HP)`, 'log-ally')];
  }
  if (actor === 'You') {
    const who = target === 'you' ? 'yourself' : (ev.target || 'a companion');
    return [line(`You mend ${who}.`, 'log-ally')];
  }
  return [line(`${actor} mends ${ev.target || target}.`, 'log-ally')];
}

function formatShield(ev) {
  if (ev.text) return [line(ev.text, ev.cls || 'log-ally')];
  const pct = Math.round((ev.mult || 0) * 100);
  const turns = ev.turns != null ? ` for ${ev.turns} turns` : '';
  return [line(`You raise a ward — ${pct}% damage blocked${turns}.`, 'log-ally')];
}

function formatDeath(ev, view) {
  const name = actorLabel(ev.target, view);
  if (ev.text) return [line(ev.text, ev.cls || 'log-ally')];
  if (ev.byAlly) return [line(`${name} is cut down by its own ally!`, 'log-foe')];
  if (ev.byThorns) return [line(`${name} is defeated by its own violence!`, 'log-ally')];
  return [line(`${name} is defeated!`, ev.cls || 'log-ally')];
}

function formatSummon(ev, view) {
  if (ev.text) return [line(ev.text, ev.cls || 'log-foe')];
  const actor = actorLabel(ev.actor, view);
  return [line(`${actor} drags a servant up from the dust!`, 'log-foe')];
}

function formatPhase(ev) {
  return [line(ev.text || 'The fight changes shape.', ev.cls || 'log-sys')];
}

function formatCounter(ev, view) {
  if (ev.text) return [line(ev.text, ev.cls || 'log-ally')];
  const name = actorLabel(ev.target, view);
  return [line(`Thorns bite back — ${name} takes ${formatAmt(ev.dmg)}.`, 'log-ally')];
}

function formatTelegraph(ev, view) {
  if (ev.text) return [line(ev.text, ev.cls || 'log-foe')];
  const actor = actorLabel(ev.actor, view);
  const cost = ev.at != null ? `${ev.at}⚡ ` : '';
  const aoe = ev.aoe ? ' AOE' : '';
  const move = ev.move || 'a special';
  if (ev.ready) return [line(`${actor} telegraphs ${cost}${move}${aoe}!`, 'log-foe')];
  return [line(`${actor} winds up ${cost}${ev.desc || move}.`, 'log-foe')];
}

function formatCooldown(ev) {
  const n = ev.turns | 0;
  const unit = n === 1 ? 'turn' : 'turns';
  const name = ev.move || 'That skill';
  return [line(`${name} on cooldown (${n} ${unit}).`, 'log-sys')];
}

function formatMiss(ev, view) {
  return formatHit({ ...ev, miss: true }, view);
}

function formatSys(ev) {
  return [line(ev.text || '', ev.cls || 'log-sys')];
}

const FORMATTERS = {
  hit: formatHit,
  aoe: formatAoe,
  multihit: (ev, view) => formatHit({ ...ev, hits: ev.hits }, view),
  dot: formatDot,
  status: formatStatus,
  miss: formatMiss,
  heal: formatHeal,
  shield: formatShield,
  death: formatDeath,
  summon: formatSummon,
  phase: formatPhase,
  counter: formatCounter,
  telegraph: formatTelegraph,
  cooldown: formatCooldown,
  sys: formatSys,
  guard: (ev) => [line(ev.text || 'You brace behind your guard.', ev.cls || 'log-ally')],
};

/**
 * Render one structured combat event to one or more log lines.
 * Never inspects neighboring events — callers decide what to emit.
 */
export function formatCombatEvent(ev, view = {}) {
  if (!ev || typeof ev !== 'object') return [];
  const fmt = FORMATTERS[ev.type] || formatSys;
  return fmt(ev, view).filter(l => l && l.msg);
}

export function formatCombatEvents(events = [], view = {}) {
  const out = [];
  for (const ev of events) out.push(...formatCombatEvent(ev, view));
  return out;
}

export function viewFromFight(f) {
  return { selfName: f?.run?.name || null };
}

/** Push rendered lines through f.log. */
export function emitCombatEvent(f, ev) {
  if (!f?.log) return [];
  const lines = formatCombatEvent(ev, viewFromFight(f));
  for (const l of lines) f.log(l.msg, l.cls);
  return lines;
}

export function combatLogLine(f, msg, cls = '') {
  if (f?._actionLog?.aoe) {
    f._actionLog.extras = f._actionLog.extras || [];
    f._actionLog.extras.push({ msg, cls: cls || '' });
    return;
  }
  f?.log?.(msg, cls);
}

export function beginActionLog(f, meta = {}) {
  f._actionLog = {
    actor: meta.actor || 'You',
    move: meta.move || null,
    verb: meta.verb || null,
    side: meta.side || 'ally',
    aoe: !!meta.aoe,
    outcomes: [],
    extras: [],
  };
}

export function queueHitOutcome(f, outcome) {
  if (f?._actionLog) {
    f._actionLog.outcomes.push(outcome);
    return true;
  }
  return false;
}

export function endActionLog(f) {
  const a = f?._actionLog;
  f._actionLog = null;
  if (!a) return [];
  let lines = [];
  if (a.aoe && a.outcomes.length > 1) {
    lines = emitCombatEvent(f, {
      type: 'aoe',
      actor: a.actor,
      move: a.move,
      verb: a.verb,
      side: a.side,
      outcomes: a.outcomes,
    });
  } else if (a.outcomes.length === 1) {
    const o = a.outcomes[0];
    lines = emitCombatEvent(f, {
      type: o.miss ? 'miss' : 'hit',
      actor: a.actor,
      move: a.move,
      verb: a.verb,
      side: a.side,
      basic: !a.move,
      ...o,
    });
  }
  for (const x of a.extras || []) f.log(x.msg, x.cls);
  return lines;
}

export function emitSkillCooldown(f, sk, turns) {
  const n = turns != null ? turns : 0;
  if (n <= 0 || !sk?.name) return [];
  return emitCombatEvent(f, { type: 'cooldown', move: sk.name, turns: n });
}

/**
 * Parse an incoming-to-player damage line (old or new format).
 * DoTs should be checked by the caller first.
 */
export function parseIncomingHit(msg) {
  const text = String(msg || '');
  let m = text.match(/^(.+) used (.+) on you for (\d+(?:\.\d+)?) damage(?: \(([^)]+)\))?(?: — CRITICAL!)?\.?$/);
  if (m) {
    return {
      actor: m[1],
      move: m[2],
      dmg: Number(m[3]),
      guarded: /guarded/.test(m[4] || ''),
      kind: 'special',
    };
  }
  m = text.match(/^(.+) \(([^)]+)\) hits you for (\d+(?:\.\d+)?)(?: \(([^)]+)\))?\.?$/);
  if (m) {
    return {
      actor: m[1],
      move: m[2],
      dmg: Number(m[3]),
      guarded: /guarded/.test(m[4] || ''),
      kind: 'special',
    };
  }
  m = text.match(/^(.+) hits you for (\d+(?:\.\d+)?)(?: \(([^)]+)\))?\.?$/);
  if (m) {
    return {
      actor: m[1],
      move: null,
      dmg: Number(m[2]),
      guarded: /guarded/.test(m[3] || ''),
      kind: 'basic',
    };
  }
  m = text.match(/^(.+) (\S+) you for (\d+(?:\.\d+)?) damage(?: \(([^)]+)\))?(?: — CRITICAL!)?\.?$/);
  if (m && !/^(Poison|Torment)\b/.test(m[1]) && m[2] !== 'courses' && m[2] !== 'claws') {
    return {
      actor: m[1],
      move: null,
      verb: m[2],
      dmg: Number(m[3]),
      guarded: /guarded/.test(m[4] || ''),
      kind: 'basic',
    };
  }
  return null;
}
