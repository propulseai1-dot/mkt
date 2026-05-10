/**
 * SILKGENESIS - Vendor Dashboard
 * Tiered commission display + Withdraw Funds panel
 * Amber/dark cyberpunk aesthetic — no style changes
 */
import React, { useState, useEffect, useCallback } from 'react';
import { silkApiUrl } from './silkApi';

// ============================================================
// COMMISSION TIER BADGE
// ============================================================
function CommissionBadge({ level }) {
  if (!level) return null;
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: '4px',
      padding: '3px 10px',
      borderRadius: '6px',
      border: `1px solid ${level.color}44`,
      background: `${level.color}18`,
      color: level.color,
      fontSize: '11px',
      fontWeight: '800',
      fontFamily: 'monospace',
      letterSpacing: '0.05em'
    }}>
      {level.icon} {level.name} — {level.commission_pct}% fee
    </span>
  );
}

// ============================================================
// LEVEL PROGRESS BAR
// ============================================================
function LevelProgressBar({ current, next, progress_pct, total_sales }) {
  if (!current) return null;
  return (
    <div style={{ width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', fontSize: '11px' }}>
        <span style={{ color: current.color, fontWeight: '700' }}>
          {current.icon} {current.name} ({current.commission_pct}% fee)
        </span>
        {next ? (
          <span style={{ color: '#6b7280' }}>
            Next: <span style={{ color: next.color }}>{next.icon} {next.name}</span> ({next.commission_pct}% fee) — {next.sales_needed} sales needed
          </span>
        ) : (
          <span style={{ color: '#f97316', fontWeight: '700' }}>👑 MAX LEVEL</span>
        )}
      </div>
      <div style={{ height: '8px', background: '#1f2937', borderRadius: '4px', overflow: 'hidden' }}>
        <div style={{
          height: '100%',
          width: `${progress_pct}%`,
          background: next
            ? `linear-gradient(90deg, ${current.color}, ${next.color})`
            : `linear-gradient(90deg, ${current.color}, #f97316)`,
          borderRadius: '4px',
          transition: 'width 0.6s ease'
        }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '4px', fontSize: '10px', color: '#4b5563' }}>
        <span>{total_sales} sales</span>
        {next && <span>{next.min_sales} sales</span>}
      </div>
    </div>
  );
}

// ============================================================
// ALL LEVELS TABLE
// ============================================================
function AllLevelsTable({ levels, currentLevel }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '8px' }}>
      {levels.map(lvl => {
        const isCurrent = lvl.number === currentLevel?.number;
        const isUnlocked = lvl.unlocked;
        return (
          <div key={lvl.number} style={{
            padding: '12px 8px',
            borderRadius: '10px',
            border: `1px solid ${isCurrent ? lvl.color : isUnlocked ? lvl.color + '44' : '#1f2937'}`,
            background: isCurrent ? `${lvl.color}18` : isUnlocked ? `${lvl.color}08` : '#0f172a',
            textAlign: 'center',
            opacity: isUnlocked ? 1 : 0.4,
            transition: 'all 0.2s'
          }}>
            <div style={{ fontSize: '22px', marginBottom: '4px' }}>{lvl.icon}</div>
            <div style={{ color: lvl.color, fontSize: '10px', fontWeight: '800', marginBottom: '2px' }}>{lvl.name}</div>
            <div style={{ color: '#9ca3af', fontSize: '10px' }}>{lvl.commission_pct}% fee</div>
            <div style={{ color: '#4b5563', fontSize: '9px', marginTop: '2px' }}>{lvl.min_sales}+ sales</div>
            {isCurrent && (
              <div style={{ marginTop: '4px', fontSize: '9px', color: lvl.color, fontWeight: '700' }}>◀ CURRENT</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ============================================================
// WITHDRAW PANEL
// ============================================================
function WithdrawPanel({ username, internalBalance, onWithdrawSuccess, authenticatedFetch }) {
  const [address, setAddress] = useState('');
  const [amount, setAmount] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [showConfirm, setShowConfirm] = useState(false);

  const NETWORK_FEE = 0.0001;
  const MIN_WD = 0.001;

  const amountNum = parseFloat(amount) || 0;
  const totalNeeded = amountNum + NETWORK_FEE;
  const canWithdraw = amountNum >= MIN_WD && address.length > 90 && internalBalance >= totalNeeded;

  const handleWithdraw = async () => {
    setLoading(true);
    setError('');
    setResult(null);
    try {
      const doFetch = authenticatedFetch || (async (url, opts) => fetch(silkApiUrl(url), opts));
      const resp = await doFetch('/api/v1/vendor/withdraw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, address, amount: amountNum })
      });
      const data = await resp.json();
      if (resp.ok && data.status === 'success') {
        setResult(data);
        setShowConfirm(false);
        setAmount('');
        setAddress('');
        if (onWithdrawSuccess) onWithdrawSuccess(data.new_internal_balance);
      } else {
        setError(data.detail || 'Withdrawal failed');
        setShowConfirm(false);
      }
    } catch (e) {
      setError('Connection error. Please try again.');
      setShowConfirm(false);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      background: '#0a0a0a',
      border: '1px solid #374151',
      borderRadius: '16px',
      padding: '24px'
    }}>
      <h3 style={{ color: '#f59e0b', margin: '0 0 16px', fontSize: '14px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.1em', display: 'flex', alignItems: 'center', gap: '8px' }}>
        💸 Withdraw Funds
      </h3>

      {/* Available Balance */}
      <div style={{
        background: '#111827',
        border: '1px solid #1f2937',
        borderRadius: '10px',
        padding: '16px',
        marginBottom: '16px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
        <div>
          <p style={{ color: '#6b7280', margin: '0 0 4px', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Available to Withdraw</p>
          <p style={{ color: '#f59e0b', margin: 0, fontSize: '24px', fontWeight: '800', fontFamily: 'monospace' }}>
            {(internalBalance || 0).toFixed(6)} XMR
          </p>
        </div>
        <button
          onClick={() => setAmount(Math.max(0, internalBalance - NETWORK_FEE).toFixed(6))}
          style={{
            background: '#1f2937',
            color: '#9ca3af',
            border: '1px solid #374151',
            borderRadius: '8px',
            padding: '8px 14px',
            cursor: 'pointer',
            fontSize: '11px',
            fontWeight: '700'
          }}
        >
          MAX
        </button>
      </div>

      {/* Success result */}
      {result && (
        <div style={{
          background: 'rgba(34,197,94,0.1)',
          border: '1px solid #22c55e',
          borderRadius: '10px',
          padding: '14px',
          marginBottom: '16px'
        }}>
          <p style={{ color: '#22c55e', margin: '0 0 6px', fontWeight: '700', fontSize: '14px' }}>✅ Withdrawal Initiated!</p>
          <p style={{ color: '#9ca3af', margin: '0 0 4px', fontSize: '12px' }}>Amount: {result.amount_xmr} XMR</p>
          <p style={{ color: '#9ca3af', margin: '0 0 4px', fontSize: '12px' }}>Network fee: {result.network_fee_xmr} XMR</p>
          {result.tx_hash && result.tx_hash !== 'SIMULATED_OFFLINE' && (
            <p style={{ color: '#6b7280', margin: 0, fontSize: '11px', fontFamily: 'monospace' }}>
              TX: {result.tx_hash.slice(0, 20)}...
            </p>
          )}
          {result.rpc_mode === 'offline' && (
            <p style={{ color: '#f59e0b', margin: '4px 0 0', fontSize: '11px' }}>
              ⚠️ Offline mode — transaction queued
            </p>
          )}
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={{
          background: 'rgba(239,68,68,0.1)',
          border: '1px solid #ef4444',
          borderRadius: '8px',
          padding: '10px 14px',
          marginBottom: '12px',
          fontSize: '12px',
          color: '#ef4444'
        }}>
          ❌ {error}
        </div>
      )}

      {/* Destination address */}
      <div style={{ marginBottom: '12px' }}>
        <label style={{ color: '#6b7280', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.1em', display: 'block', marginBottom: '6px' }}>
          Destination XMR Address
        </label>
        <input
          type="text"
          value={address}
          onChange={e => setAddress(e.target.value)}
          placeholder="4... or 8... (95 characters)"
          style={{
            width: '100%',
            background: '#111827',
            border: `1px solid ${address.length > 90 ? '#22c55e' : '#374151'}`,
            borderRadius: '8px',
            padding: '12px',
            color: '#e2e8f0',
            fontSize: '12px',
            fontFamily: 'monospace',
            outline: 'none',
            boxSizing: 'border-box'
          }}
        />
        {address.length > 0 && address.length < 90 && (
          <p style={{ color: '#ef4444', fontSize: '10px', margin: '4px 0 0' }}>
            Invalid address ({address.length} chars, need 95)
          </p>
        )}
      </div>

      {/* Amount */}
      <div style={{ marginBottom: '16px' }}>
        <label style={{ color: '#6b7280', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.1em', display: 'block', marginBottom: '6px' }}>
          Amount (XMR)
        </label>
        <input
          type="number"
          step="0.000001"
          min="0.001"
          value={amount}
          onChange={e => setAmount(e.target.value)}
          placeholder="0.000000"
          style={{
            width: '100%',
            background: '#111827',
            border: '1px solid #374151',
            borderRadius: '8px',
            padding: '12px',
            color: '#f59e0b',
            fontSize: '18px',
            fontWeight: '800',
            fontFamily: 'monospace',
            outline: 'none',
            textAlign: 'center',
            boxSizing: 'border-box'
          }}
        />
        {amountNum > 0 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '6px', fontSize: '11px', color: '#6b7280' }}>
            <span>Network fee: {NETWORK_FEE} XMR</span>
            <span>Total deducted: {totalNeeded.toFixed(6)} XMR</span>
          </div>
        )}
      </div>

      {/* Confirm dialog */}
      {showConfirm && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.85)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999,
          padding: '20px'
        }}>
          <div style={{
            background: '#111827',
            border: '1px solid #374151',
            borderRadius: '16px',
            padding: '32px',
            maxWidth: '420px',
            width: '100%'
          }}>
            <h3 style={{ color: '#f59e0b', margin: '0 0 16px', fontSize: '18px' }}>
              ⚠️ Confirm Withdrawal
            </h3>
            <div style={{ background: '#0f172a', borderRadius: '8px', padding: '14px', marginBottom: '20px', fontSize: '13px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                <span style={{ color: '#9ca3af' }}>Amount:</span>
                <span style={{ color: '#f59e0b', fontWeight: '700' }}>{amountNum.toFixed(6)} XMR</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                <span style={{ color: '#9ca3af' }}>Network fee:</span>
                <span style={{ color: '#ef4444' }}>-{NETWORK_FEE} XMR</span>
              </div>
              <div style={{ borderTop: '1px solid #1f2937', paddingTop: '6px', marginTop: '6px', display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#9ca3af' }}>Destination:</span>
                <span style={{ color: '#e2e8f0', fontSize: '11px', fontFamily: 'monospace' }}>{address.slice(0, 12)}...{address.slice(-8)}</span>
              </div>
            </div>
            <p style={{ color: '#ef4444', fontSize: '12px', marginBottom: '20px' }}>
              ⚠️ This action is <strong>irreversible</strong>. Verify the address carefully.
            </p>
            <div style={{ display: 'flex', gap: '12px' }}>
              <button onClick={() => setShowConfirm(false)} style={{
                flex: 1, background: '#374151', color: 'white', border: 'none',
                borderRadius: '8px', padding: '12px', cursor: 'pointer', fontSize: '14px', fontWeight: '600'
              }}>Cancel</button>
              <button onClick={handleWithdraw} disabled={loading} style={{
                flex: 1, background: loading ? '#374151' : '#f59e0b', color: '#000', border: 'none',
                borderRadius: '8px', padding: '12px', cursor: loading ? 'not-allowed' : 'pointer',
                fontSize: '14px', fontWeight: '800'
              }}>
                {loading ? '⏳ Processing...' : '✅ Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Withdraw button */}
      <button
        onClick={() => setShowConfirm(true)}
        disabled={!canWithdraw || loading}
        style={{
          width: '100%',
          background: canWithdraw ? 'linear-gradient(135deg, #f59e0b, #d97706)' : '#1f2937',
          color: canWithdraw ? '#000' : '#4b5563',
          border: 'none',
          borderRadius: '10px',
          padding: '14px',
          cursor: canWithdraw ? 'pointer' : 'not-allowed',
          fontSize: '14px',
          fontWeight: '800',
          textTransform: 'uppercase',
          letterSpacing: '0.1em',
          transition: 'all 0.2s'
        }}
      >
        {loading ? '⏳ Processing...' : '💸 Withdraw XMR'}
      </button>

      <p style={{ color: '#374151', fontSize: '10px', textAlign: 'center', marginTop: '8px' }}>
        Min: {MIN_WD} XMR · Network fee: {NETWORK_FEE} XMR · Cooldown: 5 min
      </p>
    </div>
  );
}

// ============================================================
// MAIN VENDOR DASHBOARD COMPONENT
// ============================================================
export default function VendorDashboard({ username, authenticatedFetch }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [internalBalance, setInternalBalance] = useState(0);

  const loadDashboard = useCallback(async () => {
    if (!username) return;
    try {
      const doFetch = authenticatedFetch || (async (url) => fetch(silkApiUrl(url)));
      const resp = await doFetch(`/api/vendor/${encodeURIComponent(username)}/dashboard`);
      if (resp.ok) {
        const d = await resp.json();
        setData(d);
        setInternalBalance(d.internal_balance || 0);
      } else {
        setData(null);
      }
    } catch (e) {
      console.error('Dashboard load error:', e);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [username, authenticatedFetch]);

  useEffect(() => {
    if (username) loadDashboard();
  }, [username, loadDashboard]);

  if (loading) {
    return (
      <div style={{ padding: '40px', textAlign: 'center' }}>
        <div style={{ width: '32px', height: '32px', border: '2px solid #f59e0b', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite', margin: '0 auto 12px' }} />
        <p style={{ color: '#6b7280', fontSize: '13px' }}>Loading vendor dashboard...</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div style={{ padding: '20px', textAlign: 'center', color: '#6b7280', fontSize: '13px' }}>
        Could not load vendor dashboard.
      </div>
    );
  }

  const { level, next_level, progress_to_next_pct, total_sales, total_volume_xmr, all_levels } = data;

  return (
    <div style={{ fontFamily: 'monospace', color: '#e2e8f0' }} className="space-y-6">

      {/* HEADER CARD */}
      <div style={{
        background: 'linear-gradient(135deg, rgba(245,158,11,0.08), rgba(0,0,0,0))',
        border: '1px solid rgba(245,158,11,0.2)',
        borderRadius: '20px',
        padding: '28px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
          <div>
            <h2 style={{ color: '#f59e0b', margin: '0 0 6px', fontSize: '20px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
              Vendor Dashboard
            </h2>
            <CommissionBadge level={level} />
          </div>
          <div style={{ textAlign: 'right' }}>
            <p style={{ color: '#6b7280', margin: '0 0 4px', fontSize: '11px', textTransform: 'uppercase' }}>Earnings Balance</p>
            <p style={{ color: '#22c55e', margin: 0, fontSize: '28px', fontWeight: '800' }}>
              {internalBalance.toFixed(6)} XMR
            </p>
          </div>
        </div>

        {/* STATS ROW */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginBottom: '20px' }}>
          {[
            { label: 'Total Sales', value: total_sales, color: '#f59e0b' },
            { label: 'Volume (XMR)', value: total_volume_xmr.toFixed(4), color: '#8b5cf6' },
            { label: 'Commission Rate', value: `${level.commission_pct}%`, color: level.color }
          ].map(stat => (
            <div key={stat.label} style={{
              background: '#0f172a',
              border: '1px solid #1f2937',
              borderRadius: '10px',
              padding: '14px',
              textAlign: 'center'
            }}>
              <p style={{ color: '#6b7280', margin: '0 0 4px', fontSize: '10px', textTransform: 'uppercase' }}>{stat.label}</p>
              <p style={{ color: stat.color, margin: 0, fontSize: '20px', fontWeight: '800' }}>{stat.value}</p>
            </div>
          ))}
        </div>

        {/* PROGRESS BAR */}
        <LevelProgressBar
          current={level}
          next={next_level}
          progress_pct={progress_to_next_pct}
          total_sales={total_sales}
        />
      </div>

      {/* ALL LEVELS */}
      <div style={{
        background: '#0a0a0a',
        border: '1px solid #1f2937',
        borderRadius: '16px',
        padding: '24px'
      }}>
        <h3 style={{ color: '#9ca3af', margin: '0 0 16px', fontSize: '12px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.15em' }}>
          Commission Tiers
        </h3>
        <AllLevelsTable levels={all_levels} currentLevel={level} />
      </div>

      {/* WITHDRAW PANEL */}
      <WithdrawPanel
        username={username}
        internalBalance={internalBalance}
        authenticatedFetch={authenticatedFetch}
        onWithdrawSuccess={(newBal) => {
          setInternalBalance(newBal);
          loadDashboard();
        }}
      />
    </div>
  );
}
