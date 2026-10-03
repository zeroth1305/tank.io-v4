import React, { useRef, useEffect } from 'react';
import {
  PlayerData,
  BulletData,
  ShapeData,
  WeatherState,
  Particle,
  DamageNumber,
  WorldEventState,
} from '../types/game.ts';
import { TANK_CLASSES } from '../constants/classes.ts';
import { BIOMES, MAP_SIZE } from '../constants/biomes.ts';

interface GameCanvasProps {
  myId: string | null;
  inGame?: boolean;
  spawnPos?: { x: number; y: number } | null;
  players: Record<string, PlayerData>;
  bullets: BulletData[];
  shapes: ShapeData[];
  weather: WeatherState;
  worldEvent?: WorldEventState;
  onMouseMove: (angle: number) => void;
  onMouseDown: () => void;
  onMouseUp: () => void;
  onRightClickDash?: () => void;
}

export const GameCanvas: React.FC<GameCanvasProps> = ({
  myId,
  inGame,
  spawnPos,
  players,
  bullets,
  shapes,
  weather,
  worldEvent,
  onMouseMove,
  onMouseDown,
  onMouseUp,
  onRightClickDash,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Sync props to refs for uninterrupted 60fps render loop
  const playersRef = useRef(players);
  const bulletsRef = useRef(bullets);
  const shapesRef = useRef(shapes);
  const weatherRef = useRef(weather);
  const worldEventRef = useRef(worldEvent);
  const myIdRef = useRef(myId);
  const inGameRef = useRef(inGame);

  useEffect(() => {
    playersRef.current = players;
    bulletsRef.current = bullets;
    shapesRef.current = shapes;
    weatherRef.current = weather;
    worldEventRef.current = worldEvent;
    myIdRef.current = myId;
    inGameRef.current = inGame;
  }, [players, bullets, shapes, weather, worldEvent, myId, inGame]);

  // Smooth camera position
  const camRef = useRef({ x: MAP_SIZE / 2, y: MAP_SIZE / 2 });
  const hasSnappedToPlayerRef = useRef(false);

  // Instant snap on spawnPos event
  useEffect(() => {
    if (spawnPos && Number.isFinite(spawnPos.x) && Number.isFinite(spawnPos.y)) {
      camRef.current.x = spawnPos.x;
      camRef.current.y = spawnPos.y;
      hasSnappedToPlayerRef.current = true;
    }
  }, [spawnPos]);

  // Particles & Floating Damage Numbers
  const particlesRef = useRef<Particle[]>([]);
  const damageNumsRef = useRef<DamageNumber[]>([]);
  const screenShakeRef = useRef({ x: 0, y: 0, intensity: 0 });
  const lightningFlashRef = useRef(0);
  const tankRenderPosRef = useRef<Record<string, { x: number; y: number; angle: number }>>({});

  // Setup canvas resize & pointer events
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleResize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };

    handleResize();
    window.addEventListener('resize', handleResize);

    const handleCanvasMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const currentMyId = myIdRef.current;
      let me = currentMyId ? playersRef.current[currentMyId] : null;
      if (!me) {
        for (const id in playersRef.current) {
          if (!playersRef.current[id].isBot) {
            me = playersRef.current[id];
            break;
          }
        }
      }

      // Calculate aim angle based on player's exact screen position
      let playerScreenX = canvas.width / 2;
      let playerScreenY = canvas.height / 2;
      if (me && me.alive) {
        const myRPos = tankRenderPosRef.current[me.id] || { x: me.x, y: me.y };
        const camX = camRef.current.x - canvas.width / 2;
        const camY = camRef.current.y - canvas.height / 2;
        playerScreenX = myRPos.x - camX;
        playerScreenY = myRPos.y - camY;
      }

      const angle = Math.atan2(mouseY - playerScreenY, mouseX - playerScreenX);
      onMouseMove(angle);
    };

    const handleCanvasMouseDown = (e: MouseEvent) => {
      if (e.button === 0) {
        onMouseDown();
      } else if (e.button === 2) {
        e.preventDefault();
        if (onRightClickDash) onRightClickDash();
      }
    };

    const handleCanvasMouseUp = (e: MouseEvent) => {
      if (e.button === 0) onMouseUp();
    };

    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };

    canvas.addEventListener('mousemove', handleCanvasMouseMove);
    canvas.addEventListener('mousedown', handleCanvasMouseDown);
    window.addEventListener('mouseup', handleCanvasMouseUp);
    canvas.addEventListener('contextmenu', handleContextMenu);

    return () => {
      window.removeEventListener('resize', handleResize);
      canvas.removeEventListener('mousemove', handleCanvasMouseMove);
      canvas.removeEventListener('mousedown', handleCanvasMouseDown);
      window.removeEventListener('mouseup', handleCanvasMouseUp);
      canvas.removeEventListener('contextmenu', handleContextMenu);
    };
  }, [onMouseMove, onMouseDown, onMouseUp, onRightClickDash]);

  // Persistent 60 FPS Render Loop
  useEffect(() => {
    let animId: number;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const render = (time: number) => {
      const w = canvas.width;
      const h = canvas.height;

      const currentMyId = myIdRef.current;
      const currentPlayers = playersRef.current;
      const currentBullets = bulletsRef.current;
      const currentShapes = shapesRef.current;
      const currentWeather = weatherRef.current;

      let me = currentMyId ? currentPlayers[currentMyId] : null;
      if (!me) {
        for (const id in currentPlayers) {
          if (!currentPlayers[id].isBot) {
            me = currentPlayers[id];
            break;
          }
        }
      }

      // Camera Centering & Smooth 60 FPS Follow
      if (me && me.alive) {
        const renderPosMap = tankRenderPosRef.current;
        if (!renderPosMap[me.id]) {
          renderPosMap[me.id] = { x: me.x, y: me.y, angle: me.angle };
        }
        const myRPos = renderPosMap[me.id];

        // Smoothly glide local player coordinates towards server updates
        if (Math.hypot(me.x - myRPos.x, me.y - myRPos.y) > 280) {
          myRPos.x = me.x;
          myRPos.y = me.y;
        } else {
          myRPos.x += (me.x - myRPos.x) * 0.52;
          myRPos.y += (me.y - myRPos.y) * 0.52;
        }
        myRPos.angle = me.angle;

        if (!hasSnappedToPlayerRef.current) {
          camRef.current.x = myRPos.x;
          camRef.current.y = myRPos.y;
          hasSnappedToPlayerRef.current = true;
        } else {
          // Smooth camera follow synced with interpolated player position
          camRef.current.x += (myRPos.x - camRef.current.x) * 0.22;
          camRef.current.y += (myRPos.y - camRef.current.y) * 0.22;
        }
      } else {
        hasSnappedToPlayerRef.current = false;
      }

      // Screen shake decay
      if (screenShakeRef.current.intensity > 0.1) {
        screenShakeRef.current.x =
          (Math.random() - 0.5) * screenShakeRef.current.intensity;
        screenShakeRef.current.y =
          (Math.random() - 0.5) * screenShakeRef.current.intensity;
        screenShakeRef.current.intensity *= 0.9;
      } else {
        screenShakeRef.current.x = 0;
        screenShakeRef.current.y = 0;
        screenShakeRef.current.intensity = 0;
      }

      const camX = camRef.current.x - w / 2 + screenShakeRef.current.x;
      const camY = camRef.current.y - h / 2 + screenShakeRef.current.y;

      // 1. Draw Void Background
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, 0, w, h);

      // 2. Draw Arena Map bounds
      ctx.save();
      ctx.translate(-camX, -camY);

      // Arena Floor
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(0, 0, MAP_SIZE, MAP_SIZE);

      // Arena Outer Border
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 8;
      ctx.strokeRect(0, 0, MAP_SIZE, MAP_SIZE);

      // 3. Draw Biomes
      for (const b of BIOMES) {
        ctx.save();
        if (b.type === 'nest' && b.radius) {
          // Central nest
          const grad = ctx.createRadialGradient(
            b.x,
            b.y,
            50,
            b.x,
            b.y,
            b.radius
          );
          grad.addColorStop(0, 'rgba(147, 51, 234, 0.25)');
          grad.addColorStop(1, 'rgba(124, 58, 237, 0.04)');
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2);
          ctx.fill();

          // Outer nest runic ring
          ctx.strokeStyle = '#a855f7';
          ctx.lineWidth = 3;
          ctx.setLineDash([16, 12]);
          ctx.stroke();
          ctx.setLineDash([]);
        } else if (b.width && b.height) {
          ctx.fillStyle = b.color;
          ctx.fillRect(b.x, b.y, b.width, b.height);
          ctx.strokeStyle = b.accent;
          ctx.lineWidth = 2;
          ctx.strokeRect(b.x, b.y, b.width, b.height);
        }
        ctx.restore();
      }

      // 4. Draw Grid
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
      ctx.lineWidth = 1;
      const gridSize = 45;
      const startX = Math.max(0, Math.floor(camX / gridSize) * gridSize);
      const endX = Math.min(
        MAP_SIZE,
        Math.ceil((camX + w) / gridSize) * gridSize
      );
      const startY = Math.max(0, Math.floor(camY / gridSize) * gridSize);
      const endY = Math.min(
        MAP_SIZE,
        Math.ceil((camY + h) / gridSize) * gridSize
      );

      ctx.beginPath();
      for (let x = startX; x <= endX; x += gridSize) {
        ctx.moveTo(x, startY);
        ctx.lineTo(x, endY);
      }
      for (let y = startY; y <= endY; y += gridSize) {
        ctx.moveTo(startX, y);
        ctx.lineTo(endX, y);
      }
      ctx.stroke();

      // 5. Draw Shapes (Squares, Triangles, Pentagons, Alpha Pentagons, Crashers)
      for (const s of currentShapes) {
        // Frustum culling
        if (
          s.x + s.r < camX ||
          s.x - s.r > camX + w ||
          s.y + s.r < camY ||
          s.y - s.r > camY + h
        ) {
          continue;
        }

        ctx.save();
        ctx.translate(s.x, s.y);
        ctx.rotate(s.angle);
        ctx.lineWidth = s.type === 'alpha_pentagon' ? 6 : 3;

        if (s.type === 'square') {
          ctx.fillStyle = '#ffe869';
          ctx.strokeStyle = '#bfae4e';
          ctx.fillRect(-s.r, -s.r, s.r * 2, s.r * 2);
          ctx.strokeRect(-s.r, -s.r, s.r * 2, s.r * 2);
        } else if (s.type === 'triangle' || s.type === 'crasher') {
          ctx.fillStyle = s.type === 'crasher' ? '#f43f5e' : '#fc7677';
          ctx.strokeStyle = s.type === 'crasher' ? '#be123c' : '#bd5859';
          ctx.beginPath();
          for (let i = 0; i < 3; i++) {
            const a = (i * Math.PI * 2) / 3 - Math.PI / 2;
            const px = Math.cos(a) * s.r * 1.15;
            const py = Math.sin(a) * s.r * 1.15;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.closePath();
          ctx.fill();
          ctx.stroke();

          // Crasher glowing eye
          if (s.type === 'crasher') {
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(0, 0, 4, 0, Math.PI * 2);
            ctx.fill();
          }
        } else if (s.type === 'pentagon' || s.type === 'alpha_pentagon') {
          ctx.fillStyle = s.type === 'alpha_pentagon' ? '#8b5cf6' : '#768dfc';
          ctx.strokeStyle = s.type === 'alpha_pentagon' ? '#6d28d9' : '#5569c7';
          ctx.beginPath();
          for (let i = 0; i < 5; i++) {
            const a = (i * Math.PI * 2) / 5 - Math.PI / 2;
            const px = Math.cos(a) * s.r * 1.1;
            const py = Math.sin(a) * s.r * 1.1;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        }

        ctx.restore();

        // Shape Health Bar (if damaged)
        if (s.hp < s.maxHp) {
          const barW = Math.max(30, s.r * 1.4);
          const barH = 5;
          const ratio = Math.max(0, s.hp / s.maxHp);
          ctx.fillStyle = 'rgba(0,0,0,0.5)';
          ctx.fillRect(s.x - barW / 2, s.y + s.r + 6, barW, barH);
          ctx.fillStyle = '#10b981';
          ctx.fillRect(s.x - barW / 2, s.y + s.r + 6, barW * ratio, barH);
        }
      }

      // 6. Draw Bullets, Drones & Traps
      for (const b of currentBullets) {
        if (
          b.x + b.r < camX ||
          b.x - b.r > camX + w ||
          b.y + b.r < camY ||
          b.y - b.r > camY + h
        ) {
          continue;
        }

        ctx.save();
        ctx.translate(b.x, b.y);

        if (b.isDrone) {
          const droneAngle = Math.atan2(b.vy, b.vx);
          ctx.rotate(droneAngle);
          ctx.beginPath();
          ctx.moveTo(b.r * 1.3, 0);
          ctx.lineTo(-b.r * 0.8, -b.r * 0.9);
          ctx.lineTo(-b.r * 0.8, b.r * 0.9);
          ctx.closePath();
          ctx.fillStyle = b.color;
          ctx.fill();
          ctx.strokeStyle = 'rgba(0,0,0,0.35)';
          ctx.lineWidth = 2;
          ctx.stroke();
        } else if (b.isTrap) {
          ctx.beginPath();
          for (let i = 0; i < 6; i++) {
            const a = (i * Math.PI) / 3;
            const r = i % 2 === 0 ? b.r * 1.4 : b.r * 0.6;
            const px = Math.cos(a) * r;
            const py = Math.sin(a) * r;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.closePath();
          ctx.fillStyle = '#f59e0b';
          ctx.fill();
          ctx.strokeStyle = '#d97706';
          ctx.lineWidth = 2;
          ctx.stroke();
        } else {
          ctx.beginPath();
          ctx.arc(0, 0, b.r, 0, Math.PI * 2);
          ctx.fillStyle = b.color;
          ctx.fill();
          ctx.lineWidth = Math.max(2, b.r * 0.2);
          ctx.strokeStyle = 'rgba(0,0,0,0.35)';
          ctx.stroke();
        }
        ctx.restore();
      }

      // 7. Draw Tanks (Both Player & Bots)
      const renderPosMap = tankRenderPosRef.current;

      for (const id in currentPlayers) {
        const p = currentPlayers[id];
        if (!p.alive) continue;

        const isMe = id === currentMyId || (me && id === me.id);

        if (!renderPosMap[id]) {
          renderPosMap[id] = { x: p.x, y: p.y, angle: p.angle };
        }
        const rPos = renderPosMap[id];
        if (isMe) {
          // Keep smooth myRPos already updated for camera sync
        } else {
          // Smooth 60 FPS interpolation towards 30 FPS server state
          rPos.x += (p.x - rPos.x) * 0.38;
          rPos.y += (p.y - rPos.y) * 0.38;
          let dAngle = p.angle - rPos.angle;
          while (dAngle > Math.PI) dAngle -= Math.PI * 2;
          while (dAngle < -Math.PI) dAngle += Math.PI * 2;
          rPos.angle += dAngle * 0.38;
        }

        const drawX = rPos.x;
        const drawY = rPos.y;
        const drawAngle = rPos.angle;

        // Frustum culling: NEVER cull the local player's tank!
        if (
          !isMe &&
          (drawX + 120 < camX ||
            drawX - 120 > camX + w ||
            drawY + 120 < camY ||
            drawY - 120 > camY + h)
        ) {
          continue;
        }

        const cls = TANK_CLASSES[p.class] || TANK_CLASSES.basic;
        const radius = cls.bodyRadius || 24;

        ctx.save();
        ctx.translate(drawX, drawY);

        // Highlight ring under local player's tank
        if (isMe) {
          ctx.save();
          ctx.beginPath();
          ctx.arc(0, 0, radius + 8, 0, Math.PI * 2);
          ctx.strokeStyle = '#22d3ee';
          ctx.lineWidth = 2.5;
          ctx.setLineDash([5, 4]);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.restore();
        }

        // A. Barrels
        ctx.save();
        ctx.rotate(drawAngle);
        ctx.fillStyle = '#64748b';
        ctx.strokeStyle = '#334155';
        ctx.lineWidth = 3;

        cls.barrels.forEach((b) => {
          ctx.save();
          ctx.rotate(b.angle);

          const recoilOffset = p.recoil ? p.recoil * (b.recoil || 3) * 0.5 : 0;
          const barrelLen = radius + b.length - recoilOffset;
          const barrelW = b.width;
          const lateral = b.offset;

          if (b.isDroneSpawner) {
            ctx.beginPath();
            ctx.moveTo(radius * 0.5, -barrelW / 2 + lateral);
            ctx.lineTo(barrelLen, -barrelW * 0.7 + lateral);
            ctx.lineTo(barrelLen, barrelW * 0.7 + lateral);
            ctx.lineTo(radius * 0.5, barrelW / 2 + lateral);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
          } else if (b.isTrapSpawner) {
            ctx.beginPath();
            ctx.moveTo(radius * 0.7, -barrelW / 2 + lateral);
            ctx.lineTo(barrelLen, -barrelW / 2 + lateral);
            ctx.lineTo(barrelLen + 6, lateral);
            ctx.lineTo(barrelLen, barrelW / 2 + lateral);
            ctx.lineTo(radius * 0.7, barrelW / 2 + lateral);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
          } else {
            ctx.fillRect(0, -barrelW / 2 + lateral, barrelLen, barrelW);
            ctx.strokeRect(0, -barrelW / 2 + lateral, barrelLen, barrelW);
          }
          ctx.restore();
        });
        ctx.restore(); // Restore rotate(p.angle)

        // B. Tank Body
        if (cls.isSmasher) {
          ctx.save();
          ctx.rotate(time * 0.003);
          ctx.beginPath();
          for (let i = 0; i < 8; i++) {
            const a = (i * Math.PI) / 4;
            const rOuter = radius + 9;
            const rInner = radius + 2;
            const ox = Math.cos(a) * rOuter;
            const oy = Math.sin(a) * rOuter;
            const ix = Math.cos(a + Math.PI / 8) * rInner;
            const iy = Math.sin(a + Math.PI / 8) * rInner;
            if (i === 0) ctx.moveTo(ox, oy);
            else {
              ctx.lineTo(ox, oy);
              ctx.lineTo(ix, iy);
            }
          }
          ctx.closePath();
          ctx.fillStyle = '#475569';
          ctx.fill();
          ctx.strokeStyle = '#334155';
          ctx.lineWidth = 3;
          ctx.stroke();
          ctx.restore();
        }

        // Inner Hull Circle
        ctx.beginPath();
        ctx.arc(0, 0, radius, 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.fill();
        ctx.lineWidth = 3.5;
        ctx.strokeStyle = 'rgba(0,0,0,0.35)';
        ctx.stroke();

        // Bot badge or player star
        if (p.isBot) {
          ctx.fillStyle = 'rgba(0,0,0,0.2)';
          ctx.beginPath();
          ctx.arc(0, 0, radius * 0.45, 0, Math.PI * 2);
          ctx.fill();
        }

        // Invulnerability Shield Forcefield
        if (p.invulnerableTimer && p.invulnerableTimer > 0) {
          ctx.save();
          const shieldRadius = radius + 10 + Math.sin(time * 0.01) * 2;
          ctx.beginPath();
          ctx.arc(0, 0, shieldRadius, 0, Math.PI * 2);
          ctx.strokeStyle = '#38bdf8';
          ctx.lineWidth = 2.5;
          ctx.setLineDash([8, 6]);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = 'rgba(56, 189, 248, 0.18)';
          ctx.fill();
          ctx.restore();
        }

        // C. Health bar & Name HUD
        const hpBarW = Math.max(48, radius * 2.2);
        const hpBarH = 5;
        const hpRatio = Math.max(0, p.hp / p.maxHp);

        // Local Player Indicator Banner
        if (isMe) {
          ctx.fillStyle = '#22d3ee';
          ctx.font = 'bold 10px JetBrains Mono, monospace';
          ctx.textAlign = 'center';
          ctx.shadowColor = 'rgba(0,0,0,0.8)';
          ctx.shadowBlur = 4;
          ctx.fillText('▼ BẠN ▼', 0, -radius - 28);
          ctx.shadowBlur = 0;
        }

        // Invulnerability Shield Tag
        if (p.invulnerableTimer && p.invulnerableTimer > 0) {
          ctx.fillStyle = '#38bdf8';
          ctx.font = 'bold 10px JetBrains Mono, monospace';
          ctx.textAlign = 'center';
          ctx.fillText(`🛡️ KHIÊN (${Math.ceil(p.invulnerableTimer)}s)`, 0, -radius - (isMe ? 38 : 28));
        }

        // Player Name & Level Badge
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 12px Plus Jakarta Sans, sans-serif';
        ctx.textAlign = 'center';
        ctx.shadowColor = 'rgba(0,0,0,0.8)';
        ctx.shadowBlur = 4;
        ctx.fillText(`${p.name} [Lv ${p.level}]`, 0, -radius - 14);
        ctx.shadowBlur = 0;

        // Health bar
        if (p.hp < p.maxHp || isMe) {
          ctx.fillStyle = 'rgba(0,0,0,0.5)';
          ctx.fillRect(-hpBarW / 2, radius + 8, hpBarW, hpBarH);
          ctx.fillStyle = hpRatio > 0.3 ? '#10b981' : '#ef4444';
          ctx.fillRect(-hpBarW / 2, radius + 8, hpBarW * hpRatio, hpBarH);

          // Dash energy bar (if my tank)
          if (isMe) {
            const dashW = hpBarW * (p.dashEnergy / 100);
            ctx.fillStyle = '#06b6d4';
            ctx.fillRect(-hpBarW / 2, radius + 15, dashW, 3);
          }
        }

        ctx.restore(); // Restore translate(drawX, drawY)
      }

      // Cleanup despawned or dead tanks from interpolation cache
      for (const id in renderPosMap) {
        if (!currentPlayers[id] || !currentPlayers[id].alive) {
          delete renderPosMap[id];
        }
      }

      // 7.5 Draw World Boss
      const currentBoss = worldEventRef.current?.boss;
      if (currentBoss && currentBoss.alive) {
        const b = currentBoss;
        const isOnScreen =
          b.x + b.r * 2 >= camX &&
          b.x - b.r * 2 <= camX + w &&
          b.y + b.r * 2 >= camY &&
          b.y - b.r * 2 <= camY + h;

        if (isOnScreen) {
          ctx.save();
          ctx.translate(b.x, b.y);

          // Pulsing aura ring
          ctx.save();
          ctx.beginPath();
          ctx.arc(0, 0, b.r + 14 + Math.sin(time * 0.008) * 5, 0, Math.PI * 2);
          ctx.strokeStyle = b.color;
          ctx.lineWidth = 4;
          ctx.setLineDash([10, 8]);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = `${b.color}22`;
          ctx.fill();
          ctx.restore();

          if (b.type === 'summoner') {
            // Golden Square with 4 corner drone bays
            ctx.save();
            ctx.rotate(b.angle);

            // 4 Corner drone spawner tubes
            ctx.fillStyle = '#64748b';
            ctx.strokeStyle = '#334155';
            ctx.lineWidth = 3;
            for (let i = 0; i < 4; i++) {
              ctx.save();
              ctx.rotate((i * Math.PI) / 2);
              ctx.fillRect(b.r * 0.4, -b.r * 0.22, b.r * 0.7, b.r * 0.44);
              ctx.strokeRect(b.r * 0.4, -b.r * 0.22, b.r * 0.7, b.r * 0.44);
              ctx.restore();
            }

            // Central golden hull
            ctx.fillStyle = '#eab308';
            ctx.strokeStyle = '#ca8a04';
            ctx.lineWidth = 6;
            ctx.fillRect(-b.r * 0.7, -b.r * 0.7, b.r * 1.4, b.r * 1.4);
            ctx.strokeRect(-b.r * 0.7, -b.r * 0.7, b.r * 1.4, b.r * 1.4);

            // Glowing diamond core
            ctx.rotate(Math.PI / 4);
            ctx.fillStyle = '#fef08a';
            ctx.fillRect(-b.r * 0.28, -b.r * 0.28, b.r * 0.56, b.r * 0.56);
            ctx.restore();
          } else if (b.type === 'guardian') {
            // Giant Pink Triangle with 3 vertex spawner tubes
            ctx.save();
            ctx.rotate(b.angle);

            // 3 Vertex spawner tubes
            ctx.fillStyle = '#64748b';
            ctx.strokeStyle = '#334155';
            ctx.lineWidth = 3;
            for (let i = 0; i < 3; i++) {
              ctx.save();
              ctx.rotate((i * Math.PI * 2) / 3 - Math.PI / 2);
              ctx.fillRect(-b.r * 0.2, b.r * 0.6, b.r * 0.4, b.r * 0.55);
              ctx.strokeRect(-b.r * 0.2, b.r * 0.6, b.r * 0.4, b.r * 0.55);
              ctx.restore();
            }

            // Triangle Hull
            ctx.beginPath();
            for (let i = 0; i < 3; i++) {
              const a = (i * Math.PI * 2) / 3 - Math.PI / 2;
              const px = Math.cos(a) * b.r * 1.25;
              const py = Math.sin(a) * b.r * 1.25;
              if (i === 0) ctx.moveTo(px, py);
              else ctx.lineTo(px, py);
            }
            ctx.closePath();
            ctx.fillStyle = '#f43f5e';
            ctx.strokeStyle = '#be123c';
            ctx.lineWidth = 6;
            ctx.fill();
            ctx.stroke();

            // Glowing eye core
            ctx.beginPath();
            ctx.arc(0, 0, b.r * 0.32, 0, Math.PI * 2);
            ctx.fillStyle = '#ffffff';
            ctx.fill();
            ctx.restore();
          } else if (b.type === 'fallen_booster') {
            // Fallen Booster: Dark steel with 2 front barrels and 4 rear thrusters
            ctx.save();
            ctx.rotate(b.angle);

            ctx.fillStyle = '#64748b';
            ctx.strokeStyle = '#1e293b';
            ctx.lineWidth = 3;

            // 2 Front destroyer barrels
            ctx.fillRect(b.r * 0.2, -b.r * 0.45, b.r * 1.1, b.r * 0.35);
            ctx.strokeRect(b.r * 0.2, -b.r * 0.45, b.r * 1.1, b.r * 0.35);
            ctx.fillRect(b.r * 0.2, b.r * 0.1, b.r * 1.1, b.r * 0.35);
            ctx.strokeRect(b.r * 0.2, b.r * 0.1, b.r * 1.1, b.r * 0.35);

            // 4 Rear booster thrusters
            for (const angleOff of [2.4, 2.7, 3.5, 3.8]) {
              ctx.save();
              ctx.rotate(angleOff);
              ctx.fillRect(b.r * 0.3, -b.r * 0.18, b.r * 0.8, b.r * 0.36);
              ctx.strokeRect(b.r * 0.3, -b.r * 0.18, b.r * 0.8, b.r * 0.36);
              ctx.fillStyle = '#f97316';
              ctx.beginPath();
              ctx.arc(b.r * 1.15, 0, 8, 0, Math.PI * 2);
              ctx.fill();
              ctx.restore();
            }

            // Dark tank body
            ctx.beginPath();
            ctx.arc(0, 0, b.r, 0, Math.PI * 2);
            ctx.fillStyle = '#334155';
            ctx.strokeStyle = '#0f172a';
            ctx.lineWidth = 5;
            ctx.fill();
            ctx.stroke();
            ctx.restore();
          } else {
            // Golden Celestial Meteor (12-sided faceted crystal)
            ctx.save();
            ctx.rotate(b.angle * 0.5);
            ctx.beginPath();
            for (let i = 0; i < 12; i++) {
              const a = (i * Math.PI * 2) / 12;
              const rad = i % 2 === 0 ? b.r * 1.15 : b.r * 0.9;
              const px = Math.cos(a) * rad;
              const py = Math.sin(a) * rad;
              if (i === 0) ctx.moveTo(px, py);
              else ctx.lineTo(px, py);
            }
            ctx.closePath();
            ctx.fillStyle = '#f59e0b';
            ctx.strokeStyle = '#d97706';
            ctx.lineWidth = 6;
            ctx.fill();
            ctx.stroke();

            // Inner facet lines
            ctx.strokeStyle = '#fef08a';
            ctx.lineWidth = 2;
            for (let i = 0; i < 6; i++) {
              const a = (i * Math.PI) / 3;
              ctx.beginPath();
              ctx.moveTo(0, 0);
              ctx.lineTo(Math.cos(a) * b.r * 0.8, Math.sin(a) * b.r * 0.8);
              ctx.stroke();
            }
            ctx.restore();
          }

          // Boss Health Bar above boss
          const bHpBarW = Math.max(140, b.r * 2.5);
          const bHpBarH = 8;
          const bRatio = Math.max(0, b.hp / b.maxHp);

          ctx.fillStyle = 'rgba(0,0,0,0.65)';
          ctx.fillRect(-bHpBarW / 2, -b.r - 28, bHpBarW, bHpBarH);
          ctx.fillStyle = '#ef4444';
          ctx.fillRect(-bHpBarW / 2, -b.r - 28, bHpBarW * bRatio, bHpBarH);
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1;
          ctx.strokeRect(-bHpBarW / 2, -b.r - 28, bHpBarW, bHpBarH);

          // Boss Name Tag
          ctx.fillStyle = '#facc15';
          ctx.font = 'bold 14px Plus Jakarta Sans, sans-serif';
          ctx.textAlign = 'center';
          ctx.shadowColor = 'rgba(0,0,0,0.9)';
          ctx.shadowBlur = 6;
          ctx.fillText(`👑 ${b.title}`, 0, -b.r - 34);
          ctx.shadowBlur = 0;

          ctx.restore();
        }
      }

      // 8. Draw Particles
      for (let i = particlesRef.current.length - 1; i >= 0; i--) {
        const pt = particlesRef.current[i];
        pt.x += pt.vx;
        pt.y += pt.vy;
        pt.alpha -= pt.decay;

        if (pt.alpha <= 0) {
          particlesRef.current.splice(i, 1);
          continue;
        }

        ctx.save();
        ctx.globalAlpha = Math.max(0, pt.alpha);
        ctx.fillStyle = pt.color;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, pt.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // 9. Floating Damage Numbers
      for (let i = damageNumsRef.current.length - 1; i >= 0; i--) {
        const d = damageNumsRef.current[i];
        d.x += d.vx;
        d.y += d.vy;
        d.life -= 0.02;

        if (d.life <= 0) {
          damageNumsRef.current.splice(i, 1);
          continue;
        }

        ctx.save();
        ctx.globalAlpha = Math.min(1, d.life * 1.5);
        ctx.fillStyle = d.color;
        ctx.font = `${d.crit ? 'bold 15px' : 'bold 12px'} JetBrains Mono, monospace`;
        ctx.textAlign = 'center';
        ctx.shadowColor = 'rgba(0,0,0,0.8)';
        ctx.shadowBlur = 4;
        ctx.fillText(d.text, d.x, d.y);
        ctx.restore();
      }

      ctx.restore(); // Restore camera transform

      // 10. Weather Screen Overlays
      if (currentWeather.type === 'rain') {
        ctx.save();
        ctx.strokeStyle = 'rgba(186, 230, 253, 0.25)';
        ctx.lineWidth = 1.5;
        const dropCount = 45;
        for (let i = 0; i < dropCount; i++) {
          const rx = (Math.sin(i * 99 + time * 0.001) * 0.5 + 0.5) * w;
          const ry = (time * 0.9 + i * 40) % h;
          ctx.beginPath();
          ctx.moveTo(rx, ry);
          ctx.lineTo(rx - 4, ry + 16);
          ctx.stroke();
        }

        if (Math.random() < 0.002) {
          lightningFlashRef.current = 0.4;
        }
        if (lightningFlashRef.current > 0) {
          ctx.fillStyle = `rgba(224, 242, 254, ${lightningFlashRef.current})`;
          ctx.fillRect(0, 0, w, h);
          lightningFlashRef.current -= 0.04;
        }
        ctx.restore();
      } else if (currentWeather.type === 'sandstorm') {
        ctx.save();
        ctx.fillStyle = 'rgba(245, 158, 11, 0.07)';
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = 'rgba(251, 191, 36, 0.25)';
        for (let i = 0; i < 30; i++) {
          const sx = (time * 0.6 + i * 70) % w;
          const sy = (Math.cos(i * 45 + time * 0.002) * 0.5 + 0.5) * h;
          ctx.fillRect(sx, sy, 3, 2);
        }
        ctx.restore();
      } else if (currentWeather.type === 'aurora') {
        ctx.save();
        const grad = ctx.createLinearGradient(0, 0, w, h);
        grad.addColorStop(0, 'rgba(168, 85, 247, 0.08)');
        grad.addColorStop(0.5, 'rgba(6, 182, 212, 0.06)');
        grad.addColorStop(1, 'rgba(16, 185, 129, 0.06)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);
        ctx.restore();
      }

      // 11. Screen Vignette
      const vig = ctx.createRadialGradient(
        w / 2,
        h / 2,
        Math.min(w, h) * 0.4,
        w / 2,
        h / 2,
        Math.max(w, h) * 0.7
      );
      vig.addColorStop(0, 'rgba(0,0,0,0)');
      vig.addColorStop(1, 'rgba(2, 6, 23, 0.45)');
      ctx.fillStyle = vig;
      ctx.fillRect(0, 0, w, h);

      // 11.5 Off-Screen Boss Directional Radar Pointer
      const activeBoss = worldEventRef.current?.boss;
      if (activeBoss && activeBoss.alive && me && me.alive) {
        const camCenterX = camRef.current.x;
        const camCenterY = camRef.current.y;
        const dx = activeBoss.x - camCenterX;
        const dy = activeBoss.y - camCenterY;
        const dist = Math.hypot(dx, dy);

        const isOnScreen =
          activeBoss.x + activeBoss.r >= camX &&
          activeBoss.x - activeBoss.r <= camX + w &&
          activeBoss.y + activeBoss.r >= camY &&
          activeBoss.y - activeBoss.r <= camY + h;

        if (!isOnScreen && dist > 100) {
          const edgeMargin = 50;
          const angle = Math.atan2(dy, dx);
          const halfW = w / 2 - edgeMargin;
          const halfH = h / 2 - edgeMargin;
          const slope = dy / (dx || 0.0001);

          let edgeX = 0;
          let edgeY = 0;

          if (Math.abs(slope) < halfH / halfW) {
            edgeX = dx > 0 ? halfW : -halfW;
            edgeY = edgeX * slope;
          } else {
            edgeY = dy > 0 ? halfH : -halfH;
            edgeX = edgeY / slope;
          }

          const screenPointerX = w / 2 + edgeX;
          const screenPointerY = h / 2 + edgeY;

          ctx.save();
          ctx.translate(screenPointerX, screenPointerY);
          ctx.rotate(angle);

          // Glowing Pointer chevron arrow
          ctx.fillStyle = activeBoss.color;
          ctx.beginPath();
          ctx.moveTo(16, 0);
          ctx.lineTo(-8, -11);
          ctx.lineTo(-3, 0);
          ctx.lineTo(-8, 11);
          ctx.closePath();
          ctx.fill();
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 2;
          ctx.stroke();

          // Distance tag badge
          ctx.rotate(-angle);
          ctx.font = 'bold 11px JetBrains Mono, monospace';
          ctx.fillStyle = '#facc15';
          ctx.textAlign = 'center';
          ctx.shadowColor = 'rgba(0,0,0,0.9)';
          ctx.shadowBlur = 5;
          ctx.fillText(`👑 BOSS ${Math.round(dist / 10)}m`, 0, angle > 0 ? -16 : 22);
          ctx.shadowBlur = 0;

          ctx.restore();
        }
      }

      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animId);
  }, []); // Run persistent 60fps loop once on mount

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full cursor-crosshair block select-none bg-slate-950"
    />
  );
};
