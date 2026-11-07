/**
 * PF2E REMASTERED — COMPENDIUM DATA BUILDER
 *
 * Reads the official Foundry JSON packs from the read-only reference checkout
 * (../pf2e-reference/packs/pf2e) and emits four lightweight catalogs tailored to
 * the headless combat core:
 *
 *   data/compendiums/spells.json
 *   data/compendiums/weapons.json
 *   data/compendiums/shields.json
 *   data/compendiums/monsters.json
 *
 * The script is intentionally standalone: no npm dependencies, no imports from
 * src/, and no writes outside data/compendiums/. It can be re-run at any time:
 *
 *   npm run build:data
 *
 * Only combat-relevant fields are preserved and every catalog is capped so the
 * browser never downloads thousands of full Foundry documents.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const OUTPUT_DIR = path.join(ROOT, "data", "compendiums");

// The reference checkout has packs/pf2e and packs/sf2e. Prefer the PF2e
// subdirectory when it exists, otherwise support a flat packs/ layout.
const PACKS_ROOT = path.resolve(ROOT, "..", "pf2e-reference", "packs");
const PF2E_ROOT = (() => {
  const nested = path.join(PACKS_ROOT, "pf2e");
  if (fs.existsSync(nested) && fs.statSync(nested).isDirectory()) {
    return nested;
  }
  return PACKS_ROOT;
})();

const MAX_SPELLS = 200;
const MAX_WEAPONS = 200;
const MAX_SHIELDS = 200;
const MAX_MONSTERS = 200;
const DESCRIPTION_LIMIT = 520;

// Well-known entries are promoted so a demo search for the obvious names
// always succeeds even though the catalogs are capped.
const ICONIC_SPELLS = new Set([
  "acid-splash",
  "bane",
  "bless",
  "burning-hands",
  "chain-lightning",
  "charm",
  "color-spray",
  "cone-of-cold",
  "detect-magic",
  "disintegrate",
  "divine-wrath",
  "fear",
  "fireball",
  "flaming-sphere",
  "fly",
  "grease",
  "harm",
  "haste",
  "heal",
  "heroism",
  "hideous-laughter",
  "invisibility",
  "light",
  "lightning-bolt",
  "mage-armor",
  "mage-hand",
  "magic-missile",
  "meteor-swarm",
  "mirror-image",
  "ray-of-frost",
  "shield",
  "shocking-grasp",
  "sleep",
  "slow",
  "spiritual-weapon",
  "teleport",
  "time-stop",
  "true-strike",
  "wall-of-fire",
  "wish",
]);

const ICONIC_WEAPONS = new Set([
  "battle-axe",
  "bastard-sword",
  "club",
  "composite-longbow",
  "composite-shortbow",
  "dagger",
  "dart",
  "falchion",
  "glaive",
  "greataxe",
  "greatclub",
  "greatsword",
  "guisarme",
  "halberd",
  "hand-crossbow",
  "heavy-crossbow",
  "javelin",
  "katana",
  "lance",
  "light-crossbow",
  "light-hammer",
  "longbow",
  "longsword",
  "mace",
  "maul",
  "morningstar",
  "rapier",
  "scimitar",
  "scythe",
  "shortbow",
  "shortsword",
  "sickle",
  "spear",
  "staff",
  "starknife",
  "trident",
  "warhammer",
  "whip",
]);

const ICONIC_MONSTERS = new Set([
  "adult-black-dragon",
  "adult-blue-dragon",
  "adult-green-dragon",
  "adult-red-dragon",
  "adult-white-dragon",
  "air-mephit",
  "ancient-red-dragon",
  "balor",
  "barghest",
  "bugbear",
  "dire-wolf",
  "drow-fighter",
  "earth-elemental",
  "ettin",
  "fire-elemental",
  "frost-giant",
  "ghoul",
  "giant-rat",
  "goblin-commando",
  "goblin-pyro",
  "goblin-warrior",
  "gorgon",
  "hill-giant",
  "hobgoblin-archer",
  "hobgoblin-soldier",
  "hydra",
  "kobold-warrior",
  "lich",
  "manticore",
  "minotaur",
  "ogre-warrior",
  "orc-warrior",
  "owlbear",
  "purple-worm",
  "skeleton-guard",
  "stone-golem",
  "troll",
  "vampire-count",
  "werewolf",
  "wight",
  "winter-wolf",
  "wraith",
  "wyvern",
  "zombie-shambler",
]);

// --------------------------------------------------------------------- utils

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readJson(file) {
  let text = fs.readFileSync(file, "utf8");
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
  }
  return JSON.parse(text);
}

/**
 * Deterministic recursive JSON walk. `_folders.json` and NeDB metadata files
 * are skipped.
 *
 * @param {string} dir
 * @returns {string[]}
 */
function walkJsonFiles(dir) {
  const files = [];
  if (!fs.existsSync(dir)) {
    return files;
  }
  const entries = fs.readdirSync(dir, { withFileTypes: true }).sort(function (a, b) {
    return a.name.localeCompare(b.name);
  });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push.apply(files, walkJsonFiles(full));
      continue;
    }
    if (!entry.isFile() || !/\.json$/i.test(entry.name)) {
      continue;
    }
    if (entry.name === "_folders.json" || entry.name === "_meta.json") {
      continue;
    }
    files.push(full);
  }
  return files;
}

function safeRead(file) {
  try {
    return readJson(file);
  } catch (error) {
    console.warn("  ! skipped unreadable JSON: " + path.relative(PF2E_ROOT, file) + " (" + error.message + ")");
    return null;
  }
}

function slugify(value) {
  return String(value === undefined || value === null ? "" : value)
    .trim()
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function plainText(html) {
  if (typeof html !== "string" || html === "") {
    return "";
  }
  const text = html
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/(p|li|h\d|tr|div)>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/@UUID\[[^\]]+\](?:\{([^}]*)\})?/g, "$1")
    .replace(/@(?:Damage|Check|Template|Localize)\[[^\]]*\]/gi, " ")
    .replace(/\[\[\/gmr[^\]]*\]\]\{([^}]*)\}/gi, "$1")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= DESCRIPTION_LIMIT) {
    return text;
  }
  return text.slice(0, DESCRIPTION_LIMIT - 1).trimEnd() + "…";
}

function toInteger(value) {
  if (Number.isInteger(value)) {
    return value;
  }
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
    return Number.parseInt(value.trim(), 10);
  }
  return null;
}

function positiveInteger(value) {
  const parsed = toInteger(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

function formatPrice(price) {
  if (!price || typeof price !== "object") {
    return null;
  }
  // Foundry v12 uses { value: { gp, sp, cp } }, older packs may use the flat
  // object directly.
  const value = price.value !== undefined ? price.value : price;
  if (value === null || typeof value !== "object") {
    return null;
  }
  const parts = [];
  for (const coin of ["pp", "gp", "sp", "cp"]) {
    if (Number.isInteger(value[coin]) && value[coin] !== 0) {
      parts.push(value[coin] + " " + coin);
    }
  }
  if (parts.length === 0) {
    return "0 gp";
  }
  return parts.join(" ");
}

function parseActionCost(value) {
  if (Number.isInteger(value)) {
    return value >= 1 && value <= 3 ? value : null;
  }
  if (typeof value !== "string") {
    return null;
  }
  const text = value.trim().toLowerCase();
  if (text === "1" || text === "2" || text === "3") {
    return Number.parseInt(text, 10);
  }
  if (text === "reaction" || text === "free" || text === "") {
    // A reaction/free spell still consumes 1 action in the simplified host
    // when cast from the turn UI; blank time defaults to the standard 2.
    return text === "" ? 2 : 1;
  }
  const match = /^(\d+)/.exec(text);
  if (!match) {
    return null;
  }
  const amount = Number.parseInt(match[1], 10);
  return amount >= 1 && amount <= 3 ? amount : null;
}

function firstDamage(systemDamage) {
  if (!systemDamage || typeof systemDamage !== "object") {
    return null;
  }
  for (const key of Object.keys(systemDamage)) {
    const entry = systemDamage[key];
    if (!entry || typeof entry !== "object" || typeof entry.formula !== "string") {
      continue;
    }
    if (entry.formula.trim() === "") {
      continue;
    }
    return {
      formula: entry.formula.trim(),
      type: typeof entry.type === "string" && entry.type !== "" ? entry.type : "untyped",
    };
  }
  return null;
}

function extractArea(area) {
  if (!area || typeof area !== "object") {
    return null;
  }
  const type = typeof area.type === "string" ? area.type.trim().toLowerCase() : "";
  const value = toInteger(area.value);
  if (type === "" || value === null || value <= 0) {
    return null;
  }
  return { type: type, value: value };
}

function extractSave(defense) {
  if (!defense || typeof defense !== "object" || !defense.save) {
    return null;
  }
  const statistic =
    typeof defense.save.statistic === "string"
      ? defense.save.statistic.trim().toLowerCase()
      : "";
  if (statistic === "") {
    return null;
  }
  return { statistic: statistic, basic: defense.save.basic === true };
}

function normalizeMonsterSize(value) {
  const text = String(value || "").trim().toLowerCase();
  switch (text) {
    case "tiny":
      return "tiny";
    case "sm":
    case "small":
      return "small";
    case "med":
    case "medium":
      return "medium";
    case "lg":
    case "large":
      return "large";
    case "huge":
      return "huge";
    case "grg":
    case "gargantuan":
      return "gargantuan";
    default:
      return "medium";
  }
}

function sourceTitle(system) {
  return system && system.publication && typeof system.publication.title === "string"
    ? system.publication.title
    : "";
}

function isRemaster(system) {
  return Boolean(system && system.publication && system.publication.remaster === true);
}

function traitValues(system) {
  if (!system || !system.traits || !Array.isArray(system.traits.value)) {
    return [];
  }
  // "reload-0" and friends mean "no reload"; the combat engine's trait parser
  // only accepts positive parameter values, so omit the inert zero form.
  return system.traits.value.filter(function (trait) {
    return !/^(ranged|thrown|volley|reload)-0$/i.test(String(trait));
  });
}

// ------------------------------------------------------------------- spells

function extractSpell(item) {
  if (!item || item.type !== "spell" || !item.system) {
    return null;
  }
  const system = item.system;
  const traits = traitValues(system);
  const isCantrip = traits.indexOf("cantrip") !== -1;
  const isFocus = traits.indexOf("focus") !== -1;
  const rawRank = system.level && Number.isInteger(system.level.value)
    ? system.level.value
    : 1;
  const rank = isCantrip ? 0 : rawRank;
  const actionCost = parseActionCost(system.time ? system.time.value : undefined);
  if (actionCost === null) {
    return null;
  }
  const area = extractArea(system.area);
  const save = extractSave(system.defense);
  const damage = firstDamage(system.damage);
  const name = String(item.name || "").trim();
  if (name === "") {
    return null;
  }
  return {
    id: String(item._id || slugify(name)),
    name: name,
    rank: rank,
    traits: traits,
    actionCost: actionCost,
    area: area,
    save: save,
    damage: damage,
    isCantrip: isCantrip,
    isFocus: isFocus,
    isSustained: Boolean(system.duration && system.duration.sustained === true),
    description: plainText(system.description ? system.description.value : ""),
    // Internal scoring metadata, stripped before writing.
    _score: scoreSpell({
      slug: slugify(name),
      rank: rank,
      traits: traits,
      area: area,
      save: save,
      damage: damage,
      system: system,
    }),
  };
}

function scoreSpell(entry) {
  let score = 0;
  if (ICONIC_SPELLS.has(entry.slug)) score += 120;
  if (isRemaster(entry.system)) score += 12;
  const title = sourceTitle(entry.system);
  if (/Player Core|Core Rulebook|Advanced Player/i.test(title)) score += 10;
  if (entry.rank === 0) score += 14;
  if (entry.rank >= 1 && entry.rank <= 3) score += 16;
  if (entry.rank >= 4 && entry.rank <= 6) score += 6;
  if (entry.damage) score += 8;
  if (entry.save) score += 5;
  if (entry.area) score += 4;
  if (entry.traits.indexOf("attack") !== -1) score += 4;
  if (entry.traits.indexOf("focus") !== -1) score += 2;
  const rarity = entry.system.traits ? entry.system.traits.rarity : "";
  if (rarity === "common") score += 4;
  if (rarity === "uncommon") score -= 4;
  if (rarity === "rare" || rarity === "unique") score -= 10;
  return score;
}

function selectSpells(all) {
  // Ensure at least a few entries from every rank 0-10, then fill with the
  // highest popularity scores.
  const byRank = new Map();
  for (const spell of all) {
    if (!byRank.has(spell.rank)) {
      byRank.set(spell.rank, []);
    }
    byRank.get(spell.rank).push(spell);
  }
  const selected = new Map();
  for (const rank of Array.from(byRank.keys()).sort(function (a, b) {
    return a - b;
  })) {
    const bucket = byRank.get(rank).slice().sort(compareSpell);
    for (let index = 0; index < Math.min(12, bucket.length); index += 1) {
      selected.set(bucket[index].id, bucket[index]);
    }
  }
  const remaining = all
    .filter(function (spell) {
      return !selected.has(spell.id);
    })
    .sort(compareSpell);
  for (const spell of remaining) {
    if (selected.size >= MAX_SPELLS) {
      break;
    }
    selected.set(spell.id, spell);
  }
  return Array.from(selected.values()).sort(compareSpell).slice(0, MAX_SPELLS);
}

function compareSpell(a, b) {
  if (b._score !== a._score) {
    return b._score - a._score;
  }
  if (a.rank !== b.rank) {
    return a.rank - b.rank;
  }
  return a.name.localeCompare(b.name);
}

// ------------------------------------------------------------------ weapons

function extractWeapon(item) {
  if (!item || item.type !== "weapon" || !item.system) {
    return null;
  }
  const system = item.system;
  const name = String(item.name || "").trim();
  if (name === "") {
    return null;
  }
  const damage = system.damage;
  if (!damage || !Number.isInteger(damage.dice) || typeof damage.die !== "string") {
    return null;
  }
  const usage = system.usage && typeof system.usage.value === "string"
    ? system.usage.value
    : "held-in-one-hand";
  const hands =
    usage === "held-in-two-hands" || usage === "held-in-one-plus-hands" ? 2 : 1;
  const level = system.level && Number.isInteger(system.level.value)
    ? system.level.value
    : 0;
  return {
    id: String(item._id || slugify(name)),
    name: name,
    category: typeof system.category === "string" ? system.category : "martial",
    hands: hands,
    damage: {
      formula: damage.dice + damage.die,
      type: typeof damage.damageType === "string" ? damage.damageType : "untyped",
    },
    traits: traitValues(system),
    rangeIncrement: system.range === null || system.range === undefined
      ? null
      : positiveInteger(system.range),
    reload: system.reload && system.reload.value !== null && system.reload.value !== undefined
      ? toInteger(system.reload.value)
      : null,
    price: formatPrice(system.price),
    description: plainText(system.description ? system.description.value : ""),
    _score: scoreWeapon({
      slug: slugify(name),
      level: level,
      system: system,
    }),
  };
}

function scoreWeapon(entry) {
  let score = 0;
  if (ICONIC_WEAPONS.has(entry.slug)) score += 120;
  if (entry.level === 0) score += 40;
  if (entry.level > 0 && entry.level <= 4) score += 4;
  if (isRemaster(entry.system)) score += 12;
  if (/Player Core|Core Rulebook|Advanced Player/i.test(sourceTitle(entry.system))) {
    score += 10;
  }
  const rarity = entry.system.traits ? entry.system.traits.rarity : "";
  if (rarity === "common") score += 6;
  if (rarity === "uncommon") score -= 4;
  if (rarity === "rare" || rarity === "unique") score -= 10;
  return score;
}

function selectWeapons(all) {
  return all
    .slice()
    .sort(function (a, b) {
      if (b._score !== a._score) return b._score - a._score;
      return a.name.localeCompare(b.name);
    })
    .slice(0, MAX_WEAPONS)
    .sort(function (a, b) {
      return a.name.localeCompare(b.name);
    });
}

// ------------------------------------------------------------------ shields

function extractShield(item) {
  if (!item || item.type !== "shield" || !item.system) {
    return null;
  }
  const system = item.system;
  const name = String(item.name || "").trim();
  if (name === "") {
    return null;
  }
  const maxHP = system.hp && Number.isInteger(system.hp.max)
    ? system.hp.max
    : positiveInteger(system.hp ? system.hp.value : null);
  if (maxHP === null || maxHP <= 0) {
    return null;
  }
  const hardness = Number.isInteger(system.hardness) ? system.hardness : 0;
  const brokenThreshold =
    Number.isInteger(system.brokenThreshold) && system.brokenThreshold > 0
      ? system.brokenThreshold
      : Math.max(1, Math.floor(maxHP / 2));
  return {
    id: String(item._id || slugify(name)),
    name: name,
    hardness: hardness,
    hp: maxHP,
    maxHP: maxHP,
    brokenThreshold: brokenThreshold,
    acBonus: Number.isInteger(system.acBonus) ? system.acBonus : 2,
    speedPenalty: Number.isInteger(system.speedPenalty) ? system.speedPenalty : 0,
    price: formatPrice(system.price),
    description: plainText(system.description ? system.description.value : ""),
  };
}

function selectShields(all) {
  return all
    .slice()
    .sort(function (a, b) {
      return a.name.localeCompare(b.name);
    })
    .slice(0, MAX_SHIELDS);
}

// ----------------------------------------------------------------- monsters

function monsterDamage(system) {
  const rolls = system && system.damageRolls;
  if (!rolls || typeof rolls !== "object") {
    return null;
  }
  for (const key of Object.keys(rolls)) {
    const entry = rolls[key];
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const formula = typeof entry.damage === "string" ? entry.damage.trim() : "";
    if (formula === "") {
      continue;
    }
    return {
      formula: formula,
      type:
        typeof entry.damageType === "string" && entry.damageType !== ""
          ? entry.damageType
          : "untyped",
    };
  }
  return firstDamage(rolls);
}

function extractMonsterAttack(item) {
  if (!item || (item.type !== "melee" && item.type !== "ranged") || !item.system) {
    return null;
  }
  const system = item.system;
  const name = String(item.name || "").trim();
  if (name === "") {
    return null;
  }
  const damage = monsterDamage(system);
  const rangeIncrement =
    system.range && Number.isInteger(system.range.increment)
      ? system.range.increment
      : null;
  return {
    id: String(item._id || slugify(name)),
    name: name,
    // Foundry stores many ranged strikes under the "melee" item type; the
    // range increment is the reliable signal for the combat catalog.
    type: rangeIncrement !== null ? "ranged" : item.type,
    attackBonus: system.bonus && Number.isInteger(system.bonus.value)
      ? system.bonus.value
      : 0,
    damage: damage,
    traits: traitValues(system),
    rangeIncrement: rangeIncrement,
    reload: system.reload && system.reload.value !== null && system.reload.value !== undefined
      ? toInteger(system.reload.value)
      : null,
    description: plainText(system.description ? system.description.value : ""),
  };
}

function extractMonsterSpell(item) {
  if (!item || item.type !== "spell" || !item.system) {
    return null;
  }
  const system = item.system;
  const traits = traitValues(system);
  const rawRank = system.level && Number.isInteger(system.level.value)
    ? system.level.value
    : 1;
  const isCantrip = traits.indexOf("cantrip") !== -1;
  const actionCost = parseActionCost(system.time ? system.time.value : undefined);
  return {
    id: String(item._id || slugify(item.name)),
    name: String(item.name || "").trim(),
    rank: isCantrip ? 0 : rawRank,
    actionCost: actionCost === null ? 2 : actionCost,
    traits: traits,
    area: extractArea(system.area),
    save: extractSave(system.defense),
    damage: firstDamage(system.damage),
    isCantrip: isCantrip,
    isFocus: traits.indexOf("focus") !== -1,
    isSustained: Boolean(system.duration && system.duration.sustained === true),
    // Nested monster spells are a compact reference; the full spell catalog
    // carries the long descriptions.
    description: plainText(system.description ? system.description.value : "").slice(
      0,
      220,
    ),
  };
}

function extractMonster(item) {
  if (!item || item.type !== "npc" || !item.system) {
    return null;
  }
  const system = item.system;
  const name = String(item.name || "").trim();
  if (name === "") {
    return null;
  }
  const attributes = system.attributes || {};
  const hp = attributes.hp && Number.isInteger(attributes.hp.max)
    ? attributes.hp.max
    : positiveInteger(attributes.hp ? attributes.hp.value : null);
  if (hp === null || hp <= 0) {
    return null;
  }
  const speed = attributes.speed || {};
  let walkSpeed = Number.isInteger(speed.value) ? speed.value : 0;
  if (walkSpeed <= 0) {
    const other = Array.isArray(speed.otherSpeeds) ? speed.otherSpeeds : [];
    for (const entry of other) {
      if (entry && Number.isInteger(entry.value) && entry.value > walkSpeed) {
        walkSpeed = entry.value;
      }
    }
  }
  if (walkSpeed <= 0) {
    walkSpeed = 25;
  }
  walkSpeed = Math.max(5, Math.round(walkSpeed / 5) * 5);

  const saves = system.saves || {};
  const skillSource = system.skills || {};
  const skills = {};
  for (const key of Object.keys(skillSource)) {
    const raw = skillSource[key];
    const value =
      raw && typeof raw === "object"
        ? Number.isInteger(raw.base)
          ? raw.base
          : toInteger(raw.value)
        : toInteger(raw);
    if (value !== null) {
      skills[key] = value;
    }
  }
  const perception =
    system.perception && Number.isInteger(system.perception.mod)
      ? system.perception.mod
      : 0;

  const items = Array.isArray(item.items) ? item.items : [];
  const attacks = [];
  const spells = [];
  for (const child of items) {
    if (!child) continue;
    if (child.type === "melee" || child.type === "ranged") {
      const attack = extractMonsterAttack(child);
      if (attack) attacks.push(attack);
    } else if (child.type === "spell") {
      const spell = extractMonsterSpell(child);
      if (spell) spells.push(spell);
    }
  }

  const senses = [];
  const senseSource = system.perception && Array.isArray(system.perception.senses)
    ? system.perception.senses
    : [];
  for (const sense of senseSource) {
    if (!sense) continue;
    const type = String(sense.type || sense.name || "").trim().toLowerCase();
    if (type === "") continue;
    const range = Number.isInteger(sense.range) ? sense.range : null;
    senses.push(range === null ? type : type + "-" + range);
  }

  const level = system.details && Number.isInteger(system.details.level.value)
    ? system.details.level.value
    : 0;
  return {
    id: String(item._id || slugify(name)),
    name: name,
    level: level,
    size: normalizeMonsterSize(system.traits && system.traits.size
      ? system.traits.size.value
      : "med"),
    hp: hp,
    ac: attributes.ac && Number.isInteger(attributes.ac.value) ? attributes.ac.value : 10,
    perception: perception,
    speed: walkSpeed,
    saves: {
      fortitude: saves.fortitude && Number.isInteger(saves.fortitude.value)
        ? saves.fortitude.value
        : 0,
      reflex: saves.reflex && Number.isInteger(saves.reflex.value)
        ? saves.reflex.value
        : 0,
      will: saves.will && Number.isInteger(saves.will.value)
        ? saves.will.value
        : 0,
    },
    skills: skills,
    attacks: attacks,
    spells: spells,
    senses: senses,
    traits: traitValues(system),
    _score: scoreMonster({
      slug: slugify(name),
      level: level,
      system: system,
    }),
  };
}

function scoreMonster(entry) {
  let score = 0;
  if (ICONIC_MONSTERS.has(entry.slug)) score += 120;
  if (entry.level >= 0 && entry.level <= 10) score += 20;
  if (entry.level >= 11 && entry.level <= 15) score += 4;
  if (isRemaster(entry.system)) score += 12;
  if (/Monster Core|Bestiary/i.test(sourceTitle(entry.system))) score += 8;
  const rarity =
    entry.system.traits && typeof entry.system.traits.rarity === "string"
      ? entry.system.traits.rarity
      : "";
  if (rarity === "common") score += 6;
  if (rarity === "uncommon") score -= 4;
  if (rarity === "rare" || rarity === "unique") score -= 10;
  return score;
}

function compareMonster(a, b) {
  if (b._score !== a._score) return b._score - a._score;
  if (a.level !== b.level) return a.level - b.level;
  return a.name.localeCompare(b.name);
}

function selectMonsters(all) {
  // Keep the level filter meaningful: seed each level with up to 10 entries,
  // then fill the remaining budget by popularity.
  const byLevel = new Map();
  for (const monster of all) {
    if (!byLevel.has(monster.level)) {
      byLevel.set(monster.level, []);
    }
    byLevel.get(monster.level).push(monster);
  }
  const selected = new Map();
  for (const level of Array.from(byLevel.keys()).sort(function (a, b) {
    return a - b;
  })) {
    const bucket = byLevel.get(level).slice().sort(compareMonster);
    for (let index = 0; index < Math.min(10, bucket.length); index += 1) {
      selected.set(bucket[index].id, bucket[index]);
    }
  }
  const remaining = all
    .filter(function (monster) {
      return !selected.has(monster.id);
    })
    .sort(compareMonster);
  for (const monster of remaining) {
    if (selected.size >= MAX_MONSTERS) {
      break;
    }
    selected.set(monster.id, monster);
  }
  return Array.from(selected.values())
    .sort(function (a, b) {
      if (a.level !== b.level) return a.level - b.level;
      return a.name.localeCompare(b.name);
    })
    .slice(0, MAX_MONSTERS);
}

// -------------------------------------------------------------------- build

function stripScore(entries) {
  return entries.map(function (entry) {
    const copy = Object.assign({}, entry);
    delete copy._score;
    return copy;
  });
}

function writeCatalog(name, entries) {
  ensureDir(OUTPUT_DIR);
  const file = path.join(OUTPUT_DIR, name + ".json");
  const payload = stripScore(entries);
  fs.writeFileSync(file, JSON.stringify(payload, null, 2) + "\n", "utf8");
  const bytes = fs.statSync(file).size;
  console.log(
    "  ✓ " +
      path.relative(ROOT, file).replace(/\\/g, "/") +
      " — " +
      payload.length +
      " entries, " +
      (bytes / 1024).toFixed(1) +
      " KiB",
  );
  return payload.length;
}

function main() {
  console.log("PF2e Remastered compendium builder");
  console.log("  source: " + PF2E_ROOT);
  console.log("  output: " + OUTPUT_DIR);

  if (!fs.existsSync(PF2E_ROOT)) {
    console.error(
      "\nReference packs not found. Expected: " + PF2E_ROOT,
    );
    process.exitCode = 1;
    return;
  }

  const started = Date.now();

  // --- spells -------------------------------------------------------------
  const spellFiles = walkJsonFiles(path.join(PF2E_ROOT, "spells"));
  const spells = [];
  for (const file of spellFiles) {
    const item = safeRead(file);
    const spell = extractSpell(item);
    if (spell) spells.push(spell);
  }
  const selectedSpells = selectSpells(spells);

  // --- equipment (weapons + shields) -------------------------------------
  const equipmentFiles = walkJsonFiles(path.join(PF2E_ROOT, "equipment"));
  const weapons = [];
  const shields = [];
  for (const file of equipmentFiles) {
    const item = safeRead(file);
    if (!item) continue;
    if (item.type === "weapon") {
      const weapon = extractWeapon(item);
      if (weapon) weapons.push(weapon);
    } else if (item.type === "shield") {
      const shield = extractShield(item);
      if (shield) shields.push(shield);
    }
  }
  const selectedWeapons = selectWeapons(weapons);
  const selectedShields = selectShields(shields);

  // --- monsters -----------------------------------------------------------
  const monsterRoot = path.join(PF2E_ROOT, "pathfinder-monster-core");
  const fallbackMonsterRoot = path.join(PF2E_ROOT, "pathfinder-bestiary");
  const monsterFiles = fs.existsSync(monsterRoot)
    ? walkJsonFiles(monsterRoot)
    : walkJsonFiles(fallbackMonsterRoot);
  const monsters = [];
  for (const file of monsterFiles) {
    const item = safeRead(file);
    const monster = extractMonster(item);
    if (monster) monsters.push(monster);
  }
  const selectedMonsters = selectMonsters(monsters);

  console.log(
    "  scanned: " +
      spellFiles.length +
      " spell files, " +
      equipmentFiles.length +
      " equipment files, " +
      monsterFiles.length +
      " monster files",
  );

  let total = 0;
  total += writeCatalog("spells", selectedSpells);
  total += writeCatalog("weapons", selectedWeapons);
  total += writeCatalog("shields", selectedShields);
  total += writeCatalog("monsters", selectedMonsters);

  console.log(
    "Done — " + total + " catalog entries in " + (Date.now() - started) + " ms.",
  );
}

main();
