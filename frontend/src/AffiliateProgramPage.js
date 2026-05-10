import React, { useEffect, useState, useCallback } from 'react';
import {
  Share2, Copy, CheckCircle, Trophy, GitBranch, DollarSign, Users, TrendingUp,
  ArrowRight, Sparkles
} from 'lucide-react';
import { silkApiUrl } from './silkApi';

function StatCard({ icon: Icon, label, value, sub, accent = 'amber' }) {
  const border =
    accent === 'purple'
      ? 'border-purple-900/40'
      : accent === 'green'
        ? 'border-green-900/40'
        : 'border-amber-900/40';
  const color =
    accent === 'purple' ? 'text-purple-400' : accent === 'green' ? 'text-green-400' : 'text-amber-500';
  return (
    <div className={`rounded-2xl border ${border} bg-black/40 p-5 backdrop-blur-sm`}>
      <Icon className={`mb-3 ${color}`} size={20} />
      <div className="text-2xl font-black text-white tracking-tight tabular-nums">{value}</div>
      <div className="text-[10px] font-bold uppercase tracking-widest text-gray-500 mt-1">{label}</div>
      {sub && <div className="text-[9px] text-gray-600 mt-2 font-mono">{sub}</div>}
    </div>
  );
}

export default function AffiliateProgramPage({ user, sessionToken, authenticatedFetch }) {
  const [program, setProgram] = useState(null);
  const [leaderboard, setLeaderboard] = useState([]);
  const [lbMonth, setLbMonth] = useState('');
  const [overview, setOverview] = useState(null);
  const [copied, setCopied] = useState(false);
  const [loadErr, setLoadErr] = useState(null);
  const [privateErr, setPrivateErr] = useState(null);

  const loadPublic = useCallback(async () => {
    try {
      const [pRes, lRes] = await Promise.all([
        fetch(silkApiUrl('/api/affiliate/program')),
        fetch(silkApiUrl('/api/affiliate/leaderboard')),
      ]);
      const p = await pRes.json();
      const l = await lRes.json();
      setProgram(p);
      setLeaderboard(Array.isArray(l.top) ? l.top : []);
      setLbMonth(l.month || '');
    } catch (e) {
      setLoadErr('Could not load affiliate program data.');
    }
  }, []);

  const loadPrivate = useCallback(async () => {
    if (!authenticatedFetch || !user?.username) return;
    setPrivateErr(null);
    try {
      const r = await authenticatedFetch('/api/affiliate/overview');
      const d = await r.json().catch(() => ({}));
      if (r.ok) {
        setOverview(d);
        return;
      }
      if (r.status === 401) {
        setPrivateErr('Session expired — reload and sign in again to see your referral link.');
      } else if (r.status === 404) {
        setPrivateErr('Account not found on server — try logging out and back in.');
      } else {
        setPrivateErr(d?.detail ? String(d.detail) : `Could not load affiliate overview (${r.status}).`);
      }
    } catch {
      setPrivateErr('Network error loading affiliate data.');
    }
  }, [authenticatedFetch, user?.username]);

  useEffect(() => {
    loadPublic();
  }, [loadPublic]);

  /** Reload private overview when session token is available (fixes race after page load / hash navigation). */
  useEffect(() => {
    loadPrivate();
  }, [loadPrivate, sessionToken]);

  const referralUrl =
    typeof window !== 'undefined' && overview?.referral_code
      ? `${window.location.origin}${window.location.pathname}?ref=${encodeURIComponent(overview.referral_code)}`
      : '';

  const copyLink = () => {
    if (!referralUrl) return;
    navigator.clipboard.writeText(referralUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const stats = overview?.stats;
  const payments = overview?.payments || [];

  const steps = [
    {
      n: '01',
      title: 'Share your link',
      body: 'Copy your referral URL and send it to buyers or vendors before they register.',
    },
    {
      n: '02',
      title: 'They join & trade',
      body: 'Referrals attach to your tree (buyer chain up to 3 levels + vendor direct referrer).',
    },
    {
      n: '03',
      title: 'Fees settle in XMR',
      body: 'When escrow releases, marketplace fees split: 55% to affiliates by rule, 45% to the market.',
    },
    {
      n: '04',
      title: 'Balance credits instantly',
      body: 'Your share posts to your internal XMR balance automatically — same wallet as trading.',
    },
  ];

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 space-y-10 pb-16 font-mono">
      {/* Header */}
      <div className="relative overflow-hidden rounded-3xl border border-amber-900/30 bg-gradient-to-br from-amber-950/30 via-[#0a0a0f] to-purple-950/25 p-8 md:p-10">
        <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-amber-600/10 blur-3xl" />
        <div className="relative flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-amber-500/25 bg-amber-500/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-amber-400 mb-4">
              <Sparkles size={12} /> Affiliate program
            </div>
            <h1 className="text-3xl md:text-4xl font-black text-white tracking-tight">
              Earn XMR on <span className="text-amber-500">every settled sale</span>
            </h1>
            <p className="mt-3 max-w-2xl text-sm text-gray-400 leading-relaxed normal-case not-italic font-medium">
              Marketplace fee % depends on your <strong className="text-white">vendor tier</strong> (Bronze at 50 sales,
              Silver 100, Gold 300, Platinum 600, Elite 1200 completed sales). Up to{' '}
              <strong className="text-white">55%</strong> of that fee is paid to affiliates.
              Buyer referrals use <strong className="text-white">3 depth levels</strong>; vendors can reward{' '}
              <strong className="text-white">who referred them</strong>. Payouts settle in{' '}
              <strong className="text-amber-500">XMR</strong> to your internal balance.
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-[10px] text-gray-500">
            <GitBranch size={14} className="text-purple-400" />
            <span>Max depth · buyer 3 · vendor 1</span>
          </div>
        </div>
      </div>

      {loadErr && (
        <div className="rounded-xl border border-red-900/40 bg-red-950/20 px-4 py-3 text-sm text-red-400">{loadErr}</div>
      )}

      {/* Personal stats */}
      <div>
        <h2 className="text-[10px] font-black uppercase tracking-[0.35em] text-gray-600 mb-4 flex items-center gap-2">
          <TrendingUp size={12} className="text-amber-600" /> Your performance
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StatCard
            icon={DollarSign}
            label="Total earned (affiliate)"
            value={stats ? `${Number(stats.total_earned_xmr || 0).toFixed(6)} XMR` : '—'}
            sub="From marketplace fee shares"
            accent="amber"
          />
          <StatCard
            icon={Users}
            label="Referral sign-ups"
            value={stats != null ? String(stats.referral_signups ?? 0) : '—'}
            sub="Accounts registered with your code"
            accent="purple"
          />
          <StatCard
            icon={TrendingUp}
            label="Attributed volume"
            value={stats ? `${Number(stats.attributed_volume_xmr || 0).toFixed(4)} XMR` : '—'}
            sub="Order volume where you earned"
            accent="green"
          />
        </div>
      </div>

      {/* Referral link */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6">
        <h3 className="text-sm font-black text-white uppercase tracking-wide mb-2 flex items-center gap-2">
          <Share2 size={16} className="text-amber-500" /> Your referral link
        </h3>
        <p className="text-[11px] text-gray-500 mb-4 normal-case not-italic">
          New users should open this URL before registering so the relationship is recorded.
        </p>
        {privateErr && (
          <div className="rounded-lg border border-amber-900/40 bg-amber-950/20 px-3 py-2 text-[11px] text-amber-400 mb-3">{privateErr}</div>
        )}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex-1 rounded-xl border border-white/10 bg-black/50 px-4 py-3 text-[11px] text-amber-500/90 font-mono break-all">
            {referralUrl || (user?.username ? 'Loading your referral link…' : 'Sign in to generate your link.')}
          </div>
          <button
            type="button"
            disabled={!referralUrl}
            onClick={copyLink}
            className="flex items-center justify-center gap-2 rounded-xl bg-amber-600 px-5 py-3 text-[11px] font-black uppercase text-black hover:bg-amber-500 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          >
            {copied ? <CheckCircle size={16} /> : <Copy size={16} />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        {overview?.referral_code && (
          <p className="mt-3 text-[10px] text-gray-600">
            Code: <span className="text-gray-400 font-mono">{overview.referral_code}</span>
          </p>
        )}
      </div>

      {/* Tier economics */}
      {program?.tiers && (
        <div>
          <h2 className="text-[10px] font-black uppercase tracking-[0.35em] text-gray-600 mb-4">
            Commission tiers (by vendor sales) · example ${program.example_nominal_sale_usd || 1000} nominal sale (USD)
          </h2>
          <div className="overflow-x-auto rounded-2xl border border-white/10">
            <table className="w-full text-left text-[11px]">
              <thead>
                <tr className="border-b border-white/10 bg-black/40 text-[9px] uppercase tracking-widest text-gray-500">
                  <th className="px-4 py-3">Vendor tier</th>
                  <th className="px-4 py-3">Min sales</th>
                  <th className="px-4 py-3">Market fee %</th>
                  <th className="px-4 py-3">Fee on ${program.example_nominal_sale_usd}</th>
                  <th className="px-4 py-3 text-amber-500/90">Affiliates (55%)</th>
                  <th className="px-4 py-3 text-gray-400">Market (45%)</th>
                </tr>
              </thead>
              <tbody>
                {program.tiers.map((t) => (
                  <tr key={t.name} className="border-b border-white/5 hover:bg-white/[0.02]">
                    <td className="px-4 py-3 text-white font-bold">{t.name}</td>
                    <td className="px-4 py-3 text-gray-500 font-mono">
                      {typeof t.min_sales === 'number' ? `${t.min_sales}+` : '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-400">{t.commission_pct}%</td>
                    <td className="px-4 py-3 font-mono text-gray-300">${t.fee_on_1000_usd}</td>
                    <td className="px-4 py-3 font-mono text-amber-500">${t.affiliates_on_1000_usd}</td>
                    <td className="px-4 py-3 font-mono text-gray-500">${t.market_on_1000_usd}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[9px] text-gray-600 normal-case not-italic">
            Tiers unlock by completed sales on settled escrow (same rules as the vendor dashboard). Illustrative USD
            amounts; live payouts use actual escrow in XMR.
          </p>
        </div>
      )}

      {/* Tree */}
      {program?.tree && (
        <div>
          <h2 className="text-[10px] font-black uppercase tracking-[0.35em] text-gray-600 mb-4 flex items-center gap-2">
            <GitBranch size={12} className="text-purple-400" /> Fee split tree (% of marketplace commission)
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {program.tree.map((node) => (
              <div
                key={node.id}
                className="rounded-xl border border-purple-900/30 bg-purple-950/20 px-4 py-4 flex flex-col justify-between min-h-[100px]"
              >
                <div className="text-[9px] font-black uppercase tracking-widest text-purple-400/80">{node.label}</div>
                <div className="text-2xl font-black text-white mt-2">{node.pct_of_market_commission}%</div>
                <div className="text-[9px] text-gray-600 mt-1 normal-case">of marketplace fee</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Leaderboard */}
      <div>
        <h2 className="text-[10px] font-black uppercase tracking-[0.35em] text-gray-600 mb-4 flex items-center gap-2">
          <Trophy size={12} className="text-amber-500" /> Top affiliates this month
          {lbMonth && <span className="text-gray-600 normal-case tracking-normal">· {lbMonth}</span>}
        </h2>
        <div className="rounded-2xl border border-white/10 divide-y divide-white/5 overflow-hidden">
          {leaderboard.length === 0 ? (
            <div className="px-4 py-8 text-center text-[11px] text-gray-600">No rankings yet this month.</div>
          ) : (
            leaderboard.map((row) => (
              <div key={row.rank} className="flex items-center justify-between px-4 py-3 bg-black/20 hover:bg-white/[0.03]">
                <div className="flex items-center gap-3">
                  <span className="text-amber-600 font-black w-6">{row.rank}</span>
                  <span className="text-[11px] text-gray-400">{row.label}</span>
                </div>
                <span className="text-[11px] font-mono text-green-400">{Number(row.earnings_xmr).toFixed(6)} XMR</span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* How it works */}
      <div>
        <h2 className="text-[10px] font-black uppercase tracking-[0.35em] text-gray-600 mb-6">How it works</h2>
        <div className="grid gap-4 md:grid-cols-4">
          {steps.map((s) => (
            <div key={s.n} className="relative rounded-2xl border border-white/10 bg-black/30 p-5 pt-8">
              <span className="absolute top-3 left-4 text-[9px] font-black text-amber-600/60">{s.n}</span>
              <div className="flex items-center gap-2 mb-2 text-white text-xs font-black uppercase tracking-wide">
                {s.title} <ArrowRight size={12} className="text-gray-600" />
              </div>
              <p className="text-[10px] text-gray-500 leading-relaxed normal-case not-italic">{s.body}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Payment history */}
      <div>
        <h2 className="text-[10px] font-black uppercase tracking-[0.35em] text-gray-600 mb-4">Recent affiliate payouts</h2>
        <div className="overflow-x-auto rounded-2xl border border-white/10">
          <table className="w-full text-left text-[11px]">
            <thead>
              <tr className="border-b border-white/10 bg-black/40 text-[9px] uppercase tracking-widest text-gray-500">
                <th className="px-4 py-3">Time</th>
                <th className="px-4 py-3">Order</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {payments.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-gray-600">
                    No affiliate commissions yet. Share your link to start earning.
                  </td>
                </tr>
              ) : (
                payments.map((p, idx) => (
                  <tr key={`${p.order_id}-${idx}`} className="border-b border-white/5 hover:bg-white/[0.02]">
                    <td className="px-4 py-2 text-gray-500 font-mono text-[10px] whitespace-nowrap">
                      {p.ts ? new Date(p.ts).toLocaleString() : '—'}
                    </td>
                    <td className="px-4 py-2 font-mono text-gray-400 text-[10px]">{p.order_id || '—'}</td>
                    <td className="px-4 py-2 text-purple-400 uppercase text-[10px]">{p.role || '—'}</td>
                    <td className="px-4 py-2 text-right font-mono text-green-400">
                      +{Number(p.amount_xmr || 0).toFixed(8)} XMR
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
