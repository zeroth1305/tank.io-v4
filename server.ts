import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { Server as SocketIOServer } from 'socket.io';
import {
  PlayerData,
  BulletData,
  ShapeData,
  WeatherState,
  WeatherType,
  LeaderboardEntry,
  KillEvent,
  StatKey,
  TankClass,
  WorldBoss,
  WorldEventState,
  BossType,
} from './src/types/game.ts';
import { TANK_CLASSES, AVAILABLE_CLASSES_BY_TIER } from './src/constants/classes.ts';
import { BIOMES, MAP_SIZE, getBiomeAt } from './src/constants/biomes.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

const PORT = process.env.PORT || 3000;
const TICK_RATE = 30; // 30 FPS server-authoritative tick
const MAX_LEVEL = 45;
const MAX_STAT = 7;
const SHAPE_COUNT = 120;
const MAX_BOTS = 10;

// Base physics constants
const BASE_SPEED = 240;
const BASE_HP = 100;
const BASE_DAMAGE = 22;
const BASE_RELOAD = 0.38;
const BASE_BULLET_SPEED = 580;
const BASE_BODY_DAMAGE = 20;

const STAT_KEYS: StatKey[] = [
  'regen',
  'health',
  'bodyDamage',
  'bulletSpeed',
  'bulletPen',
  'bulletDamage',
  'reload',
  'speed',
];

const WEATHER_CYCLE: Array<{ type: WeatherType; name: string; desc: string }> = [
  {
    type: 'clear',
    name: 'Trời Quang Đãng',
    desc: 'Tầm nhìn tuyệt hảo, mọi chỉ số hoạt động bình thường.',
  },
  {
    type: 'rain',
    name: 'Mưa Giông Sấm Sét',
    desc: 'Đường đạn lướt nhanh hơn (+15% tốc độ đạn), bề mặt trơn trượt.',
  },
  {
    type: 'sandstorm',
    name: 'Bão Cát Sa Mạc',
    desc: 'Bụi cát cuồng nộ, tăng uy lực hỏa lực (+10% sát thương đạn).',
  },
  {
    type: 'aurora',
    name: 'Bình Minh Cực Quang',
    desc: 'Năng lượng thần bí phủ khắp chiến trường, tăng +25% điểm XP!',
  },
];

let currentWeatherIndex = 0;
let weatherTimeRemaining = 75; // seconds

const weatherState: WeatherState = {
  type: WEATHER_CYCLE[0].type,
  name: WEATHER_CYCLE[0].name,
  description: WEATHER_CYCLE[0].desc,
  intensity: 0.5,
  timeRemaining: weatherTimeRemaining,
};

// World Event & Bosses System
let eventCountdown = 30; // First event spawns after 30 seconds
let currentBoss: WorldBoss | null = null;
let bossAttackCooldown = 2.0;

const worldEventState: WorldEventState = {
  active: false,
  eventName: 'Chiến Trường Tĩnh Lặng',
  boss: null,
  message: 'Boss thế giới sắp xuất hiện...',
  timeRemaining: eventCountdown,
  eventBannerText: undefined,
  bannerExpiry: 0,
};

const BOSS_CONFIGS: Array<{
  type: BossType;
  name: string;
  title: string;
  r: number;
  hp: number;
  color: string;
  xpReward: number;
}> = [
  {
    type: 'summoner',
    name: 'Summoner',
    title: 'Hoàng Kim Triệu Hồi Sư [Summoner]',
    r: 78,
    hp: 9500,
    color: '#eab308',
    xpReward: 32000,
  },
  {
    type: 'guardian',
    name: 'The Guardian',
    title: 'Nữ Hoàng Crasher [Guardian]',
    r: 74,
    hp: 8500,
    color: '#f43f5e',
    xpReward: 28000,
  },
  {
    type: 'fallen_booster',
    name: 'Fallen Booster',
    title: 'Chiến Xa Sa Ngã [Fallen Booster]',
    r: 68,
    hp: 8000,
    color: '#64748b',
    xpReward: 26000,
  },
  {
    type: 'golden_meteor',
    name: 'Celestial Meteor',
    title: 'Thiên Thạch Hoàng Kim Thần Vực',
    r: 86,
    hp: 12000,
    color: '#f59e0b',
    xpReward: 38000,
  },
];

function spawnWorldBoss() {
  const cfg = BOSS_CONFIGS[Math.floor(Math.random() * BOSS_CONFIGS.length)];
  const spawnAngle = rand(0, Math.PI * 2);
  const spawnDist = rand(150, 460);
  const spawnX = Math.round(MAP_SIZE / 2 + Math.cos(spawnAngle) * spawnDist);
  const spawnY = Math.round(MAP_SIZE / 2 + Math.sin(spawnAngle) * spawnDist);

  currentBoss = {
    id: 'boss_' + Date.now(),
    type: cfg.type,
    name: cfg.name,
    title: cfg.title,
    x: spawnX,
    y: spawnY,
    vx: 0,
    vy: 0,
    angle: 0,
    hp: cfg.hp,
    maxHp: cfg.hp,
    r: cfg.r,
    color: cfg.color,
    xpReward: cfg.xpReward,
    alive: true,
    spawnTime: Date.now(),
  };

  worldEventState.active = true;
  worldEventState.eventName = cfg.title;
  worldEventState.boss = currentBoss;
  worldEventState.message = `Tranh đoạt ngay! Thưởng hạ gục: +${cfg.xpReward.toLocaleString()} XP!`;
  worldEventState.eventBannerText = `⚠️ WORLD EVENT: ${cfg.title} đã giáng lâm chiến trường! Hãy tranh đoạt để nhận +${cfg.xpReward.toLocaleString()} XP!`;
  worldEventState.bannerExpiry = Date.now() + 8500;
  worldEventState.timeRemaining = 160;
  bossAttackCooldown = 2.0;
}

function handleBossDefeated(killer?: PlayerData) {
  if (!currentBoss) return;

  const bossTitle = currentBoss.title;
  const reward = currentBoss.xpReward;
  const bossColor = currentBoss.color;
  const bX = currentBoss.x;
  const bY = currentBoss.y;

  if (killer) {
    killer.kills += 3;
    addXp(killer, reward);
    worldEventState.eventBannerText = `🏆 ${killer.name} ĐÃ HẠ GỤC ${bossTitle} (NHẬN +${reward.toLocaleString()} XP)!`;
  } else {
    worldEventState.eventBannerText = `💥 ${bossTitle} ĐÃ BỊ TIÊU DIỆT!`;
  }
  worldEventState.bannerExpiry = Date.now() + 10000;

  // Participation bonus for all nearby players to reward contested zone fighting
  for (const pid in players) {
    const pl = players[pid];
    if (!pl.alive || pl === killer) continue;
    if (Math.hypot(pl.x - bX, pl.y - bY) < 1100) {
      addXp(pl, 2500); // 2,500 XP assist bonus!
    }
  }

  recentKills.unshift({
    id: 'kill_boss_' + Date.now(),
    killerName: killer ? killer.name : 'Liên Quân Xe Tăng',
    victimName: bossTitle,
    killerColor: killer ? killer.color : '#eab308',
    victimColor: bossColor,
    killerClass: killer ? killer.class : 'triplet',
    victimClass: 'annihilator',
    timestamp: Date.now(),
  });
  if (recentKills.length > 8) recentKills.pop();

  currentBoss = null;
  worldEventState.active = false;
  worldEventState.boss = null;
  worldEventState.eventName = 'Chiến Trường Tĩnh Lặng';
  worldEventState.message = 'Boss thế giới đã bị tiêu diệt! Chuẩn bị cho đợt tiếp theo...';
  eventCountdown = rand(75, 110);
  worldEventState.timeRemaining = eventCountdown;
}

// Game state containers
const players: Record<string, PlayerData> = {};
const playerInputs: Record<
  string,
  {
    up: boolean;
    down: boolean;
    left: boolean;
    right: boolean;
    shooting: boolean;
    angle: number;
    dash?: boolean;
  }
> = {};

let bullets: BulletData[] = [];
let shapes: ShapeData[] = [];
let nextShapeId = 1;
let nextBulletId = 1;
const recentKills: KillEvent[] = [];

// Helper functions
const rand = (min: number, max: number) => min + Math.random() * (max - min);

function xpNeed(level: number): number {
  return Math.floor(18 + 22 * level + Math.pow(level, 1.45) * 6);
}

function newStats() {
  return {
    regen: 0,
    health: 0,
    bodyDamage: 0,
    bulletSpeed: 0,
    bulletPen: 0,
    bulletDamage: 0,
    reload: 0,
    speed: 0,
  };
}

function maxHpOf(p: PlayerData): number {
  const cls = TANK_CLASSES[p.class] || TANK_CLASSES.basic;
  return (BASE_HP + 25 * p.stats.health) * cls.maxHpMult;
}

function speedOf(p: PlayerData): number {
  const cls = TANK_CLASSES[p.class] || TANK_CLASSES.basic;
  let spd = BASE_SPEED * (1 + 0.06 * p.stats.speed) * cls.speedMult;
  // Biome modifications
  const biome = getBiomeAt(p.x, p.y);
  if (biome?.type === 'ice') spd *= 1.25;
  return spd;
}

function damageOf(p: PlayerData): number {
  const cls = TANK_CLASSES[p.class] || TANK_CLASSES.basic;
  let dmg = BASE_DAMAGE * (1 + 0.22 * p.stats.bulletDamage) * cls.damageMult;
  if (weatherState.type === 'sandstorm') dmg *= 1.1;
  return dmg;
}

function bodyDamageOf(p: PlayerData): number {
  const cls = TANK_CLASSES[p.class] || TANK_CLASSES.basic;
  return (BASE_BODY_DAMAGE + 12 * p.stats.bodyDamage) * cls.bodyDamageMult;
}

function reloadOf(p: PlayerData): number {
  const cls = TANK_CLASSES[p.class] || TANK_CLASSES.basic;
  return BASE_RELOAD * Math.pow(0.86, p.stats.reload) * cls.reloadMult;
}

function bulletSpeedOf(p: PlayerData): number {
  let spd = BASE_BULLET_SPEED * (1 + 0.08 * p.stats.bulletSpeed);
  if (weatherState.type === 'rain') spd *= 1.15;
  return spd;
}

function addXp(p: PlayerData, amount: number) {
  let adjusted = amount;
  if (weatherState.type === 'aurora') adjusted *= 1.25;

  p.xp += adjusted;
  p.totalScore += Math.floor(adjusted);

  while (p.level < MAX_LEVEL && p.xp >= p.need) {
    p.xp -= p.need;
    p.level++;
    p.points++;
    p.need = xpNeed(p.level);

    // Bot automatic evolution & skill point distribution
    if (p.isBot) {
      botAutoUpgrade(p);
    }
  }
}

function botAutoUpgrade(bot: PlayerData) {
  // Upgrade a random stat
  const unmaxedStats = STAT_KEYS.filter((k) => bot.stats[k] < MAX_STAT);
  if (unmaxedStats.length > 0 && bot.points > 0) {
    const picked = unmaxedStats[Math.floor(Math.random() * unmaxedStats.length)];
    bot.stats[picked]++;
    bot.points--;
    if (picked === 'health') bot.hp += 25;
  }

  // Evolve class if level requirement met
  if (bot.level >= 45 && bot.class !== 'triplet') {
    const tier4 = AVAILABLE_CLASSES_BY_TIER[4];
    bot.class = tier4[Math.floor(Math.random() * tier4.length)];
  } else if (bot.level >= 30 && bot.class === 'basic') {
    const tier3 = AVAILABLE_CLASSES_BY_TIER[3];
    bot.class = tier3[Math.floor(Math.random() * tier3.length)];
  } else if (bot.level >= 15 && bot.class === 'basic') {
    const tier2 = AVAILABLE_CLASSES_BY_TIER[2];
    bot.class = tier2[Math.floor(Math.random() * tier2.length)];
  }
}

function getSafeSpawnCoords(): { x: number; y: number } {
  for (let attempt = 0; attempt < 30; attempt++) {
    const x = rand(300, MAP_SIZE - 300);
    const y = rand(300, MAP_SIZE - 300);
    const distToCenter = Math.hypot(x - MAP_SIZE / 2, y - MAP_SIZE / 2);
    // Stay clear of central nest (radius 560 + 150 margin)
    if (distToCenter < 720) continue;
    // Stay clear of lava biome (x: 2500, y: 2500 to 4000, 4000)
    if (x >= 2400 && y >= 2400) continue;
    return { x, y };
  }
  return { x: 800, y: 800 };
}

function resetPlayer(p: PlayerData) {
  p.level = 1;
  p.xp = 0;
  p.points = 0;
  p.stats = newStats();
  p.totalScore = 0;
  p.kills = 0;
  p.shapesDestroyed = 0;
  p.class = 'basic';
  p.need = xpNeed(1);
  const safePos = getSafeSpawnCoords();
  p.x = safePos.x;
  p.y = safePos.y;
  p.vx = 0;
  p.vy = 0;
  p.maxHp = maxHpOf(p);
  p.hp = p.maxHp;
  p.dashEnergy = 100;
  p.alive = true;
  p.aliveSeconds = 0;
  p.recoil = 0;
  p.invulnerableTimer = 4.0; // 4 seconds of spawn protection
}

// Shape Spawner
function spawnShape(forceNest: boolean = false) {
  const isCenter = forceNest || Math.random() < 0.25;
  let type: ShapeData['type'] = 'square';

  if (isCenter) {
    const roll = Math.random();
    if (roll < 0.05) type = 'alpha_pentagon';
    else if (roll < 0.35) type = 'crasher';
    else type = 'pentagon';
  } else {
    type = Math.random() < 0.3 ? 'triangle' : 'square';
  }

  let hp = 30;
  let xp = 10;
  let r = 20;

  let x = rand(100, MAP_SIZE - 100);
  let y = rand(100, MAP_SIZE - 100);

  if (type === 'triangle') {
    hp = 60;
    xp = 25;
    r = 24;
  } else if (type === 'pentagon') {
    hp = 220;
    xp = 130;
    r = 34;
    x = MAP_SIZE / 2 + rand(-400, 400);
    y = MAP_SIZE / 2 + rand(-400, 400);
  } else if (type === 'alpha_pentagon') {
    hp = 2500;
    xp = 3200;
    r = 85;
    x = MAP_SIZE / 2 + rand(-180, 180);
    y = MAP_SIZE / 2 + rand(-180, 180);
  } else if (type === 'crasher') {
    hp = 45;
    xp = 20;
    r = 16;
    x = MAP_SIZE / 2 + rand(-350, 350);
    y = MAP_SIZE / 2 + rand(-350, 350);
  }

  shapes.push({
    id: nextShapeId++,
    type,
    x,
    y,
    vx: 0,
    vy: 0,
    r,
    hp,
    maxHp: hp,
    xp,
    angle: rand(0, Math.PI * 2),
    spinSpeed: rand(-0.02, 0.02),
  });
}

// Populate initial shapes
for (let i = 0; i < SHAPE_COUNT; i++) spawnShape();

// Bot Creator
const BOT_NAMES = [
  'TerminatorX',
  'CyberStriker',
  'PhantomSniper',
  'VanguardBot',
  'OmegaTank',
  'NovaFighter',
  'ApexPredator',
  'Ragnarok',
  'ShadowReaper',
  'IronClad',
  'BlasterBot',
  'MatrixGhost',
];

const BOT_COLORS = [
  '#00b2e1',
  '#f14e54',
  '#10b981',
  '#f59e0b',
  '#8b5cf6',
  '#ec4899',
  '#06b6d4',
  '#14b8a6',
];

interface BotAIState {
  targetType: 'shape' | 'player' | 'wander';
  targetX: number;
  targetY: number;
  decisionTimer: number;
  aimError: number;
  fleeing: boolean;
}
const botAiStates: Record<string, BotAIState> = {};

function spawnBot() {
  const botId = 'bot_' + Math.floor(rand(1000, 9999));
  const botName = BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)];
  const botColor = BOT_COLORS[Math.floor(Math.random() * BOT_COLORS.length)];

  const p: PlayerData = {
    id: botId,
    name: botName,
    color: botColor,
    isBot: true,
    x: rand(300, MAP_SIZE - 300),
    y: rand(300, MAP_SIZE - 300),
    vx: 0,
    vy: 0,
    angle: rand(0, Math.PI * 2),
    class: 'basic',
    level: 1,
    xp: 0,
    need: xpNeed(1),
    points: 0,
    totalScore: 0,
    kills: 0,
    shapesDestroyed: 0,
    hp: BASE_HP,
    maxHp: BASE_HP,
    stats: newStats(),
    dashEnergy: 100,
    biome: 'neutral',
    alive: true,
    recoil: 0,
    aliveSeconds: 0,
    invulnerableTimer: 2.0,
  };

  resetPlayer(p);
  // Give bot gentle starting level (Level 1 - 4) so new players have a fair environment
  const initialBonus = Math.floor(rand(0, 250));
  addXp(p, initialBonus);

  players[botId] = p;
  playerInputs[botId] = {
    up: false,
    down: false,
    left: false,
    right: false,
    shooting: false,
    angle: p.angle,
  };
}

// Initial Bot Pool
for (let i = 0; i < MAX_BOTS; i++) {
  spawnBot();
}

// Socket IO Event Handling
io.on('connection', (socket) => {
  // Prepare player record
  const p: PlayerData = {
    id: socket.id,
    name: 'Hero Tank',
    color: '#00b2e1',
    isBot: false,
    x: rand(300, MAP_SIZE - 300),
    y: rand(300, MAP_SIZE - 300),
    vx: 0,
    vy: 0,
    angle: 0,
    class: 'basic',
    level: 1,
    xp: 0,
    need: xpNeed(1),
    points: 0,
    totalScore: 0,
    kills: 0,
    shapesDestroyed: 0,
    hp: BASE_HP,
    maxHp: BASE_HP,
    stats: newStats(),
    dashEnergy: 100,
    biome: 'neutral',
    alive: false, // Spawn when requested
    recoil: 0,
    aliveSeconds: 0,
    invulnerableTimer: 0,
  };

  players[socket.id] = p;
  playerInputs[socket.id] = {
    up: false,
    down: false,
    left: false,
    right: false,
    shooting: false,
    angle: 0,
  };

  // Notify client of their confirmed socket ID
  socket.emit('init', { id: socket.id, mapSize: MAP_SIZE });

  // Client requests spawn
  socket.on('spawn', (data: { name: string; color: string }) => {
    let pl = players[socket.id];
    if (!pl) {
      pl = {
        id: socket.id,
        name: 'Hero Tank',
        color: '#00b2e1',
        isBot: false,
        x: 800,
        y: 800,
        vx: 0,
        vy: 0,
        angle: 0,
        class: 'basic',
        level: 1,
        xp: 0,
        need: xpNeed(1),
        points: 0,
        totalScore: 0,
        kills: 0,
        shapesDestroyed: 0,
        hp: BASE_HP,
        maxHp: BASE_HP,
        stats: newStats(),
        dashEnergy: 100,
        biome: 'neutral',
        alive: true,
        recoil: 0,
        aliveSeconds: 0,
        invulnerableTimer: 4.0,
      };
      players[socket.id] = pl;
      playerInputs[socket.id] = {
        up: false,
        down: false,
        left: false,
        right: false,
        shooting: false,
        angle: 0,
      };
    }

    if (data.name && typeof data.name === 'string') {
      pl.name = data.name.trim().substring(0, 18) || 'Hero Tank';
    }
    if (data.color && typeof data.color === 'string') {
      pl.color = data.color;
    }
    resetPlayer(pl);
    pl.alive = true;
    pl.invulnerableTimer = 4.0;

    // Immediately send spawn confirmation with coordinates to client
    socket.emit('spawned', { id: socket.id, x: pl.x, y: pl.y });
  });

  // Client inputs
  socket.on('input', (input) => {
    const pl = players[socket.id];
    if (!pl || !pl.alive) return;

    playerInputs[socket.id] = {
      up: !!input.up,
      down: !!input.down,
      left: !!input.left,
      right: !!input.right,
      shooting: !!input.shooting,
      angle: Number.isFinite(input.angle) ? input.angle : pl.angle,
      dash: !!input.dash,
    };
    if (Number.isFinite(input.angle)) {
      pl.angle = input.angle;
    }
  });

  // Client upgrades skill stat
  socket.on('upgrade', (stat: StatKey) => {
    const pl = players[socket.id];
    if (!pl || !pl.alive || !STAT_KEYS.includes(stat)) return;
    if (pl.points <= 0 || pl.stats[stat] >= MAX_STAT) return;

    const cls = TANK_CLASSES[pl.class] || TANK_CLASSES.basic;
    if (
      cls.isSmasher &&
      ['bulletSpeed', 'bulletPen', 'bulletDamage', 'reload'].includes(stat)
    ) {
      return;
    }

    pl.stats[stat]++;
    pl.points--;
    if (stat === 'health') {
      pl.maxHp = maxHpOf(pl);
      pl.hp += 25;
    }
  });

  // Client selects evolved class
  socket.on('selectClass', (targetClass: TankClass) => {
    const pl = players[socket.id];
    if (!pl || !pl.alive) return;
    const targetDef = TANK_CLASSES[targetClass];
    if (!targetDef) return;
    if (pl.level < targetDef.reqLevel) return;

    pl.class = targetClass;
    pl.maxHp = maxHpOf(pl);
    pl.hp = Math.min(pl.hp, pl.maxHp);
  });

  socket.on('disconnect', () => {
    delete players[socket.id];
    delete playerInputs[socket.id];
  });
});

// Cooldown tracking for shooting
const playerCooldowns: Record<string, number> = {};

// Main Server Tick Loop (30 FPS)
setInterval(() => {
  const dt = 1 / TICK_RATE;

  // 1. Weather Update
  weatherTimeRemaining -= dt;
  if (weatherTimeRemaining <= 0) {
    currentWeatherIndex = (currentWeatherIndex + 1) % WEATHER_CYCLE.length;
    const nextW = WEATHER_CYCLE[currentWeatherIndex];
    weatherState.type = nextW.type;
    weatherState.name = nextW.name;
    weatherState.description = nextW.desc;
    weatherTimeRemaining = rand(60, 90);
  }
  weatherState.timeRemaining = weatherTimeRemaining;

  // 1.5 World Event & Boss AI Update
  if (!worldEventState.active) {
    eventCountdown -= dt;
    worldEventState.timeRemaining = Math.max(0, Math.round(eventCountdown));
    if (eventCountdown <= 0) {
      spawnWorldBoss();
    }
  } else if (currentBoss && currentBoss.alive) {
    worldEventState.timeRemaining -= dt;
    if (worldEventState.timeRemaining <= 0) {
      // Boss retreats if not defeated in time
      worldEventState.eventBannerText = `💨 ${currentBoss.title} ĐÃ RÚT LUI KHỎI CHIẾN TRƯỜNG!`;
      worldEventState.bannerExpiry = Date.now() + 6000;
      currentBoss = null;
      worldEventState.active = false;
      worldEventState.boss = null;
      eventCountdown = rand(70, 95);
      worldEventState.timeRemaining = eventCountdown;
    } else {
      // Boss Movement & Rotation
      currentBoss.angle += 0.015;

      // Find closest alive player/bot
      let targetP: PlayerData | null = null;
      let minD = 850;
      for (const pid in players) {
        const p = players[pid];
        if (!p.alive) continue;
        const d = Math.hypot(p.x - currentBoss.x, p.y - currentBoss.y);
        if (d < minD) {
          minD = d;
          targetP = p;
        }
      }

      // Drift towards target or central nest
      const destX = targetP ? targetP.x : MAP_SIZE / 2;
      const destY = targetP ? targetP.y : MAP_SIZE / 2;
      const toDestX = destX - currentBoss.x;
      const toDestY = destY - currentBoss.y;
      const destDist = Math.hypot(toDestX, toDestY);

      if (destDist > 160) {
        const bossSpd = currentBoss.type === 'fallen_booster' ? 120 : 65;
        currentBoss.vx += ((toDestX / destDist) * bossSpd - currentBoss.vx) * 3 * dt;
        currentBoss.vy += ((toDestY / destDist) * bossSpd - currentBoss.vy) * 3 * dt;
      } else {
        currentBoss.vx *= 0.92;
        currentBoss.vy *= 0.92;
      }

      currentBoss.x = Math.max(currentBoss.r, Math.min(MAP_SIZE - currentBoss.r, currentBoss.x + currentBoss.vx * dt));
      currentBoss.y = Math.max(currentBoss.r, Math.min(MAP_SIZE - currentBoss.r, currentBoss.y + currentBoss.vy * dt));

      // Boss Attacks
      bossAttackCooldown -= dt;
      if (bossAttackCooldown <= 0) {
        bossAttackCooldown = currentBoss.type === 'guardian' ? 1.5 : currentBoss.type === 'summoner' ? 2.0 : 1.8;

        const aimAng = targetP ? Math.atan2(targetP.y - currentBoss.y, targetP.x - currentBoss.x) : currentBoss.angle;

        if (currentBoss.type === 'summoner') {
          // Fires 4 golden square drone projectiles in 4 directions
          for (let i = 0; i < 4; i++) {
            const droneAng = currentBoss.angle + (i * Math.PI) / 2;
            bullets.push({
              id: nextBulletId++,
              owner: currentBoss.id,
              color: '#facc15',
              x: currentBoss.x + Math.cos(droneAng) * (currentBoss.r + 15),
              y: currentBoss.y + Math.sin(droneAng) * (currentBoss.r + 15),
              vx: Math.cos(droneAng) * 260,
              vy: Math.sin(droneAng) * 260,
              r: 13,
              damage: 28,
              hp: 45,
              life: 5.5,
              maxLife: 5.5,
              isDrone: true,
            });
          }
        } else if (currentBoss.type === 'guardian') {
          // Fires 3 pink crasher bursts
          for (let i = -1; i <= 1; i++) {
            const bAng = aimAng + i * 0.28;
            bullets.push({
              id: nextBulletId++,
              owner: currentBoss.id,
              color: '#f43f5e',
              x: currentBoss.x + Math.cos(bAng) * (currentBoss.r + 12),
              y: currentBoss.y + Math.sin(bAng) * (currentBoss.r + 12),
              vx: Math.cos(bAng) * 320,
              vy: Math.sin(bAng) * 320,
              r: 11,
              damage: 24,
              hp: 35,
              life: 4.0,
              maxLife: 4.0,
            });
          }
        } else if (currentBoss.type === 'fallen_booster') {
          // Fires 2 heavy cannon shells + rear thrust recoil
          for (const off of [-14, 14]) {
            const perpAng = aimAng + Math.PI / 2;
            bullets.push({
              id: nextBulletId++,
              owner: currentBoss.id,
              color: '#94a3b8',
              x: currentBoss.x + Math.cos(aimAng) * (currentBoss.r + 18) + Math.cos(perpAng) * off,
              y: currentBoss.y + Math.sin(aimAng) * (currentBoss.r + 18) + Math.sin(perpAng) * off,
              vx: Math.cos(aimAng) * 390,
              vy: Math.sin(aimAng) * 390,
              r: 15,
              damage: 34,
              hp: 60,
              life: 3.5,
              maxLife: 3.5,
            });
          }
          currentBoss.vx += Math.cos(aimAng) * 110;
          currentBoss.vy += Math.sin(aimAng) * 110;
        } else if (currentBoss.type === 'golden_meteor') {
          // Radial pulse of 6 golden crystal shards
          for (let i = 0; i < 6; i++) {
            const shardAng = currentBoss.angle + (i * Math.PI) / 3;
            bullets.push({
              id: nextBulletId++,
              owner: currentBoss.id,
              color: '#fbbf24',
              x: currentBoss.x + Math.cos(shardAng) * (currentBoss.r + 10),
              y: currentBoss.y + Math.sin(shardAng) * (currentBoss.r + 10),
              vx: Math.cos(shardAng) * 220,
              vy: Math.sin(shardAng) * 220,
              r: 10,
              damage: 22,
              hp: 30,
              life: 4.5,
              maxLife: 4.5,
            });
          }
        }
      }
    }
  }

  // 2. Maintain Bot Count
  const currentBotCount = Object.values(players).filter(
    (p) => p.isBot && p.alive
  ).length;
  if (currentBotCount < MAX_BOTS) {
    spawnBot();
  }

  // 3. AI Bot Decision Cycle (Smooth, Balanced, Human-like)
  for (const id in players) {
    const p = players[id];
    if (!p.isBot || !p.alive) continue;

    if (!botAiStates[id]) {
      botAiStates[id] = {
        targetType: 'wander',
        targetX: p.x,
        targetY: p.y,
        decisionTimer: rand(0.1, 0.3),
        aimError: rand(-0.15, 0.15),
        fleeing: false,
      };
    }

    const ai = botAiStates[id];
    ai.decisionTimer -= dt;

    // Evaluate decisions every 0.35s - 0.65s (prevents rapid jitter toggles)
    if (ai.decisionTimer <= 0) {
      ai.decisionTimer = rand(0.35, 0.65);
      ai.aimError = rand(-0.16, 0.16);

      const isLowHp = p.hp < p.maxHp * 0.32;
      ai.fleeing = isLowHp;

      // Find nearest player threat within moderate distance
      let nearestPlayer: PlayerData | null = null;
      let minPlayerDist = 420;

      for (const otherId in players) {
        if (otherId === id) continue;
        const op = players[otherId];
        if (!op.alive) continue;
        const d = Math.hypot(op.x - p.x, op.y - p.y);
        if (d < minPlayerDist) {
          minPlayerDist = d;
          nearestPlayer = op;
        }
      }

      if (isLowHp && nearestPlayer) {
        // Flee away from danger to give player space to breathe
        ai.targetType = 'wander';
        const fleeAngle = Math.atan2(p.y - nearestPlayer.y, p.x - nearestPlayer.x);
        ai.targetX = Math.max(300, Math.min(MAP_SIZE - 300, p.x + Math.cos(fleeAngle) * 500));
        ai.targetY = Math.max(300, Math.min(MAP_SIZE - 300, p.y + Math.sin(fleeAngle) * 500));
      } else if (nearestPlayer && Math.random() < 0.45) {
        // Only 45% chance to focus on player (keeps bots from ganging up)
        ai.targetType = 'player';
        ai.targetX = nearestPlayer.x;
        ai.targetY = nearestPlayer.y;
      } else {
        // Priority: Farm nearby shapes
        let nearestShape: ShapeData | null = null;
        let minShapeDist = 650;
        for (const s of shapes) {
          const d = Math.hypot(s.x - p.x, s.y - p.y);
          if (d < minShapeDist) {
            minShapeDist = d;
            nearestShape = s;
          }
        }

        if (nearestShape) {
          ai.targetType = 'shape';
          ai.targetX = nearestShape.x;
          ai.targetY = nearestShape.y;
        } else {
          ai.targetType = 'wander';
          ai.targetX = rand(500, MAP_SIZE - 500);
          ai.targetY = rand(500, MAP_SIZE - 500);
        }
      }
    }

    const inp = playerInputs[id];
    const dx = ai.targetX - p.x;
    const dy = ai.targetY - p.y;
    const distToTarget = Math.hypot(dx, dy);

    // Human-like smooth turn rate (max ~4.8 rad/s, no snap aimbot)
    const desiredAngle = Math.atan2(dy, dx) + ai.aimError;
    let angleDiff = desiredAngle - p.angle;
    while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
    while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

    const turnStep = Math.min(Math.abs(angleDiff), 4.8 * dt) * Math.sign(angleDiff);
    p.angle += turnStep;
    inp.angle = p.angle;

    // Shoot only when facing close to target and in range
    inp.shooting = Math.abs(angleDiff) < 0.42 && distToTarget < 520;

    // Smooth movement steering (no rapid up/down jitter)
    if (ai.fleeing) {
      inp.left = dx < -35;
      inp.right = dx > 35;
      inp.up = dy < -35;
      inp.down = dy > 35;
    } else if (distToTarget > 220) {
      inp.left = dx < -45;
      inp.right = dx > 45;
      inp.up = dy < -45;
      inp.down = dy > 45;
    } else {
      // Gentle strafe when close
      inp.left = false;
      inp.right = false;
      inp.up = false;
      inp.down = false;
    }
  }

  // 4. Player Physics & Movement
  for (const id in players) {
    const p = players[id];
    if (!p.alive) continue;
    p.aliveSeconds += dt;
    if (p.invulnerableTimer > 0) {
      p.invulnerableTimer = Math.max(0, p.invulnerableTimer - dt);
    }

    const inp = playerInputs[id] || {
      up: false,
      down: false,
      left: false,
      right: false,
      shooting: false,
      angle: 0,
    };

    let dx = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
    let dy = (inp.down ? 1 : 0) - (inp.up ? 1 : 0);
    if (dx !== 0 && dy !== 0) {
      dx *= Math.SQRT1_2;
      dy *= Math.SQRT1_2;
    }

    const maxSpd = speedOf(p);
    const biome = getBiomeAt(p.x, p.y);
    p.biome = biome ? biome.id : 'neutral';

    // Snappy, non-slippery traction & stopping physics
    const isIce = biome?.type === 'ice';
    const accel = isIce ? 8 : 36; // Instant response to inputs
    const friction = isIce ? 7 : 42; // Strong stopping grip, no ice-skating drift

    const targetVx = dx * maxSpd;
    const targetVy = dy * maxSpd;

    const rateX = dx !== 0 ? accel : friction;
    const rateY = dy !== 0 ? accel : friction;

    p.vx += (targetVx - p.vx) * rateX * dt;
    p.vy += (targetVy - p.vy) * rateY * dt;

    // Dash / Thruster burst
    p.dashEnergy = Math.min(100, p.dashEnergy + 25 * dt);
    if (inp.dash && p.dashEnergy >= 35) {
      p.dashEnergy -= 35;
      const dashAngle = dx !== 0 || dy !== 0 ? Math.atan2(dy, dx) : p.angle;
      p.vx += Math.cos(dashAngle) * 480;
      p.vy += Math.sin(dashAngle) * 480;
    }

    // Biome Environmental Effects
    if (biome?.type === 'sanctuary') {
      // 3x Natural Regen
      p.hp = Math.min(maxHpOf(p), p.hp + (6 + 3 * p.stats.regen) * dt);
    } else if (biome?.type === 'lava') {
      // Lava slight damage (only if not invulnerable)
      if (p.invulnerableTimer <= 0) {
        p.hp -= 2.5 * dt;
        if (p.hp <= 0) {
          p.alive = false;
          p.lastDamagedBy = 'Dung Nham Obsidian';
        }
      }
    } else {
      // Standard Regen
      p.hp = Math.min(maxHpOf(p), p.hp + (2.5 + 1.5 * p.stats.regen) * dt);
    }

    // Apply movement
    const cls = TANK_CLASSES[p.class] || TANK_CLASSES.basic;
    const bodyR = cls.bodyRadius || 24;

    p.x = Math.max(bodyR, Math.min(MAP_SIZE - bodyR, p.x + p.vx * dt));
    p.y = Math.max(bodyR, Math.min(MAP_SIZE - bodyR, p.y + p.vy * dt));

    // Recoil decay
    p.recoil = Math.max(0, p.recoil - 6 * dt);

    // Shooting
    if (!playerCooldowns[id]) playerCooldowns[id] = 0;
    playerCooldowns[id] -= dt;

    if (inp.shooting && playerCooldowns[id] <= 0 && !cls.isSmasher) {
      // Bots shoot 20% slower than players for better dodging opportunities
      playerCooldowns[id] = reloadOf(p) * (p.isBot ? 1.2 : 1.0);
      p.recoil = 1.0;

      // Spawn bullets for each barrel
      cls.barrels.forEach((b) => {
        let finalAngle = p.angle + b.angle;
        if (b.spread) finalAngle += rand(-b.spread, b.spread);
        if (p.isBot) finalAngle += rand(-0.06, 0.06);

        // Barrel muzzle tip coordinate
        const barrelLen = bodyR + b.length;
        const spawnX =
          p.x +
          Math.cos(p.angle) * barrelLen +
          Math.cos(p.angle + Math.PI / 2) * b.offset;
        const spawnY =
          p.y +
          Math.sin(p.angle) * barrelLen +
          Math.sin(p.angle + Math.PI / 2) * b.offset;

        // Recoil kickback on tank
        const recoilPwr = b.recoil || 3;
        p.vx -= Math.cos(finalAngle) * recoilPwr * 7;
        p.vy -= Math.sin(finalAngle) * recoilPwr * 7;

        // Bot bullets deal 35% less damage, travel 15% slower, and have less pen HP
        const bSpd = bulletSpeedOf(p) * (b.speedMult || 1) * (p.isBot ? 0.85 : 1.0);
        const bRadius = (b.bulletScale || 1.0) * (b.isTrapSpawner ? 13 : 8.5);
        const bDmg = damageOf(p) * (b.damageMult || 1) * (p.isBot ? 0.65 : 1.0);
        const bHp = (10 + 15 * p.stats.bulletPen) * (p.isBot ? 0.75 : 1.0);

        bullets.push({
          id: nextBulletId++,
          owner: id,
          color: p.color,
          x: spawnX,
          y: spawnY,
          vx: Math.cos(finalAngle) * bSpd,
          vy: Math.sin(finalAngle) * bSpd,
          r: bRadius,
          damage: bDmg,
          hp: bHp,
          life: b.isTrapSpawner ? 7.0 : 1.7,
          maxLife: b.isTrapSpawner ? 7.0 : 1.7,
          isDrone: !!b.isDroneSpawner,
          isTrap: !!b.isTrapSpawner,
        });
      });
    }
  }

  // 5. Crasher AI movement towards closest player in nest
  for (const s of shapes) {
    if (s.type === 'crasher') {
      let nearestP: PlayerData | null = null;
      let minD = 500;
      for (const id in players) {
        const p = players[id];
        if (!p.alive) continue;
        const d = Math.hypot(p.x - s.x, p.y - s.y);
        if (d < minD) {
          minD = d;
          nearestP = p;
        }
      }
      if (nearestP) {
        const angle = Math.atan2(nearestP.y - s.y, nearestP.x - s.x);
        s.vx += Math.cos(angle) * 220 * dt;
        s.vy += Math.sin(angle) * 220 * dt;
      }
      s.vx *= 0.94;
      s.vy *= 0.94;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
    }
    s.angle += s.spinSpeed;
  }

  // 6. Bullet Physics & Collisions
  for (const b of bullets) {
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.life -= dt;

    if (b.life <= 0) continue;

    // Bullet vs Tank collision
    for (const id in players) {
      if (id === b.owner || b.life <= 0) continue;
      const p = players[id];
      if (!p.alive) continue;

      const cls = TANK_CLASSES[p.class] || TANK_CLASSES.basic;
      const bodyR = cls.bodyRadius || 24;

      if (Math.hypot(p.x - b.x, p.y - b.y) < bodyR + b.r) {
        if (p.invulnerableTimer > 0) {
          b.life = 0; // Bullet absorbed harmlessly by spawn shield
          continue;
        }
        p.hp -= b.damage;
        b.life = 0;
        p.lastDamagedBy = players[b.owner]?.name || 'Chiến Xa Vô Danh';

        if (p.hp <= 0) {
          p.alive = false;
          const killer = players[b.owner];
          if (killer) {
            killer.kills++;
            addXp(killer, 120 + p.totalScore * 0.5);

            // Record Kill Event
            recentKills.unshift({
              id: 'kill_' + Date.now() + Math.random(),
              killerName: killer.name,
              victimName: p.name,
              killerColor: killer.color,
              victimColor: p.color,
              killerClass: killer.class,
              victimClass: p.class,
              timestamp: Date.now(),
            });
            if (recentKills.length > 8) recentKills.pop();
          }
        }
      }
    }

    if (b.life <= 0) continue;

    // Bullet vs Boss collision
    if (b.life > 0 && currentBoss && currentBoss.alive && !b.owner.startsWith('boss_')) {
      const dToBoss = Math.hypot(currentBoss.x - b.x, currentBoss.y - b.y);
      if (dToBoss < currentBoss.r + b.r) {
        currentBoss.hp -= b.damage;
        b.life = 0;
        currentBoss.lastDamagedBy = b.owner;

        if (currentBoss.hp <= 0 && currentBoss.alive) {
          currentBoss.alive = false;
          handleBossDefeated(players[b.owner]);
        }
        continue;
      }
    }

    // Bullet vs Shape collision
    for (const s of shapes) {
      if (Math.hypot(s.x - b.x, s.y - b.y) < s.r + b.r) {
        s.hp -= b.damage;
        b.life = 0;

        if (s.hp <= 0) {
          (s as unknown as { dead?: boolean }).dead = true;
          const owner = players[b.owner];
          if (owner) {
            owner.shapesDestroyed++;
            addXp(owner, s.xp);
          }
        }
        break;
      }
    }
  }

  // 7. Tank vs Shape Body Ramming Collisions
  for (const id in players) {
    const p = players[id];
    if (!p.alive) continue;

    const cls = TANK_CLASSES[p.class] || TANK_CLASSES.basic;
    const bodyR = cls.bodyRadius || 24;

    for (const s of shapes) {
      if ((s as unknown as { dead?: boolean }).dead) continue;
      const dx = s.x - p.x;
      const dy = s.y - p.y;
      const dist = Math.hypot(dx, dy);
      const minDist = bodyR + s.r;

      if (dist < minDist) {
        const overlap = minDist - dist;
        const nx = dist > 0.001 ? dx / dist : 1;
        const ny = dist > 0.001 ? dy / dist : 0;

        // Physical non-overlapping pushback so shapes & tanks do not clip
        s.x += nx * overlap * 0.7;
        s.y += ny * overlap * 0.7;
        p.x -= nx * overlap * 0.3;
        p.y -= ny * overlap * 0.3;

        // Bounce momentum impulse
        s.vx += nx * 140;
        s.vy += ny * 140;
        p.vx -= nx * 45;
        p.vy -= ny * 45;

        // Spawn shield protects tank from damage
        if (p.invulnerableTimer > 0) {
          continue;
        }

        // Proportional continuous contact damage
        const pBodyDmg = bodyDamageOf(p) * (p.isBot ? 0.7 : 1.0) * dt * 25;
        const sDmg = (s.type === 'crasher' ? 36 : s.type === 'alpha_pentagon' ? 55 : s.r * 1.1) * dt * 20;

        s.hp -= pBodyDmg;
        p.hp -= sDmg;
        p.lastDamagedBy = s.type === 'crasher' ? 'Crasher Đỏ' : `Khối ${s.type}`;

        if (s.hp <= 0) {
          (s as unknown as { dead?: boolean }).dead = true;
          p.shapesDestroyed++;
          addXp(p, s.xp);
        }

        if (p.hp <= 0 && p.alive) {
          p.alive = false;
        }
      }
    }
  }

  // 8. Tank vs Tank Ramming & Body Collisions (Player vs Player, Player vs Bot, Bot vs Bot)
  const activePlayers = Object.values(players).filter((p) => p.alive);
  for (let i = 0; i < activePlayers.length; i++) {
    const p1 = activePlayers[i];
    const cls1 = TANK_CLASSES[p1.class] || TANK_CLASSES.basic;
    const r1 = cls1.bodyRadius || 24;

    for (let j = i + 1; j < activePlayers.length; j++) {
      const p2 = activePlayers[j];
      const cls2 = TANK_CLASSES[p2.class] || TANK_CLASSES.basic;
      const r2 = cls2.bodyRadius || 24;

      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const dist = Math.hypot(dx, dy);
      const minDist = r1 + r2;

      if (dist < minDist) {
        const overlap = minDist - dist;
        const nx = dist > 0.001 ? dx / dist : 1;
        const ny = dist > 0.001 ? dy / dist : 0;

        // Physical non-overlapping separation (both pushed apart equally)
        p1.x -= nx * overlap * 0.5;
        p1.y -= ny * overlap * 0.5;
        p2.x += nx * overlap * 0.5;
        p2.y += ny * overlap * 0.5;

        // Pushback impulse
        const bounce = 110;
        p1.vx -= nx * bounce;
        p1.vy -= ny * bounce;
        p2.vx += nx * bounce;
        p2.vy += ny * bounce;

        // Exchange body damage if neither tank has an active spawn shield
        const p1Shield = p1.invulnerableTimer > 0;
        const p2Shield = p2.invulnerableTimer > 0;

        if (!p1Shield && !p2Shield) {
          const dmg1 = bodyDamageOf(p1) * (p1.isBot ? 0.65 : 1.0) * dt * 22;
          const dmg2 = bodyDamageOf(p2) * (p2.isBot ? 0.65 : 1.0) * dt * 22;

          p1.hp -= dmg2;
          p2.hp -= dmg1;
          p1.lastDamagedBy = p2.name;
          p2.lastDamagedBy = p1.name;

          // Check if p1 was destroyed by ramming
          if (p1.hp <= 0 && p1.alive) {
            p1.alive = false;
            p2.kills++;
            addXp(p2, 160 + p1.totalScore * 0.5);
            recentKills.unshift({
              id: 'kill_ram_' + Date.now() + Math.random(),
              killerName: p2.name,
              victimName: p1.name,
              killerColor: p2.color,
              victimColor: p1.color,
              killerClass: p2.class,
              victimClass: p1.class,
              timestamp: Date.now(),
            });
            if (recentKills.length > 8) recentKills.pop();
          }

          // Check if p2 was destroyed by ramming
          if (p2.hp <= 0 && p2.alive) {
            p2.alive = false;
            p1.kills++;
            addXp(p1, 160 + p2.totalScore * 0.5);
            recentKills.unshift({
              id: 'kill_ram_' + Date.now() + Math.random(),
              killerName: p1.name,
              victimName: p2.name,
              killerColor: p1.color,
              victimColor: p2.color,
              killerClass: p1.class,
              victimClass: p2.class,
              timestamp: Date.now(),
            });
            if (recentKills.length > 8) recentKills.pop();
          }
        }
      }
    }
  }

  // 8.5 Tank vs Boss Ramming & Body Collisions
  if (currentBoss && currentBoss.alive) {
    for (const id in players) {
      const p = players[id];
      if (!p.alive) continue;
      const cls = TANK_CLASSES[p.class] || TANK_CLASSES.basic;
      const bodyR = cls.bodyRadius || 24;
      const dist = Math.hypot(currentBoss.x - p.x, currentBoss.y - p.y);
      const minDist = currentBoss.r + bodyR;

      if (dist < minDist) {
        const overlap = minDist - dist;
        const nx = dist > 0.001 ? (p.x - currentBoss.x) / dist : 1;
        const ny = dist > 0.001 ? (p.y - currentBoss.y) / dist : 0;

        p.x += nx * overlap;
        p.y += ny * overlap;
        p.vx += nx * 240;
        p.vy += ny * 240;

        if (p.invulnerableTimer <= 0) {
          const pRamDmg = bodyDamageOf(p) * (p.isBot ? 0.7 : 1.0) * dt * 25;
          const bossRamDmg = 45 * dt * 20;

          currentBoss.hp -= pRamDmg;
          p.hp -= bossRamDmg;
          p.lastDamagedBy = currentBoss.title;
          currentBoss.lastDamagedBy = id;

          if (currentBoss.hp <= 0 && currentBoss.alive) {
            currentBoss.alive = false;
            handleBossDefeated(p);
          }
          if (p.hp <= 0 && p.alive) {
            p.alive = false;
          }
        }
      }
    }
  }

  // Cleanup dead bullets & shapes
  bullets = bullets.filter(
    (b) =>
      b.life > 0 &&
      b.x > -50 &&
      b.x < MAP_SIZE + 50 &&
      b.y > -50 &&
      b.y < MAP_SIZE + 50
  );
  shapes = shapes.filter((s) => !(s as unknown as { dead?: boolean }).dead);
  while (shapes.length < SHAPE_COUNT) spawnShape();

  // 8. Generate Real-time Top 10 Leaderboard
  const leaderboard: LeaderboardEntry[] = Object.values(players)
    .filter((p) => p.alive)
    .sort((a, b) => b.totalScore - a.totalScore)
    .slice(0, 10)
    .map((p) => ({
      id: p.id,
      name: p.name,
      score: Math.floor(p.totalScore),
      kills: p.kills,
      level: p.level,
      color: p.color,
      tankClass: p.class,
      isBot: p.isBot,
    }));

  // 9. Broadcast State to Clients
  io.emit('state', {
    players,
    bullets: bullets.map((b) => ({
      id: b.id,
      owner: b.owner,
      color: b.color,
      x: Math.round(b.x),
      y: Math.round(b.y),
      vx: b.vx,
      vy: b.vy,
      r: b.r,
      damage: b.damage,
      hp: b.hp,
      life: b.life,
      maxLife: b.maxLife,
      isDrone: b.isDrone,
      isTrap: b.isTrap,
    })),
    shapes: shapes.map((s) => ({
      id: s.id,
      type: s.type,
      x: Math.round(s.x),
      y: Math.round(s.y),
      vx: s.vx,
      vy: s.vy,
      r: s.r,
      hp: Math.round(s.hp),
      maxHp: s.maxHp,
      xp: s.xp,
      angle: s.angle,
      spinSpeed: s.spinSpeed,
    })),
    weather: weatherState,
    worldEvent: worldEventState,
    leaderboard,
    recentKills,
    mapSize: MAP_SIZE,
    serverTime: Date.now(),
  });
}, 1000 / TICK_RATE);

// Setup Express Static / Dev Mode
async function startServer() {
  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    });
  }

  server.listen(PORT, () => {
    console.log(`[DIEP.IO ENHANCED] Server running on http://localhost:${PORT}`);
  });
}

startServer();
