/**
 * SILKGENESIS — Liquidity & Withdrawal Management Dashboard
 * ==========================================================
 * Component admin complet pour la gestion des withdrawals et de la liquidity.
 *
 * Sections :
 *   1. Liquidity Overview    — Equity vs Liquidity disponible, coverage ratio
 *   2. Withdrawal Queue      — File d'pending multi-niveaux avec actions
 *   3. Partial Settlements   — Gestion des tranches de payment
 *   4. Balance Adjustments   — Corrections manuelles de balance
 *   5. Withdrawal Rules      — Configuration des regles par tier
 */

import React, { useState, useEffect, useCallback } from 'react';

const API = '';

// ============================================================
// UTILITAIRES
// ============================================================

const fmt = (n, decimals = 6) =>
  typeof n === 'number' ? n.toFixed(decimals) : '—';

const fmtUSD = (n) =>
  typeof n === 'number'
    ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
    : '—';

const timeAgo = (iso) => {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
};

const TIER_CONFIG = {
  small:  { label: 'SMALL',  color: '#22c55e', bg: 'rgba(34,197,94,0.12)',  icon: '🟢', desc: '< 1 XMR' },
  medium: { label: 'MEDIUM', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', icon: '🟡', desc: '1–10 XMR' },
  large:  { label: 'LARGE',  color: '#ef4444', bg: 'rgba(239,68,68,0.12)',  icon: '🔴', desc: '> 10 XMR' },
};

const STATUS_CONFIG = {
  pending:      { label: 'Pending',      color: '#f59e0b', icon: '⏳' },
  under_review: { label: 'Under Review', color: '#8b5cf6', icon: '🔍' },
  approved:     { label: 'Approved',     color: '#22c55e', icon: '✅' },
  processing:   { label: 'Processing',   color: '#3b82f6', icon: '⚙️' },
  completed:    { label: 'Completed',    color: '#6b7280', icon: '✔️' },
  rejected:     { label: 'Rejected',     color: '#ef4444', icon: '❌' },
  cancelled:    { label: 'Cancelled',    color: '#6b7280', icon: '🚫' },
  partial:      { label: 'Partial',      color: '#f97316', icon: '📦' },
  expired:      { label: 'Expired',      color: '#6b7280', icon: '⌛' },
};

const RISK_CONFIG = {
  healthy:   { label: 'Healthy',   color: '#22c55e', bg: 'rgba(34,197,94,0.1)',   icon: '✅' },
  adequate:  { label: 'Adequate',  color: '#3b82f6', bg: 'rgba(59,130,246,0.1)',  icon: '🔵' },
  warning:   { label: 'Warning',   color: '#f59e0b', bg: 'rgba(245,158,11,0.1)',  icon: '⚠️' },
  critical:  { label: 'Critical',  color: '#ef4444', bg: 'rgba(239,68,68,0.1)',   icon: '🚨' },
  insolvent: { label: 'Insolvent', color: '#7f1d1d', bg: 'rgba(127,29,29,0.2)',   icon: '💀' },
};

// ============================================================
// HOOK — Fetch avec token de session
// ============================================================

function useApi(token) {
  const authHeaders = token ? { Authorization: `Bearer ${token}` } : {};

  const get = useCallback(async (path) => {
    const r = await fetch(`${API}${path}`, {
      headers: authHeaders
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }, [authHeaders]);

  const post = useCallback(async (path, body = {}) => {
    const r = await fetch(`${API}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify(body)
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      throw new Error(err.detail || `HTTP ${r.status}`);
    }
    return r.json();
  }, [authHeaders]);

  return { get, post };
}

// ============================================================
// COMPOSANT PRINCIPAL
// ============================================================

// ============================================================
// PLATFORM CONTROL PANEL — Sous-composant admin
// ============================================================

function PlatformControlPanel({ token }) {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');
  const [freezeMsg, setFreezeMsg] = useState('');
  const [structuredThreshold, setStructuredThreshold] = useState('60');
  const [structuredCoverage, setStructuredCoverage] = useState('0.80');
  const [feedback, setFeedback] = useState(null);

  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {})
  };

  const fetchStatus = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/admin/platform/config`, { headers });
      if (r.ok) {
        const d = await r.json();
        setStatus(d.status);
        setFreezeMsg(d.config?.emergency_freeze_message?.value || '');
        setStructuredThreshold(d.config?.structured_threshold_xmr?.value || '60');
        setStructuredCoverage(d.config?.structured_coverage_trigger?.value || '0.80');
      }
    } catch {}
  }, [token]);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  const doAction = async (endpoint, body, label) => {
    setLoading(true);
    setFeedback(null);
    try {
      const r = await fetch(`${API}${endpoint}`, {
        method: 'POST', headers,
        body: JSON.stringify(body)
      });
      const d = await r.json();
      if (r.ok) {
        setFeedback({ type: 'success', text: `✓ ${label}: ${d.note || d.action || 'OK'}` });
        fetchStatus();
      } else {
        setFeedback({ type: 'error', text: `✗ ${d.detail || 'Error'}` });
      }
    } catch (e) {
      setFeedback({ type: 'error', text: `✗ Network error` });
    }
    setLoading(false);
  };

  if (!status) return <div style={{ color: '#9ca3af', padding: 20 }}>Loading platform config…</div>;

  const lpmActive = status.liquidity_protection_mode?.active;
  const freezeActive = status.emergency_freeze?.active;
  const structuredActive = status.structured_withdrawal_policy?.active;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {feedback && (
        <div style={{
          padding: '10px 16px', borderRadius: 8,
          background: feedback.type === 'success' ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.12)',
          color: feedback.type === 'success' ? '#10b981' : '#ef4444',
          border: `1px solid ${feedback.type === 'success' ? '#10b981' : '#ef4444'}`,
          fontSize: 13
        }}>
          {feedback.text}
        </div>
      )}

      {/* ── 1. Liquidity Protection Mode ── */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ color: '#f59e0b', fontWeight: 700, fontSize: 15, marginBottom: 4 }}>
              ⚠️ Liquidity Protection Mode
            </div>
            <div style={{ color: '#9ca3af', fontSize: 13, maxWidth: 480 }}>
              Displays une banner transparente a tous les users indiquant que les withdrawals
              peuvent etre traites en plusieurs versements. Les withdrawals continuent normalement.
            </div>
          </div>
          <StatusBadge active={lpmActive} />
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
          <button
            onClick={() => doAction('/api/admin/platform/liquidity-protection', { enabled: true }, 'LPM Enabled')}
            disabled={loading || lpmActive}
            style={{ ...btnStyle, background: lpmActive ? '#374151' : '#f59e0b', color: lpmActive ? '#6b7280' : '#000' }}
          >
            Activate
          </button>
          <button
            onClick={() => doAction('/api/admin/platform/liquidity-protection', { enabled: false }, 'LPM Disabled')}
            disabled={loading || !lpmActive}
            style={{ ...btnStyle, background: !lpmActive ? '#374151' : '#374151', color: !lpmActive ? '#6b7280' : '#d1d5db' }}
          >
            Deactivate
          </button>
        </div>
      </div>

      {/* ── 2. Emergency Freeze ── */}
      <div style={{ ...cardStyle, borderColor: freezeActive ? '#ef4444' : '#374151' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ color: '#ef4444', fontWeight: 700, fontSize: 15, marginBottom: 4 }}>
              🔒 Emergency Withdrawal Freeze
            </div>
            <div style={{ color: '#9ca3af', fontSize: 13, maxWidth: 480 }}>
              Bloque tous les nouveaux withdrawals. Un message public est affiche a tous les users.
              Les withdrawals deja en cours (processing) ne sont pas cancelleds.
            </div>
          </div>
          <StatusBadge active={freezeActive} colorActive="#ef4444" />
        </div>

        <div style={{ marginTop: 14 }}>
          <label style={{ color: '#9ca3af', fontSize: 12, display: 'block', marginBottom: 4 }}>
            Public message shown to all users:
          </label>
          <textarea
            value={freezeMsg}
            onChange={e => setFreezeMsg(e.target.value)}
            rows={2}
            style={{
              width: '100%', background: '#1f2937', border: '1px solid #374151',
              borderRadius: 6, color: '#f9fafb', padding: '8px 12px', fontSize: 13,
              resize: 'vertical', boxSizing: 'border-box'
            }}
            placeholder="Emergency Maintenance — Withdrawals temporarily paused for system upgrade."
          />
          <button
            onClick={() => doAction('/api/admin/platform/freeze-message', { message: freezeMsg }, 'Message updated')}
            disabled={loading}
            style={{ ...btnStyle, marginTop: 8, background: '#374151', color: '#d1d5db', fontSize: 12 }}
          >
            Update Message Only
          </button>
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
          <button
            onClick={() => doAction('/api/admin/platform/emergency-freeze', { enabled: true, message: freezeMsg }, 'Freeze ACTIVATED')}
            disabled={loading || freezeActive}
            style={{ ...btnStyle, background: freezeActive ? '#374151' : '#ef4444', color: freezeActive ? '#6b7280' : '#fff' }}
          >
            🔒 Activate Freeze
          </button>
          <button
            onClick={() => doAction('/api/admin/platform/emergency-freeze', { enabled: false }, 'Freeze DEACTIVATED')}
            disabled={loading || !freezeActive}
            style={{ ...btnStyle, background: !freezeActive ? '#374151' : '#10b981', color: !freezeActive ? '#6b7280' : '#fff' }}
          >
            🔓 Lift Freeze
          </button>
        </div>
      </div>

      {/* ── 3. Structured Withdrawal Policy ── */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ color: '#60a5fa', fontWeight: 700, fontSize: 15, marginBottom: 4 }}>
              📋 Structured Withdrawal Policy
            </div>
            <div style={{ color: '#9ca3af', fontSize: 13, maxWidth: 480 }}>
              Convertit automatiquement les gros withdrawals en partial settlements echelonnes.
              L'user recoit un calendrier detaille et transparent.
            </div>
          </div>
          <StatusBadge active={structuredActive} colorActive="#60a5fa" />
        </div>

        <div style={{ display: 'flex', gap: 16, marginTop: 14 }}>
          <div style={{ flex: 1 }}>
            <label style={{ color: '#9ca3af', fontSize: 12, display: 'block', marginBottom: 4 }}>
              Threshold (XMR) — withdrawals au-dessus de ce seuil
            </label>
            <input
              type="number" step="0.1" min="1"
              value={structuredThreshold}
              onChange={e => setStructuredThreshold(e.target.value)}
              style={inputStyle}
            />
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ color: '#9ca3af', fontSize: 12, display: 'block', marginBottom: 4 }}>
              Coverage Trigger (ex: 0.80 = 80%) — auto-active si ratio bas
            </label>
            <input
              type="number" step="0.01" min="0" max="1"
              value={structuredCoverage}
              onChange={e => setStructuredCoverage(e.target.value)}
              style={inputStyle}
            />
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
          <button
            onClick={() => doAction('/api/admin/platform/structured-policy', {
              enabled: true,
              threshold_xmr: parseFloat(structuredThreshold),
              coverage_trigger: parseFloat(structuredCoverage)
            }, 'Structured Policy Enabled')}
            disabled={loading || structuredActive}
            style={{ ...btnStyle, background: structuredActive ? '#374151' : '#3b82f6', color: structuredActive ? '#6b7280' : '#fff' }}
          >
            Activate Policy
          </button>
          <button
            onClick={() => doAction('/api/admin/platform/structured-policy', { enabled: false }, 'Structured Policy Disabled')}
            disabled={loading || !structuredActive}
            style={{ ...btnStyle, background: !structuredActive ? '#374151' : '#374151', color: !structuredActive ? '#6b7280' : '#d1d5db' }}
          >
            Deactivate
          </button>
        </div>
      </div>

    </div>
  );
}

function StatusBadge({ active, colorActive = '#10b981' }) {
  return (
    <span style={{
      padding: '3px 10px', borderRadius: 20, fontSize: 12, fontWeight: 700,
      background: active ? `${colorActive}22` : '#37415133',
      color: active ? colorActive : '#6b7280',
      border: `1px solid ${active ? colorActive : '#374151'}`,
      whiteSpace: 'nowrap'
    }}>
      {active ? '● ACTIVE' : '○ INACTIVE'}
    </span>
  );
}

const cardStyle = {
  background: '#111827',
  border: '1px solid #374151',
  borderRadius: 10,
  padding: '18px 20px',
};

const btnStyle = {
  padding: '8px 16px',
  borderRadius: 6,
  border: 'none',
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 600,
  transition: 'opacity 0.2s',
};

const inputStyle = {
  width: '100%',
  background: '#1f2937',
  border: '1px solid #374151',
  borderRadius: 6,
  color: '#f9fafb',
  padding: '8px 12px',
  fontSize: 13,
  boxSizing: 'border-box',
};


// ============================================================
// COMPOSANT PRINCIPAL
// ============================================================

export default function LiquidityDashboard({ token }) {
  const [activeTab, setActiveTab] = useState('overview');
  const { get, post } = useApi(token);

  const tabs = [
    { id: 'overview',     label: '📊 Liquidity Overview',    badge: null },
    { id: 'queue',        label: '📋 Withdrawal Queue',       badge: null },
    { id: 'settlements',  label: '📦 Partial Settlements',    badge: null },
    { id: 'adjustments',  label: '⚖️ Balance Adjustments',   badge: null },
    { id: 'rules',        label: '⚙️ Withdrawal Rules',       badge: null },
    { id: 'platform',     label: '🛡️ Platform Controls',     badge: null },
  ];

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <div>
          <h1 style={styles.title}>💧 Liquidity & Withdrawal Management</h1>
          <p style={styles.subtitle}>
            Real-time liquidity monitoring · Multi-tier withdrawal validation · Partial settlements
          </p>
        </div>
      </div>

      {/* Tab Navigation */}
      <div style={styles.tabBar}>
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              ...styles.tabBtn,
              ...(activeTab === tab.id ? styles.tabBtnActive : {})
            }}
          >
            {tab.label}
            {tab.badge !== null && (
              <span style={styles.badge}>{tab.badge}</span>
            )}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div style={styles.content}>
        {activeTab === 'overview'    && <LiquidityOverview get={get} post={post} />}
        {activeTab === 'queue'       && <WithdrawalQueue get={get} post={post} />}
        {activeTab === 'settlements' && <PartialSettlements get={get} post={post} />}
        {activeTab === 'adjustments' && <BalanceAdjustments get={get} post={post} />}
        {activeTab === 'rules'       && <WithdrawalRules get={get} post={post} />}
        {activeTab === 'platform'    && <PlatformControlPanel token={token} />}
      </div>
    </div>
  );
}

// ============================================================
// TAB 1 — LIQUIDITY OVERVIEW
// ============================================================

function LiquidityOverview({ get, post }) {
  const [data, setData] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [snap, hist] = await Promise.all([
        get('/api/admin/liquidity/snapshot'),
        get('/api/admin/liquidity/history?limit=24')
      ]);
      setData(snap);
      setHistory(hist.snapshots || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [get]);

  useEffect(() => { load(); }, [load]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await post('/api/admin/liquidity/refresh');
      await load();
    } finally {
      setRefreshing(false);
    }
  };

  if (loading) return <Spinner />;
  if (!data) return <ErrorMsg msg="Failed to load liquidity data" />;

  const snap = data.snapshot;
  const risk = RISK_CONFIG[snap.risk_level] || RISK_CONFIG.adequate;
  const coveragePct = Math.round((snap.coverage_ratio || 0) * 100);

  return (
    <div>
      {/* Risk Banner */}
      <div style={{ ...styles.riskBanner, background: risk.bg, borderColor: risk.color }}>
        <span style={{ fontSize: 24 }}>{risk.icon}</span>
        <div>
          <div style={{ color: risk.color, fontWeight: 700, fontSize: 16 }}>
            Liquidity Status: {risk.label}
          </div>
          <div style={{ color: '#9ca3af', fontSize: 13 }}>
            Coverage Ratio: {coveragePct}% ·
            Snapshot: {timeAgo(snap.snapshot_at)} ·
            Wallet: {data.wallet_connected ? '🟢 Connected (live)' : '🟠 Disconnected (fallback data)'}
          </div>
        </div>
        <button onClick={handleRefresh} disabled={refreshing} style={styles.refreshBtn}>
          {refreshing ? '⟳ Refreshing...' : '⟳ Refresh Now'}
        </button>
      </div>

      {/* Main Metrics Grid */}
      <div style={styles.metricsGrid}>
        <MetricCard
          title="Total User Equity"
          value={`${fmt(snap.total_user_equity_xmr)} XMR`}
          sub={fmtUSD(snap.total_user_equity_usd)}
          icon="👥"
          color="#8b5cf6"
          tooltip="Sum of all user balances displayed on the platform"
        />
        <MetricCard
          title="Actual Liquidity"
          value={`${fmt(snap.actual_liquidity_xmr)} XMR`}
          sub={fmtUSD(snap.actual_liquidity_usd)}
          icon="💧"
          color={snap.is_solvent ? '#22c55e' : '#ef4444'}
          tooltip="Real available funds for withdrawals"
        />
        <MetricCard
          title="Coverage Ratio"
          value={`${coveragePct}%`}
          sub={snap.is_solvent ? 'Solvent ✅' : 'UNDERFUNDED ⚠️'}
          icon="📊"
          color={snap.is_solvent ? '#22c55e' : '#ef4444'}
          tooltip="Actual Liquidity / Total User Equity"
        />
        <MetricCard
          title="Liquidity Gap"
          value={`${fmt(snap.liquidity_gap_xmr)} XMR`}
          sub={snap.liquidity_gap_xmr >= 0 ? 'Surplus' : 'Deficit'}
          icon={snap.liquidity_gap_xmr >= 0 ? '📈' : '📉'}
          color={snap.liquidity_gap_xmr >= 0 ? '#22c55e' : '#ef4444'}
          tooltip="Actual Liquidity minus Total User Equity"
        />
      </div>

      {/* Breakdown */}
      <div style={styles.card}>
        <h3 style={styles.cardTitle}>📦 Funds Breakdown</h3>
        <div style={styles.breakdownGrid}>
          <BreakdownRow
            label="User Equity (displayed)"
            value={snap.total_user_equity_xmr}
            color="#8b5cf6"
            total={snap.total_user_equity_xmr}
          />
          <BreakdownRow
            label="Escrow Locked (active orders)"
            value={snap.escrow_locked_xmr}
            color="#3b82f6"
            total={snap.total_user_equity_xmr}
          />
          <BreakdownRow
            label="Vendor Bonds Locked"
            value={snap.bonds_locked_xmr}
            color="#f59e0b"
            total={snap.total_user_equity_xmr}
          />
          <BreakdownRow
            label="Pending Withdrawals"
            value={snap.pending_withdrawals_xmr}
            color="#ef4444"
            total={snap.total_user_equity_xmr}
          />
          <BreakdownRow
            label="Partial Settlements (pending)"
            value={snap.partial_settlements_xmr}
            color="#f97316"
            total={snap.total_user_equity_xmr}
          />
          <BreakdownRow
            label="Available Liquidity"
            value={snap.actual_liquidity_xmr}
            color="#22c55e"
            total={snap.total_user_equity_xmr}
            highlight
          />
        </div>
      </div>

      {/* Queue Stats */}
      {data.queue_stats && (
        <div style={styles.card}>
          <h3 style={styles.cardTitle}>📋 Withdrawal Queue Summary</h3>
          <div style={styles.statsRow}>
            {Object.entries(data.queue_stats.by_status || {}).map(([status, info]) => {
              const sc = STATUS_CONFIG[status] || {};
              return (
                <div key={status} style={styles.statChip}>
                  <span>{sc.icon || '•'} {sc.label || status}</span>
                  <strong style={{ color: sc.color }}>{info.count}</strong>
                  <span style={{ color: '#9ca3af', fontSize: 11 }}>{fmt(info.total_xmr, 4)} XMR</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* History Sparkline */}
      {history.length > 1 && (
        <div style={styles.card}>
          <h3 style={styles.cardTitle}>📈 Coverage Ratio History (last {history.length} snapshots)</h3>
          <CoverageChart snapshots={history} />
        </div>
      )}
    </div>
  );
}

// ============================================================
// TAB 2 — WITHDRAWAL QUEUE
// ============================================================

function WithdrawalQueue({ get, post }) {
  const [data, setData] = useState(null);
  const [allData, setAllData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tierFilter, setTierFilter] = useState('');
  const [viewMode, setViewMode] = useState('pending'); // pending | all
  const [allStatusFilter, setAllStatusFilter] = useState(''); // '' | approved | cancelled
  const [actionModal, setActionModal] = useState(null);
  const [settlementModal, setSettlementModal] = useState(null);

  const load = useCallback(async () => {
    try {
      const [q, all] = await Promise.all([
        get(`/api/admin/withdrawals/queue${tierFilter ? `?tier=${tierFilter}` : ''}`),
        get('/api/admin/withdrawals/all?limit=100')
      ]);
      setData(q);
      setAllData(all);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [get, tierFilter]);

  useEffect(() => { load(); }, [load]);

  const handleAction = async (wid, action, reason = '', notes = '') => {
    try {
      const current = (allData?.withdrawals || []).find(w => w.id === wid) || (data?.queue || []).find(w => w.id === wid);
      const isForceCancel = action === 'cancel' && ['processing', 'approved'].includes(current?.status || '');
      let result;
      if (isForceCancel) {
        try {
          result = await post(`/api/admin/withdrawals/${wid}/force-cancel`, { reason, notes });
        } catch (e) {
          const msg = String(e?.message || '');
          if (msg.includes('Not Found') || msg.includes('HTTP 404')) {
            // Backward-compatible fallback for older backend instances:
            // force a reject path (same refund behavior) when force-cancel route is unavailable.
            result = await post(`/api/admin/withdrawals/${wid}/review`, {
              action: 'reject',
              reason: reason || 'Force-cancel fallback',
              notes: notes || 'Fallback: force-cancel route missing on current backend instance'
            });
          } else {
            throw e;
          }
        }
      } else {
        result = await post(`/api/admin/withdrawals/${wid}/review`, { action, reason, notes });
      }
      if (action === 'approve' && result?.auto_payout?.txid) {
        alert(
          `✅ Withdrawal validated and payout sent.\n\n` +
          `TXID: ${result.auto_payout.txid}\n` +
          `Amount: ${fmt(result.auto_payout.amount_xmr, 6)} XMR\n` +
          `Network fee: ${fmt(result.auto_payout.fee_xmr, 6)} XMR`
        );
      }
      setActionModal(null);
      await load();
    } catch (e) {
      alert(`Error: ${e.message}`);
    }
  };

  const handleCreateSettlement = async (wid, numTranches, intervalHours, notes) => {
    try {
      await post(`/api/admin/withdrawals/${wid}/partial-settlement`, {
        num_tranches: numTranches,
        interval_hours: intervalHours,
        notes
      });
      setSettlementModal(null);
      await load();
      alert('✅ Partial settlement plan created successfully');
    } catch (e) {
      alert(`Error: ${e.message}`);
    }
  };

  if (loading) return <Spinner />;

  const allWithdrawals = allData?.withdrawals || [];
  const queue = viewMode === 'pending'
    ? (data?.queue || [])
    : (allStatusFilter ? allWithdrawals.filter(wd => wd.status === allStatusFilter) : allWithdrawals);

  const stats = data?.stats || {};

  return (
    <div>
      {/* Controls */}
      <div style={styles.controlBar}>
        <div style={styles.btnGroup}>
          <button
            onClick={() => setViewMode('pending')}
            style={viewMode === 'pending' ? styles.btnPrimary : styles.btnSecondary}
          >
            ⏳ Pending Queue ({data?.count || 0})
          </button>
          <button
            onClick={() => setViewMode('all')}
            style={viewMode === 'all' ? styles.btnPrimary : styles.btnSecondary}
          >
            📋 All Withdrawals ({allData?.count || 0})
          </button>
        </div>
        {viewMode === 'all' && (
          <div style={styles.btnGroup}>
            <button
              onClick={() => setAllStatusFilter('')}
              style={allStatusFilter === '' ? styles.btnPrimary : styles.btnSecondary}
            >
              All
            </button>
            <button
              onClick={() => setAllStatusFilter('approved')}
              style={allStatusFilter === 'approved' ? styles.btnPrimary : styles.btnSecondary}
            >
              ✅ Approved ({allWithdrawals.filter(wd => wd.status === 'approved').length})
            </button>
            <button
              onClick={() => setAllStatusFilter('cancelled')}
              style={allStatusFilter === 'cancelled' ? styles.btnPrimary : styles.btnSecondary}
            >
              🚫 Cancelled ({allWithdrawals.filter(wd => wd.status === 'cancelled').length})
            </button>
          </div>
        )}
        <div style={styles.btnGroup}>
          {['', 'small', 'medium', 'large'].map(t => (
            <button
              key={t}
              onClick={() => setTierFilter(t)}
              style={{
                ...styles.tierBtn,
                ...(tierFilter === t ? { background: TIER_CONFIG[t]?.color || '#374151', color: '#fff' } : {})
              }}
            >
              {t ? `${TIER_CONFIG[t]?.icon} ${t.toUpperCase()}` : 'All Tiers'}
            </button>
          ))}
        </div>
      </div>

      {/* Stats Row */}
      <div style={styles.statsRow}>
        {Object.entries(stats.by_tier || {}).map(([tier, info]) => {
          const tc = TIER_CONFIG[tier] || {};
          return (
            <div key={tier} style={{ ...styles.statChip, borderColor: tc.color }}>
              <span>{tc.icon} {tier.toUpperCase()}</span>
              <strong style={{ color: tc.color }}>{info.count} requests</strong>
              <span style={{ color: '#9ca3af', fontSize: 11 }}>{fmt(info.total_xmr, 4)} XMR</span>
            </div>
          );
        })}
      </div>

      {/* Queue Table */}
      {queue.length === 0 ? (
        <div style={styles.emptyState}>
          <div style={{ fontSize: 48 }}>✅</div>
          <div>No withdrawals in this view</div>
        </div>
      ) : (
        <div style={styles.tableWrapper}>
          <table style={styles.table}>
            <thead>
              <tr>
                {['ID', 'User', 'Amount', 'Tier', 'Status', 'Submitted', 'Expires', 'Actions'].map(h => (
                  <th key={h} style={styles.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {queue.map(wd => {
                const tc = TIER_CONFIG[wd.tier] || {};
                const sc = STATUS_CONFIG[wd.status] || {};
                const isPending = ['pending', 'under_review'].includes(wd.status);
                const isApproved = wd.status === 'approved';
                const isProcessing = wd.status === 'processing';
                const isLarge = wd.tier === 'large';

                return (
                  <tr key={wd.id} style={styles.tr}>
                    <td style={styles.td}>
                      <code style={styles.code}>{wd.id?.slice(0, 16)}…</code>
                    </td>
                    <td style={styles.td}>
                      <strong style={{ color: '#e5e7eb' }}>{wd.username}</strong>
                    </td>
                    <td style={styles.td}>
                      <span style={{ color: '#f59e0b', fontWeight: 700 }}>
                        {fmt(wd.amount_xmr, 6)} XMR
                      </span>
                    </td>
                    <td style={styles.td}>
                      <span style={{
                        ...styles.badge,
                        background: tc.bg,
                        color: tc.color,
                        border: `1px solid ${tc.color}`
                      }}>
                        {tc.icon} {tc.label}
                      </span>
                    </td>
                    <td style={styles.td}>
                      <span style={{ color: sc.color }}>
                        {sc.icon} {sc.label}
                      </span>
                      {wd.auto_approved ? (
                        <span style={{ ...styles.badge, background: 'rgba(34,197,94,0.1)', color: '#22c55e', marginLeft: 4 }}>
                          AUTO
                        </span>
                      ) : null}
                    </td>
                    <td style={styles.td}>
                      <span style={{ color: '#9ca3af', fontSize: 12 }}>
                        {timeAgo(wd.created_at)}
                      </span>
                    </td>
                    <td style={styles.td}>
                      <span style={{ color: '#9ca3af', fontSize: 12 }}>
                        {wd.expires_at ? timeAgo(wd.expires_at) : '—'}
                      </span>
                    </td>
                    <td style={styles.td}>
                      <div style={styles.actionBtns}>
                        {isPending && (
                          <>
                            <button
                              onClick={() => setActionModal({ wd, action: 'approve' })}
                              style={styles.btnApprove}
                            >✅ Validate</button>
                            <button
                              onClick={() => setActionModal({ wd, action: 'cancel' })}
                              style={styles.btnReject}
                            >🚫 Cancel</button>
                            {isLarge && (
                              <button
                                onClick={() => setActionModal({ wd, action: 'flag_review' })}
                                style={styles.btnReview}
                              >🔍 Flag</button>
                            )}
                          </>
                        )}
                        {isApproved && isLarge && (
                          <button
                            onClick={() => setSettlementModal(wd)}
                            style={styles.btnPartial}
                          >📦 Partial</button>
                        )}
                        {isApproved && (
                          <button
                            onClick={() => setActionModal({ wd, action: 'cancel' })}
                            style={styles.btnReject}
                          >🚫 Cancel</button>
                        )}
                        {isApproved && (
                          <button
                            onClick={() => setActionModal({ wd, action: 'mark_processing' })}
                            style={styles.btnProcess}
                          >⚙️ Process</button>
                        )}
                        {isProcessing && (
                          <button
                            onClick={() => setActionModal({ wd, action: 'cancel' })}
                            style={styles.btnReject}
                          >🛑 Force Cancel</button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Action Modal */}
      {actionModal && (
        <ActionModal
          wd={actionModal.wd}
          action={actionModal.action}
          onConfirm={handleAction}
          onClose={() => setActionModal(null)}
          post={post}
          onReload={load}
        />
      )}

      {/* Settlement Modal */}
      {settlementModal && (
        <SettlementModal
          wd={settlementModal}
          onConfirm={handleCreateSettlement}
          onClose={() => setSettlementModal(null)}
        />
      )}
    </div>
  );
}

// ============================================================
// TAB 3 — PARTIAL SETTLEMENTS
// ============================================================

function PartialSettlements({ get, post }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState(null);
  const [txidInput, setTxidInput] = useState('');

  const load = useCallback(async () => {
    try {
      const d = await get('/api/admin/settlements/pending');
      setData(d);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [get]);

  useEffect(() => { load(); }, [load]);

  const handleProcess = async (sid) => {
    try {
      await post(`/api/admin/settlements/${sid}/process`, { txid: txidInput || null });
      setProcessingId(null);
      setTxidInput('');
      await load();
    } catch (e) {
      alert(`Error: ${e.message}`);
    }
  };

  if (loading) return <Spinner />;

  const tranches = data?.due_tranches || [];
  const summary = data?.summary || {};

  return (
    <div>
      {/* Summary */}
      <div style={styles.statsRow}>
        {Object.entries(summary).map(([status, info]) => (
          <div key={status} style={styles.statChip}>
            <span style={{ textTransform: 'capitalize' }}>{status}</span>
            <strong>{info.count} tranches</strong>
            <span style={{ color: '#9ca3af', fontSize: 11 }}>{fmt(info.total_xmr, 4)} XMR</span>
          </div>
        ))}
      </div>

      <div style={styles.card}>
        <h3 style={styles.cardTitle}>
          📦 Due Tranches ({tranches.length})
          <span style={{ color: '#9ca3af', fontSize: 13, fontWeight: 400, marginLeft: 8 }}>
            Scheduled for now or earlier
          </span>
        </h3>

        {tranches.length === 0 ? (
          <div style={styles.emptyState}>
            <div style={{ fontSize: 48 }}>✅</div>
            <div>No tranches due at this time</div>
          </div>
        ) : (
          <div style={styles.tableWrapper}>
            <table style={styles.table}>
              <thead>
                <tr>
                  {['Settlement ID', 'Withdrawal', 'User', 'Tranche', 'Amount', 'Scheduled', 'Actions'].map(h => (
                    <th key={h} style={styles.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tranches.map(t => (
                  <tr key={t.id} style={styles.tr}>
                    <td style={styles.td}><code style={styles.code}>{t.id?.slice(0, 14)}…</code></td>
                    <td style={styles.td}><code style={styles.code}>{t.withdrawal_id?.slice(0, 14)}…</code></td>
                    <td style={styles.td}><strong style={{ color: '#e5e7eb' }}>{t.username}</strong></td>
                    <td style={styles.td}>
                      <span style={{ color: '#f59e0b' }}>
                        {t.tranche_number} / {t.total_tranches}
                      </span>
                    </td>
                    <td style={styles.td}>
                      <span style={{ color: '#f59e0b', fontWeight: 700 }}>
                        {fmt(t.amount_xmr, 6)} XMR
                      </span>
                    </td>
                    <td style={styles.td}>
                      <span style={{ color: '#ef4444', fontSize: 12 }}>
                        {timeAgo(t.scheduled_at)} (overdue)
                      </span>
                    </td>
                    <td style={styles.td}>
                      {processingId === t.id ? (
                        <div style={{ display: 'flex', gap: 6 }}>
                          <input
                            placeholder="TXID (optional)"
                            value={txidInput}
                            onChange={e => setTxidInput(e.target.value)}
                            style={styles.inputSmall}
                          />
                          <button onClick={() => handleProcess(t.id)} style={styles.btnApprove}>
                            ✅ Confirm
                          </button>
                          <button onClick={() => setProcessingId(null)} style={styles.btnReject}>
                            ✕
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setProcessingId(t.id)}
                          style={styles.btnProcess}
                        >
                          ⚙️ Mark Processed
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// TAB 4 — BALANCE ADJUSTMENTS
// ============================================================

function BalanceAdjustments({ get, post }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    username: '', adjustment_type: 'credit', amount_xmr: '',
    reason: '', category: 'manual', audit_ref: '', totp_code: ''
  });
  const [submitting, setSubmitting] = useState(false);
  const [reversingId, setReversingId] = useState(null);
  const [reverseReason, setReverseReason] = useState('');
  const [reverseTotp, setReverseTotp] = useState('');

  const load = useCallback(async () => {
    try {
      const d = await get('/api/admin/balance/adjustments?limit=100');
      setData(d);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [get]);

  useEffect(() => { load(); }, [load]);

  const handleSubmit = async () => {
    if (!form.username || !form.amount_xmr || !form.reason) {
      alert('Please fill all required fields');
      return;
    }
    if (!form.totp_code || !String(form.totp_code).trim()) {
      alert('2FA code required: enter your authenticator or backup code.');
      return;
    }
    setSubmitting(true);
    try {
      const result = await post('/api/admin/balance/adjust', {
        ...form,
        amount_xmr: parseFloat(form.amount_xmr),
        totp_code: String(form.totp_code).trim()
      });
      alert(`✅ Adjustment applied!\nID: ${result.adjustment_id}\nBalance: ${fmt(result.balance_before)} → ${fmt(result.balance_after)} XMR`);
      setShowForm(false);
      setForm({ username: '', adjustment_type: 'credit', amount_xmr: '', reason: '', category: 'manual', audit_ref: '', totp_code: '' });
      await load();
    } catch (e) {
      alert(`Error: ${e.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleReverse = async (adjId) => {
    if (!reverseReason) { alert('Please provide a reason for reversal'); return; }
    if (!reverseTotp || !String(reverseTotp).trim()) {
      alert('2FA code required to reverse a balance adjustment.');
      return;
    }
    try {
      const result = await post(`/api/admin/balance/reverse/${adjId}`, {
        reason: reverseReason,
        totp_code: String(reverseTotp).trim()
      });
      alert(`✅ Adjustment reversed!\nBalance restored to: ${fmt(result.balance_restored_to)} XMR`);
      setReversingId(null);
      setReverseReason('');
      setReverseTotp('');
      await load();
    } catch (e) {
      alert(`Error: ${e.message}`);
    }
  };

  if (loading) return <Spinner />;

  const adjustments = data?.adjustments || [];
  const stats = data?.stats || {};

  const ADJ_COLORS = { credit: '#22c55e', debit: '#ef4444', override: '#f59e0b' };
  const ADJ_ICONS  = { credit: '➕', debit: '➖', override: '🔄' };

  return (
    <div>
      <p style={{ color: '#9ca3af', fontSize: 12, marginBottom: 12, lineHeight: 1.5 }}>
        Fund adjustments and reversals require <strong style={{ color: '#e5e7eb' }}>admin 2FA</strong> (TOTP) enabled on your account in Profile, plus a code for each action.
      </p>
      {/* Stats */}
      <div style={styles.statsRow}>
        {Object.entries(stats).map(([type, info]) => (
          <div key={type} style={{ ...styles.statChip, borderColor: ADJ_COLORS[type] }}>
            <span>{ADJ_ICONS[type]} {type.toUpperCase()}</span>
            <strong style={{ color: ADJ_COLORS[type] }}>{info.count} ops</strong>
            <span style={{ color: '#9ca3af', fontSize: 11 }}>{fmt(info.total_xmr, 4)} XMR</span>
          </div>
        ))}
      </div>

      {/* New Adjustment Form */}
      <div style={styles.card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={styles.cardTitle}>⚖️ New Balance Adjustment</h3>
          <button
            onClick={() => setShowForm(!showForm)}
            style={showForm ? styles.btnReject : styles.btnPrimary}
          >
            {showForm ? '✕ Cancel' : '+ New Adjustment'}
          </button>
        </div>

        {showForm && (
          <div style={styles.formGrid}>
            <div style={styles.formGroup}>
              <label style={styles.label}>Target Username *</label>
              <input
                value={form.username}
                onChange={e => setForm({ ...form, username: e.target.value })}
                placeholder="username"
                style={styles.input}
              />
            </div>
            <div style={styles.formGroup}>
              <label style={styles.label}>Adjustment Type *</label>
              <select
                value={form.adjustment_type}
                onChange={e => setForm({ ...form, adjustment_type: e.target.value })}
                style={styles.input}
              >
                <option value="credit">➕ Credit (add to balance)</option>
                <option value="debit">➖ Debit (remove from balance)</option>
                <option value="override">🔄 Override (set exact balance)</option>
              </select>
            </div>
            <div style={styles.formGroup}>
              <label style={styles.label}>Amount XMR *</label>
              <input
                type="number"
                step="0.000001"
                value={form.amount_xmr}
                onChange={e => setForm({ ...form, amount_xmr: e.target.value })}
                placeholder="0.000000"
                style={styles.input}
              />
            </div>
            <div style={styles.formGroup}>
              <label style={styles.label}>Category</label>
              <select
                value={form.category}
                onChange={e => setForm({ ...form, category: e.target.value })}
                style={styles.input}
              >
                <option value="manual">Manual Correction</option>
                <option value="yield_correction">Yield/Staking Correction</option>
                <option value="bug_fix">Bug Fix</option>
                <option value="dispute_resolution">Dispute Resolution</option>
                <option value="double_credit">Double Credit Fix</option>
                <option value="double_debit">Double Debit Fix</option>
                <option value="compensation">User Compensation</option>
              </select>
            </div>
            <div style={{ ...styles.formGroup, gridColumn: '1 / -1' }}>
              <label style={styles.label}>
                Reason * <span style={{ color: '#9ca3af' }}>(min 10 characters — required for audit trail)</span>
              </label>
              <textarea
                value={form.reason}
                onChange={e => setForm({ ...form, reason: e.target.value })}
                placeholder="Describe the reason for this adjustment in detail..."
                style={{ ...styles.input, height: 80, resize: 'vertical' }}
              />
            </div>
            <div style={styles.formGroup}>
              <label style={styles.label}>Audit Reference (optional)</label>
              <input
                value={form.audit_ref}
                onChange={e => setForm({ ...form, audit_ref: e.target.value })}
                placeholder="Ticket #, Order ID, etc."
                style={styles.input}
              />
            </div>
            <div style={{ ...styles.formGroup, gridColumn: '1 / -1' }}>
              <label style={styles.label}>
                Admin 2FA code * <span style={{ color: '#9ca3af' }}>(TOTP or backup code — required for fund adjustments)</span>
              </label>
              <input
                value={form.totp_code}
                onChange={e => setForm({ ...form, totp_code: e.target.value })}
                placeholder="6-digit code"
                autoComplete="one-time-code"
                inputMode="numeric"
                style={styles.input}
              />
            </div>
            <div style={{ ...styles.formGroup, display: 'flex', alignItems: 'flex-end' }}>
              <button
                onClick={handleSubmit}
                disabled={submitting}
                style={{ ...styles.btnPrimary, width: '100%' }}
              >
                {submitting ? '⟳ Applying...' : '✅ Apply Adjustment'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Adjustments History */}
      <div style={styles.card}>
        <h3 style={styles.cardTitle}>📜 Adjustment History ({adjustments.length})</h3>
        {adjustments.length === 0 ? (
          <div style={styles.emptyState}>
            <div style={{ fontSize: 48 }}>📋</div>
            <div>No adjustments recorded yet</div>
          </div>
        ) : (
          <div style={styles.tableWrapper}>
            <table style={styles.table}>
              <thead>
                <tr>
                  {['ID', 'User', 'Type', 'Amount', 'Before → After', 'Category', 'By', 'Date', 'Actions'].map(h => (
                    <th key={h} style={styles.th}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {adjustments.map(adj => {
                  const color = ADJ_COLORS[adj.adjustment_type] || '#9ca3af';
                  const isReversed = !!adj.reversed_by;
                  return (
                    <tr key={adj.id} style={{ ...styles.tr, opacity: isReversed ? 0.5 : 1 }}>
                      <td style={styles.td}><code style={styles.code}>{adj.id?.slice(0, 14)}…</code></td>
                      <td style={styles.td}><strong style={{ color: '#e5e7eb' }}>{adj.username}</strong></td>
                      <td style={styles.td}>
                        <span style={{ color, fontWeight: 600 }}>
                          {ADJ_ICONS[adj.adjustment_type]} {adj.adjustment_type?.toUpperCase()}
                        </span>
                      </td>
                      <td style={styles.td}>
                        <span style={{ color, fontWeight: 700 }}>{fmt(adj.amount_xmr, 6)} XMR</span>
                      </td>
                      <td style={styles.td}>
                        <span style={{ color: '#9ca3af', fontSize: 12 }}>
                          {fmt(adj.balance_before, 4)} → {fmt(adj.balance_after, 4)}
                        </span>
                      </td>
                      <td style={styles.td}>
                        <span style={{ color: '#9ca3af', fontSize: 12 }}>{adj.category}</span>
                      </td>
                      <td style={styles.td}>
                        <span style={{ color: '#9ca3af', fontSize: 12 }}>{adj.performed_by}</span>
                      </td>
                      <td style={styles.td}>
                        <span style={{ color: '#9ca3af', fontSize: 12 }}>{timeAgo(adj.performed_at)}</span>
                      </td>
                      <td style={styles.td}>
                        {!isReversed && adj.is_reversible ? (
                          reversingId === adj.id ? (
                            <div style={{ display: 'flex', gap: 4, flexDirection: 'column' }}>
                              <input
                                placeholder="Reversal reason"
                                value={reverseReason}
                                onChange={e => setReverseReason(e.target.value)}
                                style={styles.inputSmall}
                              />
                              <input
                                placeholder="Admin 2FA code"
                                value={reverseTotp}
                                onChange={e => setReverseTotp(e.target.value)}
                                style={styles.inputSmall}
                                autoComplete="one-time-code"
                                inputMode="numeric"
                              />
                              <div style={{ display: 'flex', gap: 4 }}>
                                <button onClick={() => handleReverse(adj.id)} style={styles.btnApprove}>✅</button>
                                <button
                                  onClick={() => { setReversingId(null); setReverseTotp(''); setReverseReason(''); }}
                                  style={styles.btnReject}
                                >✕</button>
                              </div>
                            </div>
                          ) : (
                            <button
                              onClick={() => setReversingId(adj.id)}
                              style={styles.btnReview}
                            >↩️ Reverse</button>
                          )
                        ) : isReversed ? (
                          <span style={{ color: '#6b7280', fontSize: 11 }}>Reversed</span>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// TAB 5 — WITHDRAWAL RULES
// ============================================================

function WithdrawalRules({ get, post }) {
  const [rules, setRules] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editingTier, setEditingTier] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await get('/api/admin/withdrawal-rules');
      setRules(d.rules);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [get]);

  useEffect(() => { load(); }, [load]);

  const startEdit = (tier, rule) => {
    setEditingTier(tier);
    setEditForm({ ...rule });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await post(`/api/admin/withdrawal-rules/${editingTier}`, editForm);
      setEditingTier(null);
      await load();
      alert(`✅ Rules for tier "${editingTier}" updated successfully`);
    } catch (e) {
      alert(`Error: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Spinner />;
  if (!rules) return <ErrorMsg msg="Failed to load rules" />;

  return (
    <div>
      <div style={styles.card}>
        <h3 style={styles.cardTitle}>⚙️ Withdrawal Tier Configuration</h3>
        <p style={{ color: '#9ca3af', fontSize: 13, marginBottom: 20 }}>
          Configure automatic validation rules for each withdrawal tier.
          Changes take effect immediately for new withdrawal requests.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {['small', 'medium', 'large'].map(tier => {
            const rule = rules[tier];
            const tc = TIER_CONFIG[tier];
            if (!rule) return null;
            const isEditing = editingTier === tier;

            return (
              <div key={tier} style={{
                ...styles.ruleCard,
                borderColor: tc.color,
                background: tc.bg
              }}>
                <div style={styles.ruleHeader}>
                  <div>
                    <span style={{ fontSize: 20 }}>{tc.icon}</span>
                    <span style={{ color: tc.color, fontWeight: 700, fontSize: 18, marginLeft: 8 }}>
                      {tc.label} TIER
                    </span>
                    <span style={{ color: '#9ca3af', fontSize: 13, marginLeft: 12 }}>
                      {fmt(rule.min_xmr, 3)} – {rule.max_xmr >= 9999 ? '∞' : fmt(rule.max_xmr, 3)} XMR
                    </span>
                  </div>
                  <button
                    onClick={() => isEditing ? setEditingTier(null) : startEdit(tier, rule)}
                    style={isEditing ? styles.btnReject : styles.btnSecondary}
                  >
                    {isEditing ? '✕ Cancel' : '✏️ Edit'}
                  </button>
                </div>

                {!isEditing ? (
                  <div style={styles.ruleGrid}>
                    <RuleItem label="Auto Approve" value={rule.auto_approve ? '✅ Yes' : '❌ No'} />
                    <RuleItem label="Admin Review" value={rule.require_admin_review ? '✅ Required' : '❌ Not required'} />
                    <RuleItem label="Dual Approval" value={rule.require_dual_approval ? '✅ Required' : '❌ Not required'} />
                    <RuleItem label="Daily Limit" value={`${fmt(rule.max_daily_xmr, 2)} XMR`} />
                    <RuleItem label="Weekly Limit" value={`${fmt(rule.max_weekly_xmr, 2)} XMR`} />
                    <RuleItem label="Cooldown" value={`${rule.cooldown_seconds}s`} />
                    <RuleItem label="Allow Partial" value={rule.allow_partial ? '✅ Yes' : '❌ No'} />
                    <RuleItem label="Min Partial %" value={`${Math.round(rule.partial_min_pct * 100)}%`} />
                    <RuleItem label="Expiry" value={`${rule.expiry_hours}h`} />
                    <RuleItem label="Last Updated" value={timeAgo(rule.updated_at)} />
                  </div>
                ) : (
                  <div style={styles.formGrid}>
                    <div style={styles.formGroup}>
                      <label style={styles.label}>Min XMR</label>
                      <input type="number" step="0.001" value={editForm.min_xmr || ''}
                        onChange={e => setEditForm({ ...editForm, min_xmr: parseFloat(e.target.value) })}
                        style={styles.input} />
                    </div>
                    <div style={styles.formGroup}>
                      <label style={styles.label}>Max XMR</label>
                      <input type="number" step="0.001" value={editForm.max_xmr || ''}
                        onChange={e => setEditForm({ ...editForm, max_xmr: parseFloat(e.target.value) })}
                        style={styles.input} />
                    </div>
                    <div style={styles.formGroup}>
                      <label style={styles.label}>Auto Approve</label>
                      <select value={editForm.auto_approve ? '1' : '0'}
                        onChange={e => setEditForm({ ...editForm, auto_approve: e.target.value === '1' })}
                        style={styles.input}>
                        <option value="1">✅ Yes</option>
                        <option value="0">❌ No</option>
                      </select>
                    </div>
                    <div style={styles.formGroup}>
                      <label style={styles.label}>Require Admin Review</label>
                      <select value={editForm.require_admin_review ? '1' : '0'}
                        onChange={e => setEditForm({ ...editForm, require_admin_review: e.target.value === '1' })}
                        style={styles.input}>
                        <option value="1">✅ Yes</option>
                        <option value="0">❌ No</option>
                      </select>
                    </div>
                    <div style={styles.formGroup}>
                      <label style={styles.label}>Require Dual Approval</label>
                      <select value={editForm.require_dual_approval ? '1' : '0'}
                        onChange={e => setEditForm({ ...editForm, require_dual_approval: e.target.value === '1' })}
                        style={styles.input}>
                        <option value="1">✅ Yes</option>
                        <option value="0">❌ No</option>
                      </select>
                    </div>
                    <div style={styles.formGroup}>
                      <label style={styles.label}>Daily Limit (XMR)</label>
                      <input type="number" step="0.1" value={editForm.max_daily_xmr || ''}
                        onChange={e => setEditForm({ ...editForm, max_daily_xmr: parseFloat(e.target.value) })}
                        style={styles.input} />
                    </div>
                    <div style={styles.formGroup}>
                      <label style={styles.label}>Weekly Limit (XMR)</label>
                      <input type="number" step="0.1" value={editForm.max_weekly_xmr || ''}
                        onChange={e => setEditForm({ ...editForm, max_weekly_xmr: parseFloat(e.target.value) })}
                        style={styles.input} />
                    </div>
                    <div style={styles.formGroup}>
                      <label style={styles.label}>Cooldown (seconds)</label>
                      <input type="number" value={editForm.cooldown_seconds || ''}
                        onChange={e => setEditForm({ ...editForm, cooldown_seconds: parseInt(e.target.value) })}
                        style={styles.input} />
                    </div>
                    <div style={styles.formGroup}>
                      <label style={styles.label}>Allow Partial Settlement</label>
                      <select value={editForm.allow_partial ? '1' : '0'}
                        onChange={e => setEditForm({ ...editForm, allow_partial: e.target.value === '1' })}
                        style={styles.input}>
                        <option value="1">✅ Yes</option>
                        <option value="0">❌ No</option>
                      </select>
                    </div>
                    <div style={styles.formGroup}>
                      <label style={styles.label}>Expiry (hours)</label>
                      <input type="number" value={editForm.expiry_hours || ''}
                        onChange={e => setEditForm({ ...editForm, expiry_hours: parseInt(e.target.value) })}
                        style={styles.input} />
                    </div>
                    <div style={{ gridColumn: '1 / -1' }}>
                      <button onClick={handleSave} disabled={saving} style={styles.btnPrimary}>
                        {saving ? '⟳ Saving...' : '💾 Save Changes'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// MODALS
// ============================================================

function ActionModal({ wd, action, onConfirm, onClose, post, onReload }) {
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [txid, setTxid] = useState('');
  const [loading, setLoading] = useState(false);

  const tc = TIER_CONFIG[wd.tier] || {};
  const isMarkProcessing = action === 'mark_processing';

  const handleConfirm = async () => {
    setLoading(true);
    try {
      if (isMarkProcessing) {
        await post(`/api/admin/withdrawals/${wd.id}/mark-processing`, { txid });
        await onReload();
        onClose();
      } else {
        await onConfirm(wd.id, action, reason, notes);
      }
    } catch (e) {
      alert(`Error: ${e.message}`);
    } finally {
      setLoading(false);
    }
  };

  const actionLabels = {
    approve: { title: '✅ Validate Withdrawal', color: '#22c55e', btn: 'Validate' },
    reject: { title: '❌ Reject Withdrawal', color: '#ef4444', btn: 'Reject' },
    cancel: { title: '🚫 Cancel Withdrawal', color: '#ef4444', btn: 'Cancel & Refund' },
    flag_review: { title: '🔍 Flag for Review', color: '#8b5cf6', btn: 'Flag' },
    mark_processing: { title: '⚙️ Mark as Processing', color: '#3b82f6', btn: 'Confirm' },
  };
  const al = actionLabels[action] || {};

  return (
    <div style={styles.modalOverlay}>
      <div style={styles.modal}>
        <h3 style={{ color: al.color, marginBottom: 16 }}>{al.title}</h3>

        <div style={styles.modalInfo}>
          <div><span style={{ color: '#9ca3af' }}>User:</span> <strong>{wd.username}</strong></div>
          <div><span style={{ color: '#9ca3af' }}>Amount:</span> <strong style={{ color: '#f59e0b' }}>{fmt(wd.amount_xmr, 6)} XMR</strong></div>
          <div><span style={{ color: '#9ca3af' }}>Tier:</span> <span style={{ color: tc.color }}>{tc.icon} {tc.label}</span></div>
          <div><span style={{ color: '#9ca3af' }}>ID:</span> <code style={styles.code}>{wd.id}</code></div>
        </div>

        {(action === 'reject' || action === 'cancel') && (
          <div style={styles.formGroup}>
            <label style={styles.label}>{action === 'cancel' ? 'Cancellation Reason *' : 'Rejection Reason *'}</label>
            <textarea
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder={action === 'cancel' ? 'Explain why this withdrawal is being cancelled...' : 'Explain why this withdrawal is being rejected...'}
              style={{ ...styles.input, height: 80 }}
            />
          </div>
        )}

        {isMarkProcessing && (
          <div style={styles.formGroup}>
            <label style={styles.label}>Transaction ID (optional)</label>
            <input
              value={txid}
              onChange={e => setTxid(e.target.value)}
              placeholder="Monero TXID..."
              style={styles.input}
            />
          </div>
        )}

        <div style={styles.formGroup}>
          <label style={styles.label}>Internal Notes (optional)</label>
          <input
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Internal notes for audit trail..."
            style={styles.input}
          />
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
          <button
            onClick={handleConfirm}
            disabled={loading || ((action === 'reject' || action === 'cancel') && !reason)}
            style={{ ...styles.btnPrimary, background: al.color, flex: 1 }}
          >
            {loading ? '⟳ Processing...' : al.btn}
          </button>
          <button onClick={onClose} style={{ ...styles.btnSecondary, flex: 1 }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function SettlementModal({ wd, onConfirm, onClose }) {
  const [numTranches, setNumTranches] = useState(3);
  const [intervalHours, setIntervalHours] = useState(24);
  const [notes, setNotes] = useState('');

  const perTranche = wd.amount_xmr / numTranches;

  return (
    <div style={styles.modalOverlay}>
      <div style={styles.modal}>
        <h3 style={{ color: '#f97316', marginBottom: 16 }}>📦 Create Partial Settlement Plan</h3>

        <div style={styles.modalInfo}>
          <div><span style={{ color: '#9ca3af' }}>User:</span> <strong>{wd.username}</strong></div>
          <div><span style={{ color: '#9ca3af' }}>Total Amount:</span> <strong style={{ color: '#f59e0b' }}>{fmt(wd.amount_xmr, 6)} XMR</strong></div>
        </div>

        <div style={styles.formGrid}>
          <div style={styles.formGroup}>
            <label style={styles.label}>Number of Tranches (2–10)</label>
            <input
              type="number" min="2" max="10"
              value={numTranches}
              onChange={e => setNumTranches(parseInt(e.target.value))}
              style={styles.input}
            />
          </div>
          <div style={styles.formGroup}>
            <label style={styles.label}>Interval Between Tranches (hours)</label>
            <input
              type="number" min="1"
              value={intervalHours}
              onChange={e => setIntervalHours(parseInt(e.target.value))}
              style={styles.input}
            />
          </div>
        </div>

        {/* Preview */}
        <div style={{ background: 'rgba(249,115,22,0.08)', border: '1px solid rgba(249,115,22,0.3)', borderRadius: 8, padding: 12, marginBottom: 16 }}>
          <div style={{ color: '#f97316', fontWeight: 600, marginBottom: 8 }}>📋 Settlement Preview</div>
          {Array.from({ length: numTranches }, (_, i) => (
            <div key={i} style={{ color: '#9ca3af', fontSize: 13, marginBottom: 4 }}>
              Tranche {i + 1}: <strong style={{ color: '#f59e0b' }}>{fmt(perTranche, 6)} XMR</strong>
              {' '}— in {i * intervalHours}h
            </div>
          ))}
        </div>

        <div style={styles.formGroup}>
          <label style={styles.label}>Notes (optional)</label>
          <input
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Reason for partial settlement..."
            style={styles.input}
          />
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
          <button
            onClick={() => onConfirm(wd.id, numTranches, intervalHours, notes)}
            style={{ ...styles.btnPrimary, background: '#f97316', flex: 1 }}
          >
            📦 Create Settlement Plan
          </button>
          <button onClick={onClose} style={{ ...styles.btnSecondary, flex: 1 }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// SMALL COMPONENTS
// ============================================================

function MetricCard({ title, value, sub, icon, color, tooltip }) {
  return (
    <div style={{ ...styles.metricCard, borderColor: color }} title={tooltip}>
      <div style={{ fontSize: 28, marginBottom: 8 }}>{icon}</div>
      <div style={{ color: '#9ca3af', fontSize: 12, marginBottom: 4 }}>{title}</div>
      <div style={{ color, fontSize: 22, fontWeight: 700 }}>{value}</div>
      {sub && <div style={{ color: '#6b7280', fontSize: 12, marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function BreakdownRow({ label, value, color, total, highlight }) {
  const pct = total > 0 ? Math.min(100, (value / total) * 100) : 0;
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ color: highlight ? '#e5e7eb' : '#9ca3af', fontWeight: highlight ? 600 : 400 }}>
          {label}
        </span>
        <span style={{ color, fontWeight: 600 }}>{fmt(value, 6)} XMR</span>
      </div>
      <div style={{ background: '#1f2937', borderRadius: 4, height: 6 }}>
        <div style={{
          background: color, borderRadius: 4, height: 6,
          width: `${pct}%`, transition: 'width 0.5s ease'
        }} />
      </div>
    </div>
  );
}

function CoverageChart({ snapshots }) {
  const max = Math.max(...snapshots.map(s => s.coverage_ratio || 0), 1.5);
  const h = 120;
  const w = 100;

  return (
    <div style={{ overflowX: 'auto' }}>
      <svg width={snapshots.length * 20 + 40} height={h + 30} style={{ display: 'block' }}>
        {/* 100% line */}
        <line x1="20" y1={h * (1 - 1 / max)} x2={snapshots.length * 20 + 20} y2={h * (1 - 1 / max)}
          stroke="#22c55e" strokeWidth="1" strokeDasharray="4,4" opacity="0.5" />
        <text x="22" y={h * (1 - 1 / max) - 4} fill="#22c55e" fontSize="10" opacity="0.7">100%</text>

        {/* Bars */}
        {snapshots.map((s, i) => {
          const ratio = s.coverage_ratio || 0;
          const barH = (ratio / max) * h;
          const color = ratio >= 1.5 ? '#22c55e' : ratio >= 1.0 ? '#3b82f6' : ratio >= 0.8 ? '#f59e0b' : '#ef4444';
          return (
            <g key={i}>
              <rect
                x={i * 20 + 22} y={h - barH} width={14} height={barH}
                fill={color} opacity="0.8" rx="2"
              />
              <title>{`${Math.round(ratio * 100)}% — ${s.snapshot_at?.slice(0, 16)}`}</title>
            </g>
          );
        })}
      </svg>
      <div style={{ color: '#6b7280', fontSize: 11, marginTop: 4 }}>
        ← Older · Newer → (each bar = 1 snapshot)
      </div>
    </div>
  );
}

function RuleItem({ label, value }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ color: '#6b7280', fontSize: 11 }}>{label}</span>
      <span style={{ color: '#e5e7eb', fontSize: 13, fontWeight: 500 }}>{value}</span>
    </div>
  );
}

function Spinner() {
  return (
    <div style={{ textAlign: 'center', padding: 60, color: '#9ca3af' }}>
      <div style={{ fontSize: 32, marginBottom: 12 }}>⟳</div>
      Loading...
    </div>
  );
}

function ErrorMsg({ msg }) {
  return (
    <div style={{ textAlign: 'center', padding: 40, color: '#ef4444' }}>
      ⚠️ {msg}
    </div>
  );
}

// ============================================================
// STYLES
// ============================================================

const styles = {
  container: {
    background: '#111827',
    minHeight: '100vh',
    color: '#e5e7eb',
    fontFamily: "'Inter', 'Segoe UI', sans-serif",
  },
  header: {
    padding: '24px 28px 0',
    borderBottom: '1px solid #1f2937',
    paddingBottom: 20,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  title: {
    fontSize: 24,
    fontWeight: 700,
    color: '#f9fafb',
    margin: 0,
  },
  subtitle: {
    color: '#6b7280',
    fontSize: 13,
    margin: '4px 0 0',
  },
  tabBar: {
    display: 'flex',
    gap: 4,
    padding: '12px 28px',
    borderBottom: '1px solid #1f2937',
    overflowX: 'auto',
  },
  tabBtn: {
    background: 'transparent',
    border: '1px solid transparent',
    color: '#9ca3af',
    padding: '8px 16px',
    borderRadius: 8,
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 500,
    whiteSpace: 'nowrap',
    transition: 'all 0.15s',
  },
  tabBtnActive: {
    background: 'rgba(139,92,246,0.15)',
    border: '1px solid rgba(139,92,246,0.4)',
    color: '#a78bfa',
  },
  content: {
    padding: '24px 28px',
  },
  card: {
    background: '#1f2937',
    border: '1px solid #374151',
    borderRadius: 12,
    padding: 20,
    marginBottom: 20,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: 600,
    color: '#f9fafb',
    margin: '0 0 16px',
  },
  metricsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
    gap: 16,
    marginBottom: 20,
  },
  metricCard: {
    background: '#1f2937',
    border: '1px solid',
    borderRadius: 12,
    padding: 20,
    textAlign: 'center',
    cursor: 'help',
  },
  riskBanner: {
    display: 'flex',
    alignItems: 'center',
    gap: 16,
    padding: '16px 20px',
    borderRadius: 12,
    border: '1px solid',
    marginBottom: 20,
  },
  refreshBtn: {
    marginLeft: 'auto',
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid #374151',
    color: '#9ca3af',
    padding: '8px 16px',
    borderRadius: 8,
    cursor: 'pointer',
    fontSize: 13,
  },
  breakdownGrid: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  statsRow: {
    display: 'flex',
    gap: 12,
    flexWrap: 'wrap',
    marginBottom: 20,
  },
  statChip: {
    background: '#1f2937',
    border: '1px solid #374151',
    borderRadius: 8,
    padding: '10px 16px',
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    fontSize: 13,
    minWidth: 120,
  },
  badge: {
    display: 'inline-block',
    padding: '2px 8px',
    borderRadius: 4,
    fontSize: 11,
    fontWeight: 600,
  },
  controlBar: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
    flexWrap: 'wrap',
    gap: 12,
  },
  btnGroup: {
    display: 'flex',
    gap: 6,
  },
  btnPrimary: {
    background: '#7c3aed',
    color: '#fff',
    border: 'none',
    padding: '8px 16px',
    borderRadius: 8,
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 600,
  },
  btnSecondary: {
    background: '#374151',
    color: '#e5e7eb',
    border: '1px solid #4b5563',
    padding: '8px 16px',
    borderRadius: 8,
    cursor: 'pointer',
    fontSize: 13,
  },
  btnApprove: {
    background: 'rgba(34,197,94,0.15)',
    color: '#22c55e',
    border: '1px solid rgba(34,197,94,0.3)',
    padding: '5px 10px',
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 600,
  },
  btnReject: {
    background: 'rgba(239,68,68,0.15)',
    color: '#ef4444',
    border: '1px solid rgba(239,68,68,0.3)',
    padding: '5px 10px',
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 600,
  },
  btnReview: {
    background: 'rgba(139,92,246,0.15)',
    color: '#a78bfa',
    border: '1px solid rgba(139,92,246,0.3)',
    padding: '5px 10px',
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 600,
  },
  btnProcess: {
    background: 'rgba(59,130,246,0.15)',
    color: '#60a5fa',
    border: '1px solid rgba(59,130,246,0.3)',
    padding: '5px 10px',
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 600,
  },
  btnPartial: {
    background: 'rgba(249,115,22,0.15)',
    color: '#fb923c',
    border: '1px solid rgba(249,115,22,0.3)',
    padding: '5px 10px',
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 600,
  },
  tierBtn: {
    background: '#374151',
    color: '#9ca3af',
    border: '1px solid #4b5563',
    padding: '6px 12px',
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 600,
  },
  tableWrapper: {
    overflowX: 'auto',
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: 13,
  },
  th: {
    textAlign: 'left',
    padding: '10px 12px',
    color: '#6b7280',
    fontWeight: 600,
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    borderBottom: '1px solid #374151',
    whiteSpace: 'nowrap',
  },
  td: {
    padding: '12px 12px',
    borderBottom: '1px solid #1f2937',
    verticalAlign: 'middle',
  },
  tr: {
    transition: 'background 0.1s',
  },
  code: {
    fontFamily: 'monospace',
    fontSize: 11,
    color: '#9ca3af',
    background: '#111827',
    padding: '2px 6px',
    borderRadius: 4,
  },
  actionBtns: {
    display: 'flex',
    gap: 4,
    flexWrap: 'wrap',
  },
  emptyState: {
    textAlign: 'center',
    padding: '40px 20px',
    color: '#6b7280',
    fontSize: 14,
  },
  formGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
    gap: 16,
    marginTop: 16,
  },
  formGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  label: {
    color: '#9ca3af',
    fontSize: 12,
    fontWeight: 500,
  },
  input: {
    background: '#111827',
    border: '1px solid #374151',
    borderRadius: 8,
    color: '#e5e7eb',
    padding: '8px 12px',
    fontSize: 13,
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box',
  },
  inputSmall: {
    background: '#111827',
    border: '1px solid #374151',
    borderRadius: 6,
    color: '#e5e7eb',
    padding: '5px 8px',
    fontSize: 12,
    outline: 'none',
    width: 140,
  },
  modalOverlay: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(0,0,0,0.7)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
    backdropFilter: 'blur(4px)',
  },
  modal: {
    background: '#1f2937',
    border: '1px solid #374151',
    borderRadius: 16,
    padding: 28,
    width: '100%',
    maxWidth: 520,
    maxHeight: '90vh',
    overflowY: 'auto',
  },
  modalInfo: {
    background: '#111827',
    borderRadius: 8,
    padding: 14,
    marginBottom: 16,
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    fontSize: 13,
  },
  ruleCard: {
    border: '1px solid',
    borderRadius: 12,
    padding: 20,
  },
  ruleHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  ruleGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
    gap: 12,
  },
};

