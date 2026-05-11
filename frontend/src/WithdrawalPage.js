/**
 * SILKGENESIS — User Withdrawal Page
 * ====================================
 * Page de withdrawal side user.
 * Displays :
 *   - Balance disponible
 *   - Formulaire de withdrawal avec validation
 *   - Historique des withdrawals avec statuts
 *   - Details des partial settlements (tranches)
 *   - Banners de statut de la plateforme
 *
 * Usage dans App.js :
 *   import WithdrawalPage from './WithdrawalPage';
 *   <WithdrawalPage user={user} />
 */

import React, { useState, useEffect, useCallback } from 'react';

const API = '/api';
const POLL_INTERVAL = 30_000; // 30s

// ============================================================
// HELPERS
// ============================================================

function fmt(n, d = 6) {
  if (n === null || n === undefined) return '—';
  return parseFloat(n).toFixed(d);
}

function timeAgo(iso) {
  if (!iso) return '—';
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function validateMoneroAddress(address) {
  const value = String(address || '').trim();
  const base58Re = /^[123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]+$/;
  const isStandardOrSub = value.length === 95 && (value.startsWith('4') || value.startsWith('8'));
  const isIntegrated = value.length === 106 && value.startsWith('4');
  return (isStandardOrSub || isIntegrated) && base58Re.test(value);
}

const STATUS_CONFIG = {
  pending:      { color: '#f59e0b', bg: 'rgba(245,158,11,0.1)',  icon: '⏳', label: 'Pending Review' },
  under_review: { color: '#8b5cf6', bg: 'rgba(139,92,246,0.1)', icon: '🔍', label: 'Under Review' },
  approved:     { color: '#3b82f6', bg: 'rgba(59,130,246,0.1)', icon: '✅', label: 'Approved' },
  processing:   { color: '#06b6d4', bg: 'rgba(6,182,212,0.1)',  icon: '⚙️', label: 'Processing' },
  completed:    { color: '#22c55e', bg: 'rgba(34,197,94,0.1)',  icon: '✔️', label: 'Completed' },
  rejected:     { color: '#ef4444', bg: 'rgba(239,68,68,0.1)',  icon: '❌', label: 'Rejected' },
  cancelled:    { color: '#6b7280', bg: 'rgba(107,114,128,0.1)', icon: '🚫', label: 'Cancelled' },
  expired:      { color: '#6b7280', bg: 'rgba(107,114,128,0.1)', icon: '⌛', label: 'Expired' },
  partial:      { color: '#f97316', bg: 'rgba(249,115,22,0.1)', icon: '📦', label: 'Partial Settlement' },
};

const TIER_CONFIG = {
  small:  { color: '#22c55e', label: 'Small',  icon: '🟢' },
  medium: { color: '#f59e0b', label: 'Medium', icon: '🟡' },
  large:  { color: '#ef4444', label: 'Large',  icon: '🔴' },
};

// ============================================================
// MAIN COMPONENT
// ============================================================

export default function WithdrawalPage({ user }) {
  const [tab, setTab] = useState('new');
  const [history, setHistory] = useState([]);
  const [platformStatus, setPlatformStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({ amount_xmr: '', dest_address: '', notes: '' });
  const [formError, setFormError] = useState('');
  const [formSuccess, setFormSuccess] = useState('');
  const [selectedWd, setSelectedWd] = useState(null);
  const [settlements, setSettlements] = useState([]);

  const token = user?.session_token || localStorage.getItem('session_token') || '';

  const headers = {
    'Content-Type': 'application/json',
    'X-Session-Token': token,
  };

  // ── Fetch platform status ──────────────────────────────────
  const fetchPlatformStatus = useCallback(async () => {
    try {
      const r = await fetch(`${API}/platform/status`);
      if (r.ok) setPlatformStatus(await r.json());
    } catch {}
  }, []);

  // ── Fetch withdrawal history ───────────────────────────────
  const fetchHistory = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`${API}/withdrawal/history`, { headers });
      if (r.ok) {
        const d = await r.json();
        setHistory(d.withdrawals || []);
      }
    } catch {}
    setLoading(false);
  }, [token]);

  // ── Fetch settlement detail ────────────────────────────────
  const fetchSettlements = useCallback(async (wid) => {
    try {
      const r = await fetch(`${API}/withdrawal/${wid}`, { headers });
      if (r.ok) {
        const d = await r.json();
        setSettlements(d.settlements || []);
      }
    } catch {}
  }, [token]);

  useEffect(() => {
    fetchPlatformStatus();
    fetchHistory();
    const interval = setInterval(() => {
      fetchPlatformStatus();
      fetchHistory();
    }, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchPlatformStatus, fetchHistory]);

  useEffect(() => {
    if (selectedWd?.is_partial) {
      fetchSettlements(selectedWd.id);
    } else {
      setSettlements([]);
    }
  }, [selectedWd, fetchSettlements]);

  // ── Submit withdrawal ──────────────────────────────────────
  const handleSubmit = async () => {
    setFormError('');
    setFormSuccess('');

    const amount = parseFloat(form.amount_xmr);
    if (!amount || amount <= 0) {
      setFormError('Please enter a valid amount.');
      return;
    }
    const trimmedAddress = String(form.dest_address || '').trim();
    if (!validateMoneroAddress(trimmedAddress)) {
      setFormError(
        'Invalid XMR address format. Use a valid Monero address (95 chars starting with 4 or 8, or integrated 106 chars starting with 4).'
      );
      return;
    }
    if (amount > parseFloat(user?.balance || 0)) {
      setFormError('Insufficient balance.');
      return;
    }

    setSubmitting(true);
    try {
      const r = await fetch(`${API}/withdrawal/submit`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          amount_xmr: amount,
          dest_address: trimmedAddress,
          notes: form.notes.trim(),
        }),
      });
      const d = await r.json();
      if (!r.ok) {
        if (d?.detail === 'INVALID_XMR_ADDRESS') {
          setFormError(
            'Invalid XMR address format. Please check your destination address and try again.'
          );
        } else {
          setFormError(d.detail || 'Withdrawal failed. Please try again.');
        }
      } else {
        setFormSuccess(
          `✅ Withdrawal submitted! ID: ${d.withdrawal_id} — Status: ${d.status} — Tier: ${d.tier}`
        );
        setForm({ amount_xmr: '', dest_address: '', notes: '' });
        await fetchHistory();
        setTab('history');
      }
    } catch (e) {
      setFormError('Network error. Please try again.');
    }
    setSubmitting(false);
  };

  // ── Cancel withdrawal ──────────────────────────────────────
  const handleCancel = async (wid) => {
    if (!window.confirm('Cancel this withdrawal? Your balance will be refunded.')) return;
    try {
      const r = await fetch(`${API}/withdrawal/${wid}/cancel`, {
        method: 'POST',
        headers,
      });
      const d = await r.json();
      if (r.ok) {
        alert('✅ Withdrawal cancelled. Balance refunded.');
        await fetchHistory();
      } else {
        alert(`Error: ${d.detail}`);
      }
    } catch {
      alert('Network error.');
    }
  };

  const isFrozen = platformStatus?.emergency_freeze?.active;
  const hasPositiveBalance = parseFloat(user?.balance || 0) > 0;
  const isLPM = platformStatus?.liquidity_protection_mode?.active;
  const isStructured = platformStatus?.structured_withdrawal_policy?.active;

  return (
    <div style={s.container}>
      {/* ── Platform Status Banners ── */}
      {isFrozen && (
        <div style={{ ...s.banner, ...s.bannerCritical }}>
          <span style={s.bannerIcon}>🔒</span>
          <div>
            <div style={{ fontWeight: 700, color: '#ef4444', marginBottom: 2 }}>
              Withdrawals Temporarily Paused
            </div>
            <div style={s.bannerMsg}>{platformStatus.emergency_freeze.user_message}</div>
          </div>
        </div>
      )}
      {isLPM && !isFrozen && (
        <div style={{ ...s.banner, ...s.bannerWarning }}>
          <span style={s.bannerIcon}>⚠️</span>
          <div>
            <div style={{ fontWeight: 700, color: '#f59e0b', marginBottom: 2 }}>
              Liquidity Protection Mode Active
            </div>
            <div style={s.bannerMsg}>{platformStatus.liquidity_protection_mode.user_message}</div>
          </div>
        </div>
      )}
      {isStructured && !isFrozen && (
        <div style={{ ...s.banner, ...s.bannerInfo }}>
          <span style={s.bannerIcon}>ℹ️</span>
          <div>
            <div style={{ fontWeight: 700, color: '#60a5fa', marginBottom: 2 }}>
              Structured Withdrawal Policy
            </div>
            <div style={s.bannerMsg}>{platformStatus.structured_withdrawal_policy.user_message}</div>
          </div>
        </div>
      )}

      {/* ── Header ── */}
      <div style={s.header}>
        <div>
          <h2 style={s.title}>💸 Withdrawals</h2>
          <div style={s.subtitle}>
            Available balance:{' '}
            <strong style={{ color: '#22c55e' }}>{fmt(user?.balance, 8)} XMR</strong>
          </div>
        </div>
        <button onClick={fetchHistory} style={s.refreshBtn}>🔄 Refresh</button>
      </div>

      {/* ── Tab Bar ── */}
      <div style={s.tabBar}>
        {[
          { id: 'new', label: '+ New Withdrawal' },
          { id: 'history', label: `📋 History (${history.length})` },
        ].map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{ ...s.tabBtn, ...(tab === t.id ? s.tabBtnActive : {}) }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div style={s.content}>
        {/* ── NEW WITHDRAWAL TAB ── */}
        {tab === 'new' && (
          <div style={s.card}>
            <h3 style={s.cardTitle}>Submit Withdrawal Request</h3>

            {isFrozen ? (
              <div style={{ ...s.alertBox, borderColor: '#ef4444', background: 'rgba(239,68,68,0.08)' }}>
                <strong style={{ color: '#ef4444' }}>🔒 Withdrawals are currently paused.</strong>
                <div style={{ color: '#9ca3af', fontSize: 13, marginTop: 4 }}>
                  {platformStatus.emergency_freeze.user_message}
                </div>
              </div>
            ) : (
              <>
                {/* Amount */}
                <div style={s.formGroup}>
                  <label style={s.label}>Amount (XMR) *</label>
                  <div style={{ position: 'relative' }}>
                    <input
                      type="number"
                      step="0.000001"
                      min="0.001"
                      value={form.amount_xmr}
                      onChange={e => setForm({ ...form, amount_xmr: e.target.value })}
                      placeholder="0.000000"
                      style={s.input}
                    />
                    <button
                      onClick={() => setForm({ ...form, amount_xmr: fmt(user?.balance, 8) })}
                      style={s.maxBtn}
                    >
                      MAX
                    </button>
                  </div>
                  {form.amount_xmr && (
                    <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
                      Tier:{' '}
                      {parseFloat(form.amount_xmr) <= 1.0
                        ? '🟢 Small (auto-processed)'
                        : parseFloat(form.amount_xmr) <= 10.0
                        ? '🟡 Medium (admin review)'
                        : '🔴 Large (dual approval required)'}
                    </div>
                  )}
                </div>

                {/* Destination Address */}
                <div style={s.formGroup}>
                  <label style={s.label}>Destination Monero Address *</label>
                  <input
                    value={form.dest_address}
                    onChange={e => setForm({ ...form, dest_address: e.target.value })}
                    placeholder="Monero address (95 or 106 chars)"
                    style={{ ...s.input, fontFamily: 'monospace', fontSize: 12 }}
                  />
                  {form.dest_address && !validateMoneroAddress(form.dest_address) && (
                    <div style={{ fontSize: 11, color: '#ef4444', marginTop: 2 }}>
                      ⚠️ Invalid address format. Expected 95 chars (starts with 4 or 8) or 106 chars (starts with 4).
                    </div>
                  )}
                </div>

                {/* Notes */}
                <div style={s.formGroup}>
                  <label style={s.label}>Notes (optional)</label>
                  <input
                    value={form.notes}
                    onChange={e => setForm({ ...form, notes: e.target.value })}
                    placeholder="Optional note for this withdrawal..."
                    style={s.input}
                  />
                </div>

                {/* Structured policy notice */}
                {isStructured && form.amount_xmr &&
                  parseFloat(form.amount_xmr) >= (platformStatus?.structured_withdrawal_policy?.threshold_xmr || 60) && (
                  <div style={{ ...s.alertBox, borderColor: '#f97316', background: 'rgba(249,115,22,0.08)' }}>
                    <strong style={{ color: '#f97316' }}>📦 Structured Payment Notice</strong>
                    <div style={{ color: '#9ca3af', fontSize: 13, marginTop: 4 }}>
                      {platformStatus.structured_withdrawal_policy.user_message}
                    </div>
                  </div>
                )}

                {/* Errors / Success */}
                {formError && (
                  <div style={{ ...s.alertBox, borderColor: '#ef4444', background: 'rgba(239,68,68,0.08)', color: '#ef4444' }}>
                    ❌ {formError}
                  </div>
                )}
                {formSuccess && (
                  <div style={{ ...s.alertBox, borderColor: '#22c55e', background: 'rgba(34,197,94,0.08)', color: '#22c55e' }}>
                    {formSuccess}
                  </div>
                )}

                {/* Info box */}
                <div style={{ ...s.alertBox, borderColor: '#374151', background: '#111827' }}>
                  <div style={{ color: '#9ca3af', fontSize: 12, lineHeight: 1.7 }}>
                    <div>🟢 <strong style={{ color: '#22c55e' }}>Small</strong> (≤1 XMR) — Auto-processed within minutes</div>
                    <div>🟡 <strong style={{ color: '#f59e0b' }}>Medium</strong> (1–10 XMR) — Admin review within 24h</div>
                    <div>🔴 <strong style={{ color: '#ef4444' }}>Large</strong> (&gt;10 XMR) — Dual approval, 48–72h</div>
                    <div style={{ marginTop: 6, color: '#6b7280' }}>
                      Your balance is reserved immediately upon submission.
                      If rejected, it is refunded automatically.
                    </div>
                  </div>
                </div>

                <button
                  onClick={handleSubmit}
                  disabled={submitting || isFrozen || !hasPositiveBalance}
                  style={{
                    ...s.btnPrimary,
                    opacity: submitting || isFrozen || !hasPositiveBalance ? 0.6 : 1,
                    cursor: submitting || isFrozen || !hasPositiveBalance ? 'not-allowed' : 'pointer',
                  }}
                >
                  {submitting ? '⟳ Submitting...' : '💸 Submit Withdrawal'}
                </button>
                {!hasPositiveBalance && (
                  <div style={{ color: '#ef4444', fontSize: 12, marginTop: 8 }}>
                    You need a positive balance to submit a withdrawal request.
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ── HISTORY TAB ── */}
        {tab === 'history' && (
          <div>
            {loading ? (
              <div style={s.emptyState}>⟳ Loading...</div>
            ) : history.length === 0 ? (
              <div style={s.emptyState}>
                <div style={{ fontSize: 40, marginBottom: 12 }}>📋</div>
                <div>No withdrawals yet</div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {history.map(wd => {
                  const sc = STATUS_CONFIG[wd.status] || STATUS_CONFIG.pending;
                  const tc = TIER_CONFIG[wd.tier] || {};
                  const isSelected = selectedWd?.id === wd.id;

                  return (
                    <div
                      key={wd.id}
                      style={{
                        ...s.card,
                        borderColor: isSelected ? '#7c3aed' : '#374151',
                        cursor: 'pointer',
                      }}
                      onClick={() => setSelectedWd(isSelected ? null : wd)}
                    >
                      {/* Row 1: ID + Status + Amount */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <code style={s.code}>{wd.id?.slice(0, 16)}…</code>
                          <span style={{
                            ...s.badge,
                            background: sc.bg,
                            color: sc.color,
                          }}>
                            {sc.icon} {sc.label}
                          </span>
                          {wd.tier && (
                            <span style={{ ...s.badge, color: tc.color, background: 'transparent', border: `1px solid ${tc.color}44` }}>
                              {tc.icon} {tc.label}
                            </span>
                          )}
                        </div>
                        <strong style={{ color: '#f59e0b', fontSize: 16 }}>
                          {fmt(wd.amount_xmr, 6)} XMR
                        </strong>
                      </div>

                      {/* Row 2: Address + Date */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#6b7280' }}>
                        <span style={{ fontFamily: 'monospace' }}>
                          → {wd.dest_address?.slice(0, 20)}…{wd.dest_address?.slice(-8)}
                        </span>
                        <span>{timeAgo(wd.created_at)}</span>
                      </div>

                      {/* Expanded detail */}
                      {isSelected && (
                        <div style={{ marginTop: 16, borderTop: '1px solid #374151', paddingTop: 16 }}>
                          {/* Full address */}
                          <div style={s.detailRow}>
                            <span style={s.detailLabel}>Destination</span>
                            <code style={{ ...s.code, wordBreak: 'break-all', fontSize: 10 }}>
                              {wd.dest_address}
                            </code>
                          </div>

                          {/* TXID if completed */}
                          {wd.txid && (
                            <div style={s.detailRow}>
                              <span style={s.detailLabel}>Transaction ID</span>
                              <code style={{ ...s.code, wordBreak: 'break-all', fontSize: 10 }}>
                                {wd.txid}
                              </code>
                            </div>
                          )}

                          {/* Rejection reason */}
                          {wd.rejection_reason && (
                            <div style={{ ...s.alertBox, borderColor: '#ef4444', background: 'rgba(239,68,68,0.08)', marginTop: 8 }}>
                              <strong style={{ color: '#ef4444' }}>Rejection reason:</strong>
                              <div style={{ color: '#9ca3af', fontSize: 13 }}>{wd.rejection_reason}</div>
                            </div>
                          )}

                          {/* Partial settlement tranches */}
                          {wd.is_partial && settlements.length > 0 && (
                            <div style={{ marginTop: 12 }}>
                              <div style={{ color: '#f97316', fontWeight: 600, marginBottom: 8, fontSize: 13 }}>
                                📦 Settlement Schedule ({settlements.length} tranches)
                              </div>
                              {settlements.map((s_item, i) => {
                                const ssc = STATUS_CONFIG[s_item.status] || STATUS_CONFIG.pending;
                                return (
                                  <div key={s_item.id} style={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                    padding: '6px 10px',
                                    background: '#111827',
                                    borderRadius: 6,
                                    marginBottom: 4,
                                    fontSize: 12,
                                  }}>
                                    <span style={{ color: '#9ca3af' }}>Tranche {i + 1}</span>
                                    <span style={{ color: '#f59e0b', fontWeight: 600 }}>
                                      {fmt(s_item.amount_xmr, 6)} XMR
                                    </span>
                                    <span style={{ color: '#6b7280' }}>
                                      {new Date(s_item.scheduled_at).toLocaleDateString()}
                                    </span>
                                    <span style={{ color: ssc.color }}>
                                      {ssc.icon} {ssc.label}
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          )}

                          {/* Cancel button (only for pending) */}
                          {wd.status === 'pending' && (
                            <button
                              onClick={e => { e.stopPropagation(); handleCancel(wd.id); }}
                              style={{ ...s.btnCancel, marginTop: 12 }}
                            >
                              🚫 Cancel Withdrawal
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// STYLES
// ============================================================

const s = {
  container: {
    background: '#111827',
    minHeight: '100vh',
    color: '#e5e7eb',
    fontFamily: "'Inter', 'Segoe UI', sans-serif",
  },
  banner: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 12,
    padding: '12px 20px',
    border: '1px solid',
    borderRadius: 0,
  },
  bannerCritical: {
    background: 'rgba(239,68,68,0.1)',
    borderColor: '#ef4444',
    borderLeft: '4px solid #ef4444',
  },
  bannerWarning: {
    background: 'rgba(245,158,11,0.1)',
    borderColor: '#f59e0b',
    borderLeft: '4px solid #f59e0b',
  },
  bannerInfo: {
    background: 'rgba(59,130,246,0.1)',
    borderColor: '#3b82f6',
    borderLeft: '4px solid #3b82f6',
  },
  bannerIcon: { fontSize: 20, flexShrink: 0, marginTop: 2 },
  bannerMsg: { color: '#d1d5db', fontSize: 13, lineHeight: 1.5 },
  header: {
    padding: '20px 24px',
    borderBottom: '1px solid #1f2937',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: { fontSize: 22, fontWeight: 700, color: '#f9fafb', margin: 0 },
  subtitle: { color: '#6b7280', fontSize: 13, marginTop: 4 },
  refreshBtn: {
    background: '#1f2937',
    border: '1px solid #374151',
    color: '#9ca3af',
    padding: '8px 14px',
    borderRadius: 8,
    cursor: 'pointer',
    fontSize: 13,
  },
  tabBar: {
    display: 'flex',
    gap: 4,
    padding: '10px 24px',
    borderBottom: '1px solid #1f2937',
  },
  tabBtn: {
    background: 'transparent',
    border: '1px solid transparent',
    color: '#9ca3af',
    padding: '7px 16px',
    borderRadius: 8,
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 500,
  },
  tabBtnActive: {
    background: 'rgba(124,58,237,0.15)',
    border: '1px solid rgba(124,58,237,0.4)',
    color: '#a78bfa',
  },
  content: { padding: '20px 24px' },
  card: {
    background: '#1f2937',
    border: '1px solid #374151',
    borderRadius: 12,
    padding: 20,
    marginBottom: 16,
  },
  cardTitle: { fontSize: 15, fontWeight: 600, color: '#f9fafb', margin: '0 0 16px' },
  formGroup: { marginBottom: 16 },
  label: { display: 'block', color: '#9ca3af', fontSize: 12, fontWeight: 500, marginBottom: 6 },
  input: {
    background: '#111827',
    border: '1px solid #374151',
    borderRadius: 8,
    color: '#e5e7eb',
    padding: '9px 12px',
    fontSize: 13,
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box',
  },
  maxBtn: {
    position: 'absolute',
    right: 8,
    top: '50%',
    transform: 'translateY(-50%)',
    background: '#374151',
    border: 'none',
    color: '#9ca3af',
    padding: '3px 8px',
    borderRadius: 4,
    cursor: 'pointer',
    fontSize: 11,
    fontWeight: 700,
  },
  alertBox: {
    border: '1px solid',
    borderRadius: 8,
    padding: '12px 14px',
    marginBottom: 14,
  },
  btnPrimary: {
    background: '#7c3aed',
    color: '#fff',
    border: 'none',
    padding: '11px 24px',
    borderRadius: 8,
    cursor: 'pointer',
    fontSize: 14,
    fontWeight: 700,
    width: '100%',
  },
  btnCancel: {
    background: 'rgba(239,68,68,0.1)',
    color: '#ef4444',
    border: '1px solid rgba(239,68,68,0.3)',
    padding: '7px 14px',
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 600,
  },
  badge: {
    display: 'inline-block',
    padding: '2px 8px',
    borderRadius: 4,
    fontSize: 11,
    fontWeight: 600,
  },
  code: {
    fontFamily: 'monospace',
    fontSize: 11,
    color: '#9ca3af',
    background: '#111827',
    padding: '2px 6px',
    borderRadius: 4,
  },
  detailRow: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    marginBottom: 10,
  },
  detailLabel: {
    color: '#6b7280',
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  emptyState: {
    textAlign: 'center',
    padding: '60px 20px',
    color: '#6b7280',
    fontSize: 14,
  },
};

