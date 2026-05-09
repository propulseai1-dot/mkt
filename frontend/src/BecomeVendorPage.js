import React, { useEffect, useState } from 'react';
import {
  Rocket, Shield, Lock, TrendingDown, Sparkles, Store, BarChart3, Headphones, ChevronRight, Zap
} from 'lucide-react';
import { silkApiUrl } from './silkApi';

/**
 * Buyer-facing pitch: commission tiers + vendor upgrade CTA.
 * Tiers: GET /api/vendor-levels (same data as api-service/config.py).
 */
export default function BecomeVendorPage({ xmrRate, balance, onUpgrade }) {
  const [levels, setLevels] = useState([]);
  const [loadErr, setLoadErr] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch(silkApiUrl('/api/vendor-levels'));
        const d = await r.json();
        if (cancelled) return;
        setLevels(Array.isArray(d.levels) ? d.levels : []);
        setLoadErr(null);
      } catch {
        if (!cancelled) setLoadErr('Could not load vendor tiers.');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const rate = Number(xmrRate) > 0 ? Number(xmrRate) : 0;
  const upgradeXmr = rate > 0 ? 400 / rate : 0;
  const canAfford = rate > 0 && Number(balance) >= upgradeXmr;

  const formatSalesRange = (lvl) => {
    const min = lvl.min_sales ?? 0;
    const max = lvl.max_sales;
    if (max == null) return `${min}+ sales`;
    return `${min} – ${max} sales`;
  };

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 space-y-10 pb-12">
      <div className="relative overflow-hidden rounded-3xl border border-amber-900/30 bg-gradient-to-br from-amber-950/40 via-[#0a0a0f] to-purple-950/30 p-8 md:p-12">
        <div className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-amber-600/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-16 -left-16 h-48 w-48 rounded-full bg-purple-600/10 blur-3xl" />
        <div className="relative max-w-3xl space-y-4">
          <div className="inline-flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-amber-400">
            <Sparkles size={12} /> Buyer account → vendor status
          </div>
          <h1 className="text-3xl font-black tracking-tight text-white md:text-4xl">
            Open your shop.{' '}
            <span className="bg-gradient-to-r from-amber-400 to-orange-500 bg-clip-text text-transparent">
              Pay lower fees as you level up.
            </span>
          </h1>
          <p className="text-sm font-medium normal-case not-italic leading-relaxed text-gray-400">
            Vendors get listing tools, built-in escrow, and a commission that drops as you sell — down to{' '}
            <strong className="text-amber-500">2%</strong> at the top tier.
          </p>
          <div className="flex flex-wrap gap-3 pt-2">
            {[
              { icon: Shield, t: 'Secure escrow releases' },
              { icon: Lock, t: 'PGP & encrypted chat' },
              { icon: BarChart3, t: 'Earnings dashboard' },
            ].map(({ icon: Ic, t }) => (
              <div
                key={t}
                className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-gray-300"
              >
                <Ic size={14} className="text-amber-500" />
                {t}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {[
          {
            title: 'Marketplace visibility',
            body: 'List where buyers already shop and trust the platform.',
            icon: Store,
          },
          {
            title: 'Fees that shrink',
            body: 'From 8% when you start to 2% at the top — each tier unlocks better rates.',
            icon: TrendingDown,
          },
          {
            title: 'Operations support',
            body: 'Built-in messages, disputes, and an admin queue to approve your vendor upgrade.',
            icon: Headphones,
          },
        ].map(card => (
          <div
            key={card.title}
            className="rounded-2xl border border-white/10 bg-white/[0.02] p-5 transition-all hover:border-amber-900/40"
          >
            <card.icon className="mb-3 text-amber-500" size={22} />
            <h3 className="text-sm font-black text-white">{card.title}</h3>
            <p className="mt-2 text-[11px] font-medium normal-case not-italic leading-relaxed text-gray-500">
              {card.body}
            </p>
          </div>
        ))}
      </div>

      <div>
        <div className="mb-6 flex items-end justify-between gap-4 border-b border-white/10 pb-4">
          <div>
            <h2 className="text-xl font-black text-white">All vendor tiers</h2>
            <p className="mt-1 text-[11px] font-medium normal-case not-italic text-gray-500">
              Platform fee per escrow sale — decreases automatically as your completed sales grow.
            </p>
          </div>
          <Rocket className="hidden text-amber-600/50 sm:block" size={28} />
        </div>

        {loadErr && (
          <p className="rounded-xl border border-red-900/40 bg-red-950/20 p-4 text-sm text-red-400">{loadErr}</p>
        )}

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {levels.map((lvl) => {
            const pct = ((lvl.commission_rate ?? 0) * 100).toFixed(1);
            const color = lvl.color || '#9b59b6';
            return (
              <div
                key={lvl.level || lvl.name}
                className="group relative flex flex-col rounded-2xl border border-white/10 bg-[#0c0c12] p-4 transition-all hover:scale-[1.02] hover:shadow-lg"
                style={{ boxShadow: `0 0 0 1px ${color}22, 0 12px 40px -12px ${color}33` }}
              >
                <div
                  className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl text-2xl"
                  style={{ background: `${color}18`, border: `1px solid ${color}44` }}
                >
                  {lvl.icon}
                </div>
                <div className="text-[10px] font-black uppercase tracking-widest" style={{ color }}>
                  {lvl.badge || `Level ${lvl.level}`}
                </div>
                <h3 className="mt-1 text-sm font-black text-white">{lvl.name}</h3>
                <div className="mt-3 text-2xl font-black tabular-nums" style={{ color }}>
                  {pct}%
                </div>
                <p className="text-[9px] font-bold uppercase tracking-wide text-gray-500">fee</p>
                <p className="mt-3 text-[10px] font-medium normal-case not-italic text-gray-500">
                  {formatSalesRange(lvl)}
                </p>
                <div className="mt-3 flex items-center text-[9px] font-bold text-amber-600/80 opacity-0 transition-opacity group-hover:opacity-100">
                  Platform fee <ChevronRight size={12} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="relative overflow-hidden rounded-3xl border border-purple-900/40 bg-gradient-to-r from-purple-950/50 to-amber-950/40 p-8 md:flex md:items-center md:justify-between md:gap-8">
        <div className="relative z-10 max-w-xl space-y-2">
          <h3 className="text-lg font-black text-white md:text-xl">Ready to apply?</h3>
          <p className="text-[12px] font-medium normal-case not-italic leading-relaxed text-gray-400">
            Your request is reviewed by staff. The <strong className="text-white">$400 USD</strong> equivalent is
            debited in XMR from your wallet when you submit (using the market spot rate).
          </p>
        </div>
        <div className="relative z-10 mt-6 flex flex-shrink-0 flex-col items-stretch gap-3 md:mt-0 md:items-end">
          <div className="text-right text-[10px] font-mono text-gray-500">
            {rate > 0 ? (
              <>
                <div>
                  ≈ <span className="text-amber-400">{upgradeXmr.toFixed(4)}</span> XMR at{' '}
                  <span className="text-gray-400">${rate.toFixed(2)}</span> / XMR
                </div>
                <div className="mt-1">
                  Balance:{' '}
                  <span className={canAfford ? 'text-green-500' : 'text-red-400'}>
                    {(Number(balance) || 0).toFixed(4)} XMR
                  </span>
                </div>
              </>
            ) : (
              <span>XMR rate unavailable — refresh the page.</span>
            )}
          </div>
          <button
            type="button"
            onClick={onUpgrade}
            disabled={!rate}
            className="flex items-center justify-center gap-2 rounded-xl bg-amber-500 px-6 py-3.5 text-[11px] font-black uppercase tracking-wide text-black shadow-lg shadow-amber-900/30 transition-all hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Zap size={16} />
            Become vendor
          </button>
        </div>
      </div>
    </div>
  );
}
