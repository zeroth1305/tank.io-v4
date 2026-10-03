import React from 'react';
import { WorldEventState, PlayerData } from '../types/game';
import { Skull, Trophy, Sparkles, Navigation, Swords, Timer } from 'lucide-react';

interface WorldEventHUDProps {
  worldEvent: WorldEventState;
  me: PlayerData | null;
}

export const WorldEventHUD: React.FC<WorldEventHUDProps> = ({ worldEvent, me }) => {
  const boss = worldEvent.boss;
  const isBannerVisible =
    worldEvent.eventBannerText &&
    worldEvent.bannerExpiry &&
    Date.now() < worldEvent.bannerExpiry;

  // Calculate distance & direction to boss
  let distText = '';
  let compassDirection = '';
  if (boss && me && me.alive) {
    const dx = boss.x - me.x;
    const dy = boss.y - me.y;
    const dist = Math.hypot(dx, dy);
    distText = `${Math.round(dist / 10)}m`;

    const angle = Math.atan2(dy, dx);
    const deg = (angle * 180) / Math.PI;
    if (deg >= -22.5 && deg < 22.5) compassDirection = 'Đông ➔';
    else if (deg >= 22.5 && deg < 67.5) compassDirection = 'Đông Nam ➘';
    else if (deg >= 67.5 && deg < 112.5) compassDirection = 'Nam ⬇';
    else if (deg >= 112.5 && deg < 157.5) compassDirection = 'Tây Nam ↙';
    else if (deg >= 157.5 || deg < -157.5) compassDirection = 'Tây ⬅';
    else if (deg >= -157.5 && deg < -112.5) compassDirection = 'Tây Bắc ↖';
    else if (deg >= -112.5 && deg < -67.5) compassDirection = 'Bắc ⬆';
    else compassDirection = 'Đông Bắc ↗';
  }

  const hpRatio = boss ? Math.max(0, boss.hp / boss.maxHp) : 0;

  return (
    <>
      {/* 1. Global Announcement Banner Toast */}
      {isBannerVisible && (
        <div className="fixed top-14 left-1/2 -translate-x-1/2 z-50 pointer-events-none animate-bounce">
          <div className="px-6 py-2.5 rounded-2xl bg-gradient-to-r from-amber-600/95 via-rose-600/95 to-amber-600/95 backdrop-blur-md border-2 border-amber-300 shadow-[0_0_30px_rgba(245,158,11,0.6)] text-white text-xs sm:text-sm font-extrabold flex items-center gap-2.5 tracking-wide">
            <Sparkles className="w-5 h-5 text-amber-200 animate-spin" />
            <span>{worldEvent.eventBannerText}</span>
            <Sparkles className="w-5 h-5 text-amber-200 animate-spin" />
          </div>
        </div>
      )}

      {/* 2. Top-Center Raid Boss / World Event HUD */}
      <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 pointer-events-auto flex flex-col items-center">
        {worldEvent.active && boss && boss.alive ? (
          <div className="bg-slate-950/85 backdrop-blur-md border border-amber-500/50 rounded-2xl p-2.5 px-4 shadow-[0_0_20px_rgba(245,158,11,0.25)] min-w-[280px] sm:min-w-[380px] max-w-lg transition-all animate-pulse">
            {/* Header info */}
            <div className="flex items-center justify-between gap-3 mb-1.5">
              <div className="flex items-center gap-2">
                <span className="p-1 rounded-lg bg-amber-500/20 text-amber-400 border border-amber-500/30">
                  <Skull className="w-4 h-4 animate-bounce" />
                </span>
                <div>
                  <h4 className="text-xs sm:text-sm font-black text-amber-300 tracking-wide flex items-center gap-1.5">
                    {boss.title}
                  </h4>
                  <p className="text-[10px] text-slate-400">
                    Thưởng kết liễu: <span className="text-emerald-400 font-bold">+{boss.xpReward.toLocaleString()} XP</span>
                  </p>
                </div>
              </div>

              {/* Distance & Compass indicator */}
              {distText && (
                <div className="text-right">
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-900 border border-slate-700 text-[10px] font-mono text-cyan-300">
                    <Navigation className="w-3 h-3 text-cyan-400" />
                    {distText} {compassDirection}
                  </span>
                  <div className="text-[9px] text-slate-400 mt-0.5 font-mono">
                    Còn {Math.round(worldEvent.timeRemaining)}s
                  </div>
                </div>
              )}
            </div>

            {/* Boss Raid Health Bar */}
            <div className="relative w-full h-3.5 bg-slate-900 rounded-full overflow-hidden border border-slate-700/80 p-0.5">
              <div
                className="h-full rounded-full transition-all duration-150 bg-gradient-to-r from-amber-500 via-rose-500 to-red-500 shadow-[0_0_12px_rgba(239,68,68,0.6)]"
                style={{ width: `${hpRatio * 100}%` }}
              />
              <span className="absolute inset-0 flex items-center justify-center text-[9px] font-mono font-black text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.9)]">
                {Math.ceil(boss.hp).toLocaleString()} / {boss.maxHp.toLocaleString()} HP ({Math.round(hpRatio * 100)}%)
              </span>
            </div>
          </div>
        ) : (
          /* Event Countdown Widget */
          <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-950/70 backdrop-blur-md border border-slate-800/80 text-[11px] text-slate-400 font-medium shadow-md">
            <Timer className="w-3.5 h-3.5 text-amber-400 animate-spin" />
            <span>Sự kiện Boss thế giới kế tiếp:</span>
            <span className="font-mono font-bold text-amber-400">
              00:{worldEvent.timeRemaining < 10 ? `0${worldEvent.timeRemaining}` : worldEvent.timeRemaining}
            </span>
          </div>
        )}
      </div>
    </>
  );
};
