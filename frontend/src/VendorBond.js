import React, { useState, useEffect } from 'react';

const API = '';

function getAuthHeaders() {
  const token = sessionStorage.getItem('silkgenesis_session_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

const RISK_COLORS = {
  low: '#22c55e',
  medium: '#f59e0b',
  high: '#ef4444',
  critical: '#dc2626'
};

const RISK_LABELS = {
  low: '🟢 Low',
  medium: '🟡 Medium',
  high: '🔴 High',
  critical: '🚨 Critical'
};

const STATUS_INFO = {
  active:         { label: 'Bond Active',       color: '#22c55e', icon: '🔒', bg: '#16a34a11' },
  refund_pending: { label: 'Refund Pending',    color: '#f59e0b', icon: '⏳', bg: '#f59e0b11' },
  refunded:       { label: 'Bond Refunded',     color: '#6b7280', icon: '↩️', bg: '#6b728011' },
  seized:         { label: 'Bond Seized',       color: '#ef4444', icon: '🚫', bg: '#ef444411' },
};

// ============================================================
// VENDOR BOND PANEL (pour le vendor lui-meme)
// ============================================================
export default function VendorBond({ username }) {
  const [bond, setBond] = useState(null);
  const [config, setConfig] = useState({});
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState('');
  const [paying, setPaying] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [message, setMessage] = useState(null);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState([]);

  useEffect(() => {
    fetchAll();
  }, [username]);

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [bondR, configR] = await Promise.all([
        fetch(`${API}/api/vendor/bond/v2/${username}`, { headers: { ...getAuthHeaders() } }),
        fetch(`${API}/api/bonds/config`, { headers: { ...getAuthHeaders() } })
      ]);
      if (bondR.ok) {
        const data = await bondR.json();
        setBond(data.has_bond ? data : null);
        if (data.history) setHistory(data.history);
      }
      if (configR.ok) {
        const data = await configR.json();
        setConfig(data.config || {});
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const payBond = async () => {
    if (!selectedCategory) return;
    setPaying(true);
    setMessage(null);
    try {
      const r = await fetch(`${API}/api/vendor/bond/pay-v2`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ username, category: selectedCategory })
      });
      const data = await r.json();
      if (data.success) {
        setMessage({ type: 'success', text: `✅ Bond of ${data.amount_xmr} XMR paid for ${data.category}` });
        fetchAll();
      } else {
        setMessage({ type: 'error', text: data.detail || 'Payment failed' });
      }
    } catch (e) {
      setMessage({ type: 'error', text: 'Network error' });
    } finally {
      setPaying(false);
    }
  };

  const requestRefund = async () => {
    setRequesting(true);
    setMessage(null);
    try {
      const r = await fetch(`${API}/api/vendor/bond/request-refund`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ username })
      });
      const data = await r.json();
      if (data.success) {
        setMessage({ type: 'success', text: '✅ Refund requested. Admin will review within 24h.' });
        fetchAll();
      } else {
        setMessage({ type: 'error', text: data.error || data.detail || 'Request failed' });
      }
    } catch (e) {
      setMessage({ type: 'error', text: 'Network error' });
    } finally {
      setRequesting(false);
    }
  };

  const selectedCfg = config[selectedCategory];

  if (loading) return (
    <div style={{ padding: '20px', color: '#9ca3af', textAlign: 'center' }}>
      Loading bond info...
    </div>
  );

  const statusInfo = bond ? (STATUS_INFO[bond.status] || STATUS_INFO.active) : null;

  return (
    <div style={{ fontFamily: 'monospace', maxWidth: '600px' }}>
      <h3 style={{ color: '#e2e8f0', marginBottom: '16px', fontSize: '16px' }}>
        🔒 Vendor Bond
      </h3>

      {/* Current Bond Status */}
      {bond && (
        <div style={{
          background: statusInfo.bg,
          border: `1px solid ${statusInfo.color}44`,
          borderRadius: '12px', padding: '16px', marginBottom: '16px'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <div style={{ color: statusInfo.color, fontWeight: '700', fontSize: '14px' }}>
              {statusInfo.icon} {statusInfo.label}
            </div>
            <div style={{ color: '#a78bfa', fontSize: '18px', fontWeight: '700' }}>
              {bond.amount_xmr} XMR
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '12px' }}>
            <div>
              <span style={{ color: '#6b7280' }}>Category: </span>
              <span style={{ color: '#e2e8f0' }}>{bond.category}</span>
            </div>
            <div>
              <span style={{ color: '#6b7280' }}>Paid: </span>
              <span style={{ color: '#e2e8f0' }}>{bond.paid_at?.slice(0, 10)}</span>
            </div>
            <div>
              <span style={{ color: '#6b7280' }}>Disputes lost: </span>
              <span style={{ color: bond.disputes_lost > 0 ? '#ef4444' : '#22c55e' }}>
                {bond.disputes_lost || 0}
              </span>
            </div>
            <div>
              <span style={{ color: '#6b7280' }}>Disputes won: </span>
              <span style={{ color: '#22c55e' }}>{bond.disputes_won || 0}</span>
            </div>
          </div>

          {/* Refund eligibility */}
          {bond.status === 'active' && (
            <div style={{
              marginTop: '12px', padding: '10px',
              background: '#0f0f1a', borderRadius: '8px'
            }}>
              {bond.refund_eligible ? (
                <div>
                  <div style={{ color: '#22c55e', fontSize: '12px', marginBottom: '8px' }}>
                    ✅ Eligible for refund!
                  </div>
                  <button
                    onClick={requestRefund}
                    disabled={requesting}
                    style={{
                      background: requesting ? '#374151' : '#16a34a',
                      color: 'white', border: 'none', borderRadius: '6px',
                      padding: '8px 16px', cursor: 'pointer', fontSize: '12px', fontWeight: '600'
                    }}
                  >
                    {requesting ? '⏳ Requesting...' : '↩️ Request Refund'}
                  </button>
                </div>
              ) : (
                <div style={{ color: '#9ca3af', fontSize: '12px' }}>
                  ⏳ Refund eligible in <strong style={{ color: '#f59e0b' }}>{bond.days_remaining} days</strong>
                  {bond.disputes_lost > 0 && (
                    <span style={{ color: '#ef4444' }}> (+{bond.disputes_lost * 30}d penalty)</span>
                  )}
                  {bond.eligible_date && (
                    <div style={{ color: '#6b7280', marginTop: '4px' }}>
                      Eligible date: {bond.eligible_date?.slice(0, 10)}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {bond.status === 'refund_pending' && (
            <div style={{ marginTop: '10px', color: '#f59e0b', fontSize: '12px' }}>
              ⏳ Refund request submitted — awaiting admin approval
            </div>
          )}

          {bond.status === 'seized' && (
            <div style={{ marginTop: '10px', color: '#ef4444', fontSize: '12px' }}>
              🚫 Bond seized: {bond.seized_reason}
            </div>
          )}

          {/* History toggle */}
          <button
            onClick={() => setShowHistory(!showHistory)}
            style={{
              marginTop: '12px', background: 'transparent', color: '#6b7280',
              border: '1px solid #374151', borderRadius: '6px',
              padding: '6px 12px', cursor: 'pointer', fontSize: '11px'
            }}
          >
            {showHistory ? '▲ Hide History' : '▼ Show History'}
          </button>

          {showHistory && history.length > 0 && (
            <div style={{ marginTop: '10px' }}>
              {history.map((evt, i) => (
                <div key={i} style={{
                  display: 'flex', gap: '8px', padding: '6px 0',
                  borderBottom: '1px solid #1a1a2e', fontSize: '11px'
                }}>
                  <span style={{ color: '#6b7280', minWidth: '80px' }}>
                    {evt.timestamp?.slice(0, 10)}
                  </span>
                  <span style={{
                    color: evt.type === 'paid' ? '#22c55e' :
                           evt.type === 'seized' ? '#ef4444' :
                           evt.type === 'refunded' ? '#8b5cf6' : '#f59e0b',
                    minWidth: '120px', fontWeight: '600'
                  }}>
                    {evt.type?.toUpperCase()}
                  </span>
                  <span style={{ color: '#9ca3af' }}>{evt.note || evt.reason || ''}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Pay Bond Form (if no active bond) */}
      {(!bond || bond.status === 'refunded' || bond.status === 'seized') && (
        <div style={{
          background: '#1a1a2e', border: '1px solid #2d2d44',
          borderRadius: '12px', padding: '16px', marginBottom: '16px'
        }}>
          <div style={{ color: '#e2e8f0', fontSize: '14px', fontWeight: '600', marginBottom: '12px' }}>
            💳 Pay Vendor Bond
          </div>
          <div style={{ color: '#9ca3af', fontSize: '12px', marginBottom: '12px' }}>
            Select your primary product category to determine bond amount:
          </div>

          <select
            value={selectedCategory}
            onChange={e => setSelectedCategory(e.target.value)}
            style={{
              width: '100%', background: '#0f0f1a', border: '1px solid #374151',
              borderRadius: '6px', padding: '10px', color: '#e2e8f0',
              fontSize: '13px', marginBottom: '12px', boxSizing: 'border-box'
            }}
          >
            <option value="">-- Select Category --</option>
            {Object.entries(config).filter(([k]) => k !== 'default').map(([cat, cfg]) => (
              <option key={cat} value={cat}>
                {cat} — {cfg.xmr} XMR ({cfg.risk} risk)
              </option>
            ))}
          </select>

          {selectedCfg && (
            <div style={{
              background: '#0f0f1a', borderRadius: '8px', padding: '12px', marginBottom: '12px'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                <span style={{ color: '#6b7280', fontSize: '12px' }}>Bond Amount:</span>
                <span style={{ color: '#a78bfa', fontWeight: '700' }}>{selectedCfg.xmr} XMR</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                <span style={{ color: '#6b7280', fontSize: '12px' }}>Risk Level:</span>
                <span style={{ color: RISK_COLORS[selectedCfg.risk], fontSize: '12px' }}>
                  {RISK_LABELS[selectedCfg.risk]}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#6b7280', fontSize: '12px' }}>Refundable after:</span>
                <span style={{ color: '#22c55e', fontSize: '12px' }}>90 days</span>
              </div>
            </div>
          )}

          <button
            onClick={payBond}
            disabled={paying || !selectedCategory}
            style={{
              width: '100%',
              background: paying || !selectedCategory
                ? '#374151'
                : 'linear-gradient(135deg, #7c3aed, #4f46e5)',
              color: 'white', border: 'none', borderRadius: '8px',
              padding: '12px', cursor: paying || !selectedCategory ? 'not-allowed' : 'pointer',
              fontSize: '14px', fontWeight: '600'
            }}
          >
            {paying ? '⏳ Processing...' : `🔒 Pay Bond${selectedCfg ? ` (${selectedCfg.xmr} XMR)` : ''}`}
          </button>
        </div>
      )}

      {/* Message */}
      {message && (
        <div style={{
          background: message.type === 'success' ? '#16a34a22' : '#ef444422',
          border: `1px solid ${message.type === 'success' ? '#16a34a' : '#ef4444'}44`,
          borderRadius: '8px', padding: '10px 14px',
          color: message.type === 'success' ? '#22c55e' : '#ef4444',
          fontSize: '13px', marginBottom: '12px'
        }}>
          {message.text}
        </div>
      )}

      {/* Info */}
      <div style={{
        background: '#1a1a2e', borderRadius: '8px', padding: '12px',
        border: '1px solid #2d2d44', fontSize: '11px', color: '#6b7280', lineHeight: '1.6'
      }}>
        <strong style={{ color: '#9ca3af' }}>Bond Rules:</strong><br />
        • Bond is refundable after 90 days with no violations<br />
        • Each lost dispute adds 30 days to refund delay<br />
        • Bond is seized for rule violations (scam, fraud, etc.)<br />
        • Bond amount varies by category risk level<br />
        • Refund requires manual admin approval
      </div>
    </div>
  );
}

// ============================================================
// PUBLIC BOND BADGE (pour le profil vendor public)
// ============================================================
export function VendorBondBadge({ username }) {
  const [info, setInfo] = useState(null);

  useEffect(() => {
    fetch(`${API}/api/vendor/bond/public/${username}`, { headers: { ...getAuthHeaders() } })
      .then(r => r.ok ? r.json() : null)
      .then(data => setInfo(data))
      .catch(() => {});
  }, [username]);

  if (!info || !info.has_bond) return null;

  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: '6px',
      background: info.status_color + '22',
      border: `1px solid ${info.status_color}44`,
      borderRadius: '20px', padding: '4px 10px',
      fontSize: '11px', color: info.status_color, fontWeight: '600'
    }}>
      <span>{info.status_icon}</span>
      <span>{info.status_label}</span>
      <span style={{ color: '#9ca3af' }}>({info.amount_xmr} XMR)</span>
      {info.verified && <span style={{ color: '#22c55e' }}>✓</span>}
    </div>
  );
}

// ============================================================
// ADMIN BOND PANEL
// ============================================================
export function AdminBondPanel({ username }) {
  const [stats, setStats] = useState(null);
  const [pending, setPending] = useState([]);
  const [allBonds, setAllBonds] = useState([]);
  const [history, setHistory] = useState([]);
  const [config, setConfig] = useState({});
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('overview');
  const [processing, setProcessing] = useState(null);
  const [seizeReason, setSeizeReason] = useState('');
  const [seizeTarget, setSeizeTarget] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [editConfig, setEditConfig] = useState({ category: '', xmr: '', risk: 'medium' });
  const [message, setMessage] = useState(null);

  useEffect(() => {
    fetchAll();
  }, []);

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [statsR, pendingR, bondsR, histR, cfgR] = await Promise.all([
        fetch(`${API}/api/admin/bonds/stats?username=${username}`, { headers: { ...getAuthHeaders() } }),
        fetch(`${API}/api/admin/bonds/pending-refunds?username=${username}`, { headers: { ...getAuthHeaders() } }),
        fetch(`${API}/api/admin/bonds?username=${username}`, { headers: { ...getAuthHeaders() } }),
        fetch(`${API}/api/admin/bonds/history?username=${username}&limit=50`, { headers: { ...getAuthHeaders() } }),
        fetch(`${API}/api/bonds/config`, { headers: { ...getAuthHeaders() } })
      ]);
      if (statsR.ok) setStats(await statsR.json());
      if (pendingR.ok) setPending(await pendingR.json());
      if (bondsR.ok) setAllBonds(await bondsR.json());
      if (histR.ok) setHistory(await histR.json());
      if (cfgR.ok) { const d = await cfgR.json(); setConfig(d.config || {}); }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const approveRefund = async (vendor) => {
    setProcessing(vendor);
    try {
      const r = await fetch(`${API}/api/admin/bonds/approve-refund`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ admin: username, vendor })
      });
      const data = await r.json();
      setMessage({ type: data.success ? 'success' : 'error', text: data.success ? `✅ Refund approved for ${vendor}` : data.error });
      fetchAll();
    } catch (e) { setMessage({ type: 'error', text: 'Error' }); }
    finally { setProcessing(null); }
  };

  const rejectRefund = async (vendor) => {
    setProcessing(vendor);
    try {
      const r = await fetch(`${API}/api/admin/bonds/reject-refund`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ admin: username, vendor, reason: rejectReason })
      });
      const data = await r.json();
      setMessage({ type: data.success ? 'success' : 'error', text: data.success ? `Refund rejected for ${vendor}` : data.error });
      setRejectReason('');
      fetchAll();
    } catch (e) { setMessage({ type: 'error', text: 'Error' }); }
    finally { setProcessing(null); }
  };

  const seizeBond = async (vendor) => {
    if (!seizeReason.trim()) return;
    setProcessing(vendor);
    try {
      const r = await fetch(`${API}/api/admin/bonds/seize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ admin: username, vendor, reason: seizeReason })
      });
      const data = await r.json();
      setMessage({ type: data.success ? 'success' : 'error', text: data.success ? `🚫 Bond seized from ${vendor}: ${data.seized_amount_xmr} XMR` : data.error });
      setSeizeReason('');
      setSeizeTarget('');
      fetchAll();
    } catch (e) { setMessage({ type: 'error', text: 'Error' }); }
    finally { setProcessing(null); }
  };

  const updateConfig = async () => {
    if (!editConfig.category || !editConfig.xmr) return;
    try {
      const r = await fetch(`${API}/api/admin/bonds/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({
          username,
          category: editConfig.category,
          xmr: parseFloat(editConfig.xmr),
          risk: editConfig.risk
        })
      });
      const data = await r.json();
      if (data.status === 'success') {
        setMessage({ type: 'success', text: `✅ Config updated for ${editConfig.category}` });
        fetchAll();
      }
    } catch (e) { setMessage({ type: 'error', text: 'Error' }); }
  };

  if (loading) return <div style={{ color: '#9ca3af', padding: '20px' }}>Loading bond admin...</div>;

  const tabs = [
    { id: 'overview', label: '📊 Overview' },
    { id: 'pending', label: `⏳ Pending (${pending.length})` },
    { id: 'all', label: `📋 All Bonds (${allBonds.length})` },
    { id: 'config', label: '⚙️ Config' },
    { id: 'history', label: '📜 History' },
  ];

  return (
    <div style={{ fontFamily: 'monospace' }}>
      <h3 style={{ color: '#e2e8f0', marginBottom: '16px' }}>🔒 Bond Admin Panel</h3>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '4px', marginBottom: '16px', flexWrap: 'wrap' }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            background: tab === t.id ? '#7c3aed' : '#1a1a2e',
            color: tab === t.id ? 'white' : '#9ca3af',
            border: `1px solid ${tab === t.id ? '#7c3aed' : '#374151'}`,
            borderRadius: '6px', padding: '6px 12px', cursor: 'pointer', fontSize: '12px'
          }}>{t.label}</button>
        ))}
      </div>

      {message && (
        <div style={{
          background: message.type === 'success' ? '#16a34a22' : '#ef444422',
          border: `1px solid ${message.type === 'success' ? '#16a34a' : '#ef4444'}44`,
          borderRadius: '8px', padding: '10px', marginBottom: '12px',
          color: message.type === 'success' ? '#22c55e' : '#ef4444', fontSize: '13px'
        }}>{message.text}</div>
      )}

      {/* OVERVIEW */}
      {tab === 'overview' && stats && (
        <div>
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '16px' }}>
            {[
              { label: 'Total', value: stats.total, color: '#9ca3af' },
              { label: 'Active', value: stats.active, color: '#22c55e' },
              { label: 'Pending Refund', value: stats.refund_pending, color: '#f59e0b' },
              { label: 'Refunded', value: stats.refunded, color: '#8b5cf6' },
              { label: 'Seized', value: stats.seized, color: '#ef4444' },
              { label: 'XMR Locked', value: `${stats.total_xmr_locked} XMR`, color: '#a78bfa' },
              { label: 'XMR Seized', value: `${stats.total_xmr_seized} XMR`, color: '#ef4444' },
              { label: 'XMR Refunded', value: `${stats.total_xmr_refunded} XMR`, color: '#8b5cf6' },
            ].map(item => (
              <div key={item.label} style={{
                background: '#1a1a2e', border: '1px solid #2d2d44',
                borderRadius: '8px', padding: '12px 16px', textAlign: 'center', minWidth: '100px'
              }}>
                <div style={{ color: item.color, fontSize: '18px', fontWeight: '700' }}>{item.value}</div>
                <div style={{ color: '#6b7280', fontSize: '10px' }}>{item.label}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* PENDING REFUNDS */}
      {tab === 'pending' && (
        <div>
          {pending.length === 0 ? (
            <div style={{ color: '#6b7280', padding: '20px', textAlign: 'center' }}>
              No pending refund requests
            </div>
          ) : pending.map(bond => (
            <div key={bond.vendor} style={{
              background: '#f59e0b11', border: '1px solid #f59e0b33',
              borderRadius: '8px', padding: '14px', marginBottom: '10px'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ color: '#e2e8f0', fontWeight: '600', fontSize: '13px' }}>
                    {bond.vendor}
                  </div>
                  <div style={{ color: '#9ca3af', fontSize: '12px', marginTop: '4px' }}>
                    {bond.category} — {bond.amount_xmr} XMR
                  </div>
                  <div style={{ color: '#6b7280', fontSize: '11px' }}>
                    Requested: {bond.refund_requested_at?.slice(0, 10)}
                    {bond.disputes_lost > 0 && (
                      <span style={{ color: '#ef4444' }}> | {bond.disputes_lost} disputes lost</span>
                    )}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '6px', flexDirection: 'column' }}>
                  <button
                    onClick={() => approveRefund(bond.vendor)}
                    disabled={processing === bond.vendor}
                    style={{
                      background: '#16a34a', color: 'white', border: 'none',
                      borderRadius: '6px', padding: '6px 12px', cursor: 'pointer', fontSize: '12px'
                    }}
                  >
                    ✅ Approve
                  </button>
                  <div style={{ display: 'flex', gap: '4px' }}>
                    <input
                      placeholder="Reason..."
                      value={rejectReason}
                      onChange={e => setRejectReason(e.target.value)}
                      style={{
                        background: '#0f0f1a', border: '1px solid #374151',
                        borderRadius: '4px', padding: '4px 8px', color: '#e2e8f0',
                        fontSize: '11px', width: '100px'
                      }}
                    />
                    <button
                      onClick={() => rejectRefund(bond.vendor)}
                      disabled={processing === bond.vendor}
                      style={{
                        background: '#ef4444', color: 'white', border: 'none',
                        borderRadius: '6px', padding: '6px 10px', cursor: 'pointer', fontSize: '12px'
                      }}
                    >
                      ✗
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ALL BONDS */}
      {tab === 'all' && (
        <div>
          {/* Seize form */}
          <div style={{
            background: '#ef444411', border: '1px solid #ef444433',
            borderRadius: '8px', padding: '12px', marginBottom: '14px'
          }}>
            <div style={{ color: '#ef4444', fontSize: '12px', fontWeight: '600', marginBottom: '8px' }}>
              🚫 Seize Bond
            </div>
            <div style={{ display: 'flex', gap: '6px' }}>
              <input
                placeholder="Vendor username"
                value={seizeTarget}
                onChange={e => setSeizeTarget(e.target.value)}
                style={{
                  background: '#0f0f1a', border: '1px solid #374151',
                  borderRadius: '6px', padding: '8px', color: '#e2e8f0',
                  fontSize: '12px', flex: '1'
                }}
              />
              <input
                placeholder="Reason for seizure"
                value={seizeReason}
                onChange={e => setSeizeReason(e.target.value)}
                style={{
                  background: '#0f0f1a', border: '1px solid #374151',
                  borderRadius: '6px', padding: '8px', color: '#e2e8f0',
                  fontSize: '12px', flex: '2'
                }}
              />
              <button
                onClick={() => seizeBond(seizeTarget)}
                disabled={!seizeTarget || !seizeReason}
                style={{
                  background: '#ef4444', color: 'white', border: 'none',
                  borderRadius: '6px', padding: '8px 14px', cursor: 'pointer', fontSize: '12px'
                }}
              >
                Seize
              </button>
            </div>
          </div>

          {allBonds.map(bond => {
            const si = STATUS_INFO[bond.status] || STATUS_INFO.active;
            return (
              <div key={bond.vendor} style={{
                background: '#1a1a2e', border: `1px solid ${si.color}33`,
                borderRadius: '8px', padding: '10px 14px', marginBottom: '6px',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center'
              }}>
                <div>
                  <div style={{ color: '#e2e8f0', fontSize: '12px', fontWeight: '600' }}>
                    {bond.vendor}
                  </div>
                  <div style={{ color: '#9ca3af', fontSize: '11px' }}>
                    {bond.category} | {bond.amount_xmr} XMR | Paid: {bond.paid_at?.slice(0, 10)}
                  </div>
                </div>
                <span style={{ color: si.color, fontSize: '11px', fontWeight: '600' }}>
                  {si.icon} {si.label}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* CONFIG */}
      {tab === 'config' && (
        <div>
          <div style={{
            background: '#1a1a2e', border: '1px solid #2d2d44',
            borderRadius: '8px', padding: '14px', marginBottom: '14px'
          }}>
            <div style={{ color: '#e2e8f0', fontSize: '13px', fontWeight: '600', marginBottom: '10px' }}>
              ⚙️ Update Bond Amount
            </div>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <select
                value={editConfig.category}
                onChange={e => setEditConfig({ ...editConfig, category: e.target.value })}
                style={{
                  background: '#0f0f1a', border: '1px solid #374151',
                  borderRadius: '6px', padding: '8px', color: '#e2e8f0',
                  fontSize: '12px', flex: '2'
                }}
              >
                <option value="">-- Select Category --</option>
                {Object.keys(config).map(cat => (
                  <option key={cat} value={cat}>{cat} (current: {config[cat]?.xmr} XMR)</option>
                ))}
              </select>
              <input
                type="number"
                placeholder="XMR amount"
                value={editConfig.xmr}
                onChange={e => setEditConfig({ ...editConfig, xmr: e.target.value })}
                style={{
                  background: '#0f0f1a', border: '1px solid #374151',
                  borderRadius: '6px', padding: '8px', color: '#e2e8f0',
                  fontSize: '12px', width: '100px'
                }}
              />
              <select
                value={editConfig.risk}
                onChange={e => setEditConfig({ ...editConfig, risk: e.target.value })}
                style={{
                  background: '#0f0f1a', border: '1px solid #374151',
                  borderRadius: '6px', padding: '8px', color: '#e2e8f0',
                  fontSize: '12px'
                }}
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
              <button
                onClick={updateConfig}
                style={{
                  background: '#7c3aed', color: 'white', border: 'none',
                  borderRadius: '6px', padding: '8px 14px', cursor: 'pointer', fontSize: '12px'
                }}
              >
                Update
              </button>
            </div>
          </div>

          {/* Config table */}
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #2d2d44' }}>
                  {['Category', 'XMR', 'Risk', 'Color'].map(h => (
                    <th key={h} style={{ color: '#6b7280', padding: '8px', textAlign: 'left' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Object.entries(config).map(([cat, cfg]) => (
                  <tr key={cat} style={{ borderBottom: '1px solid #1a1a2e' }}>
                    <td style={{ color: '#e2e8f0', padding: '6px 8px' }}>{cat}</td>
                    <td style={{ color: '#a78bfa', padding: '6px 8px', fontWeight: '600' }}>{cfg.xmr}</td>
                    <td style={{ padding: '6px 8px' }}>
                      <span style={{ color: RISK_COLORS[cfg.risk] }}>{RISK_LABELS[cfg.risk]}</span>
                    </td>
                    <td style={{ padding: '6px 8px' }}>
                      <span style={{
                        background: cfg.color, borderRadius: '4px',
                        padding: '2px 8px', fontSize: '10px', color: 'white'
                      }}>{cfg.color}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* HISTORY */}
      {tab === 'history' && (
        <div>
          {history.length === 0 ? (
            <div style={{ color: '#6b7280', padding: '20px', textAlign: 'center' }}>No history yet</div>
          ) : history.map(evt => (
            <div key={evt.id} style={{
              display: 'flex', gap: '10px', padding: '8px 0',
              borderBottom: '1px solid #1a1a2e', fontSize: '12px'
            }}>
              <span style={{ color: '#6b7280', minWidth: '90px' }}>{evt.timestamp?.slice(0, 10)}</span>
              <span style={{ color: '#9ca3af', minWidth: '80px' }}>{evt.vendor}</span>
              <span style={{
                color: evt.type === 'paid' ? '#22c55e' :
                       evt.type === 'seized' ? '#ef4444' :
                       evt.type === 'refunded' ? '#8b5cf6' :
                       evt.type === 'config_changed' ? '#3b82f6' : '#f59e0b',
                minWidth: '120px', fontWeight: '600'
              }}>
                {evt.type?.toUpperCase()}
              </span>
              <span style={{ color: '#6b7280' }}>
                {evt.amount_xmr ? `${evt.amount_xmr} XMR` : ''}
                {evt.category ? ` | ${evt.category}` : ''}
                {evt.reason ? ` | ${evt.reason}` : ''}
                {evt.new_xmr ? ` | ${evt.old_xmr} → ${evt.new_xmr} XMR` : ''}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

