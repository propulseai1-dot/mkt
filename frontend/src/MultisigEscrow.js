import React, { useState, useEffect } from 'react';

const API = '';

function getAuthHeaders() {
  const token = sessionStorage.getItem('silkgenesis_session_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * SILKGENESIS - MULTISIG ESCROW 2/3
 * Composant pour gerer l'escrow multisig Monero
 * Buyer + Vendor + Marketplace (arbitre)
 */
export default function MultisigEscrow({ orderId, username, role, orderData }) {
  const [wallet, setWallet] = useState(null);
  const [loading, setLoading] = useState(true);
  const [signing, setSigning] = useState(false);
  const [disputing, setDisputing] = useState(false);
  const [disputeReason, setDisputeReason] = useState('');
  const [message, setMessage] = useState(null);
  const [showDispute, setShowDispute] = useState(false);

  useEffect(() => {
    if (orderId) fetchWallet();
  }, [orderId]);

  const fetchWallet = async () => {
    try {
      const r = await fetch(`${API}/api/multisig/${orderId}`, { headers: { ...getAuthHeaders() } });
      if (r.ok) {
        const data = await r.json();
        setWallet(data);
      }
    } catch (e) {
      console.error('Multisig fetch error:', e);
    } finally {
      setLoading(false);
    }
  };

  const createWallet = async () => {
    if (!orderData) return;
    setLoading(true);
    try {
      const r = await fetch(`${API}/api/multisig/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({
          order_id: orderId,
          buyer: orderData.buyer,
          vendor: orderData.vendor,
          amount_xmr: orderData.amount_xmr
        })
      });
      const data = await r.json();
      setWallet(data);
      setMessage({ type: 'success', text: '✅ Multisig 2/3 wallet created!' });
    } catch (e) {
      setMessage({ type: 'error', text: 'Failed to create multisig wallet' });
    } finally {
      setLoading(false);
    }
  };

  const signRelease = async () => {
    setSigning(true);
    setMessage(null);
    try {
      const r = await fetch(`${API}/api/multisig/${orderId}/sign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ signer: username, role })
      });
      const data = await r.json();
      if (data.success) {
        setMessage({
          type: 'success',
          text: data.release
            ? `✅ Funds released! TX: ${data.release.tx_hash?.slice(0, 20)}...`
            : `✅ Signed (${data.signed_count}/2). Waiting for other party.`
        });
        fetchWallet();
      } else {
        setMessage({ type: 'error', text: data.error || 'Sign failed' });
      }
    } catch (e) {
      setMessage({ type: 'error', text: 'Network error' });
    } finally {
      setSigning(false);
    }
  };

  const openDispute = async () => {
    if (!disputeReason.trim()) return;
    setDisputing(true);
    try {
      const r = await fetch(`${API}/api/multisig/${orderId}/dispute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ opener: username, reason: disputeReason })
      });
      const data = await r.json();
      if (data.success) {
        setMessage({ type: 'warning', text: '⚠️ Dispute opened. Admin will arbitrate.' });
        setShowDispute(false);
        fetchWallet();
      }
    } catch (e) {
      setMessage({ type: 'error', text: 'Failed to open dispute' });
    } finally {
      setDisputing(false);
    }
  };

  const getStatusColor = (status) => {
    const colors = {
      awaiting_deposit: '#f59e0b',
      awaiting_signatures: '#3b82f6',
      funded: '#10b981',
      completed: '#22c55e',
      dispute: '#ef4444',
      refunded: '#8b5cf6'
    };
    return colors[status] || '#6b7280';
  };

  const getStatusLabel = (status) => {
    const labels = {
      awaiting_deposit: '⏳ Awaiting Deposit',
      awaiting_signatures: '✍️ Awaiting Signatures',
      funded: '💰 Funded',
      completed: '✅ Completed',
      dispute: '⚠️ In Dispute',
      refunded: '↩️ Refunded'
    };
    return labels[status] || status;
  };

  const canSign = () => {
    if (!wallet) return false;
    if (wallet.status === 'completed' || wallet.status === 'refunded') return false;
    if (wallet.status === 'dispute' && role !== 'marketplace') return false;
    const signer = wallet.signers?.[role];
    return signer && !signer.signed;
  };

  const canDispute = () => {
    if (!wallet) return false;
    return ['awaiting_deposit', 'awaiting_signatures', 'funded'].includes(wallet.status)
      && role !== 'marketplace';
  };

  if (loading) {
    return (
      <div style={{ padding: '20px', textAlign: 'center', color: '#9ca3af' }}>
        <div style={{ fontSize: '24px', marginBottom: '8px' }}>🔄</div>
        Loading multisig wallet...
      </div>
    );
  }

  if (!wallet) {
    return (
      <div style={{
        background: '#1a1a2e', border: '1px solid #2d2d44', borderRadius: '12px',
        padding: '24px', textAlign: 'center'
      }}>
        <div style={{ fontSize: '48px', marginBottom: '12px' }}>🔐</div>
        <h3 style={{ color: '#e2e8f0', marginBottom: '8px' }}>Multisig 2/3 Escrow</h3>
        <p style={{ color: '#9ca3af', marginBottom: '20px', fontSize: '14px' }}>
          No multisig wallet found for this order. Create one to enable secure 2-of-3 escrow.
        </p>
        <button
          onClick={createWallet}
          style={{
            background: 'linear-gradient(135deg, #7c3aed, #4f46e5)',
            color: 'white', border: 'none', borderRadius: '8px',
            padding: '12px 24px', cursor: 'pointer', fontSize: '14px', fontWeight: '600'
          }}
        >
          🔐 Create Multisig Wallet
        </button>
      </div>
    );
  }

  const signedCount = Object.values(wallet.signers || {}).filter(s => s.signed).length;

  return (
    <div style={{
      background: '#0f0f1a', border: '1px solid #2d2d44', borderRadius: '12px',
      padding: '20px', fontFamily: 'monospace'
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <h3 style={{ color: '#e2e8f0', margin: 0, fontSize: '16px' }}>
          🔐 Multisig Escrow 2/3
        </h3>
        <span style={{
          background: getStatusColor(wallet.status) + '22',
          color: getStatusColor(wallet.status),
          border: `1px solid ${getStatusColor(wallet.status)}44`,
          borderRadius: '20px', padding: '4px 12px', fontSize: '12px', fontWeight: '600'
        }}>
          {getStatusLabel(wallet.status)}
        </span>
      </div>

      {/* Multisig Address */}
      <div style={{
        background: '#1a1a2e', borderRadius: '8px', padding: '12px', marginBottom: '16px'
      }}>
        <div style={{ color: '#6b7280', fontSize: '11px', marginBottom: '4px' }}>MULTISIG ADDRESS (2/3)</div>
        <div style={{
          color: '#a78bfa', fontSize: '12px', wordBreak: 'break-all',
          fontFamily: 'monospace'
        }}>
          {wallet.multisig_address}
        </div>
        <div style={{ display: 'flex', gap: '12px', marginTop: '8px' }}>
          <span style={{ color: '#9ca3af', fontSize: '11px' }}>
            💰 {wallet.amount_xmr} XMR
          </span>
          <span style={{ color: '#9ca3af', fontSize: '11px' }}>
            🔑 Threshold: {wallet.threshold}/{wallet.total_signers}
          </span>
          <span style={{ color: wallet.rpc_mode === 'live' ? '#22c55e' : '#f59e0b', fontSize: '11px' }}>
            {wallet.rpc_mode === 'live' ? '🟢 Live RPC' : '🟡 Simulated'}
          </span>
        </div>
      </div>

      {/* Signers Status */}
      <div style={{ marginBottom: '16px' }}>
        <div style={{ color: '#6b7280', fontSize: '11px', marginBottom: '8px' }}>
          SIGNATURES ({signedCount}/2 required)
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {Object.entries(wallet.signers || {}).map(([signerRole, info]) => (
            <div key={signerRole} style={{
              background: info.signed ? '#16a34a22' : '#1a1a2e',
              border: `1px solid ${info.signed ? '#16a34a' : '#374151'}`,
              borderRadius: '8px', padding: '8px 12px', flex: '1', minWidth: '100px'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '16px' }}>
                  {signerRole === 'buyer' ? '🛒' : signerRole === 'vendor' ? '🏪' : '⚖️'}
                </span>
                <div>
                  <div style={{
                    color: info.signed ? '#22c55e' : '#9ca3af',
                    fontSize: '12px', fontWeight: '600', textTransform: 'capitalize'
                  }}>
                    {signerRole}
                  </div>
                  <div style={{ color: '#6b7280', fontSize: '10px' }}>
                    {info.signed ? `✅ Signed ${info.signed_at?.slice(0, 10)}` : '⏳ Pending'}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Progress Bar */}
      <div style={{ marginBottom: '16px' }}>
        <div style={{
          background: '#1a1a2e', borderRadius: '4px', height: '6px', overflow: 'hidden'
        }}>
          <div style={{
            background: signedCount >= 2 ? '#22c55e' : '#7c3aed',
            width: `${(signedCount / 2) * 100}%`,
            height: '100%', transition: 'width 0.3s ease',
            borderRadius: '4px'
          }} />
        </div>
        <div style={{ color: '#6b7280', fontSize: '11px', marginTop: '4px' }}>
          {signedCount >= 2 ? '✅ Threshold reached - funds released' : `${signedCount}/2 signatures collected`}
        </div>
      </div>

      {/* Release TX */}
      {wallet.release_tx && (
        <div style={{
          background: '#16a34a11', border: '1px solid #16a34a33',
          borderRadius: '8px', padding: '12px', marginBottom: '16px'
        }}>
          <div style={{ color: '#22c55e', fontSize: '12px', fontWeight: '600', marginBottom: '4px' }}>
            ✅ Funds Released
          </div>
          <div style={{ color: '#9ca3af', fontSize: '11px', wordBreak: 'break-all' }}>
            TX: {wallet.release_tx}
          </div>
          {wallet.released_at && (
            <div style={{ color: '#6b7280', fontSize: '10px', marginTop: '4px' }}>
              {wallet.released_at.slice(0, 19).replace('T', ' ')} UTC
            </div>
          )}
        </div>
      )}

      {/* Dispute Info */}
      {wallet.dispute && (
        <div style={{
          background: '#ef444411', border: '1px solid #ef444433',
          borderRadius: '8px', padding: '12px', marginBottom: '16px'
        }}>
          <div style={{ color: '#ef4444', fontSize: '12px', fontWeight: '600', marginBottom: '4px' }}>
            ⚠️ Dispute Open
          </div>
          <div style={{ color: '#9ca3af', fontSize: '11px' }}>
            Reason: {wallet.dispute_reason}
          </div>
          <div style={{ color: '#6b7280', fontSize: '10px', marginTop: '4px' }}>
            Opened by: {wallet.dispute_opened_by}
          </div>
          {wallet.resolution && (
            <div style={{ color: '#22c55e', fontSize: '11px', marginTop: '8px', fontWeight: '600' }}>
              ✅ Resolved: {wallet.resolution === wallet.vendor ? 'Vendor paid' : 'Buyer refunded'}
            </div>
          )}
        </div>
      )}

      {/* Message */}
      {message && (
        <div style={{
          background: message.type === 'success' ? '#16a34a22' : message.type === 'warning' ? '#f59e0b22' : '#ef444422',
          border: `1px solid ${message.type === 'success' ? '#16a34a' : message.type === 'warning' ? '#f59e0b' : '#ef4444'}44`,
          borderRadius: '8px', padding: '10px 14px', marginBottom: '16px',
          color: message.type === 'success' ? '#22c55e' : message.type === 'warning' ? '#f59e0b' : '#ef4444',
          fontSize: '13px'
        }}>
          {message.text}
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        {/* Sign Button */}
        {canSign() && (
          <button
            onClick={signRelease}
            disabled={signing}
            style={{
              background: signing ? '#374151' : 'linear-gradient(135deg, #16a34a, #15803d)',
              color: 'white', border: 'none', borderRadius: '8px',
              padding: '10px 20px', cursor: signing ? 'not-allowed' : 'pointer',
              fontSize: '13px', fontWeight: '600', flex: '1'
            }}
          >
            {signing ? '⏳ Signing...' : '✍️ Sign Release'}
          </button>
        )}

        {/* Dispute Button */}
        {canDispute() && !showDispute && (
          <button
            onClick={() => setShowDispute(true)}
            style={{
              background: '#1a1a2e', color: '#ef4444',
              border: '1px solid #ef444444', borderRadius: '8px',
              padding: '10px 16px', cursor: 'pointer', fontSize: '13px'
            }}
          >
            ⚠️ Open Dispute
          </button>
        )}

        {/* Refresh */}
        <button
          onClick={fetchWallet}
          style={{
            background: '#1a1a2e', color: '#6b7280',
            border: '1px solid #374151', borderRadius: '8px',
            padding: '10px 14px', cursor: 'pointer', fontSize: '13px'
          }}
        >
          🔄
        </button>
      </div>

      {/* Dispute Form */}
      {showDispute && (
        <div style={{
          background: '#1a1a2e', border: '1px solid #ef444444',
          borderRadius: '8px', padding: '16px', marginTop: '12px'
        }}>
          <div style={{ color: '#ef4444', fontSize: '13px', fontWeight: '600', marginBottom: '8px' }}>
            ⚠️ Open Dispute
          </div>
          <textarea
            value={disputeReason}
            onChange={e => setDisputeReason(e.target.value)}
            placeholder="Describe the issue (e.g. item not received, wrong item, scam...)"
            style={{
              width: '100%', background: '#0f0f1a', border: '1px solid #374151',
              borderRadius: '6px', padding: '10px', color: '#e2e8f0',
              fontSize: '13px', resize: 'vertical', minHeight: '80px',
              boxSizing: 'border-box', fontFamily: 'monospace'
            }}
          />
          <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
            <button
              onClick={openDispute}
              disabled={disputing || !disputeReason.trim()}
              style={{
                background: disputing ? '#374151' : '#ef4444',
                color: 'white', border: 'none', borderRadius: '6px',
                padding: '8px 16px', cursor: 'pointer', fontSize: '13px', fontWeight: '600'
              }}
            >
              {disputing ? '⏳ Opening...' : '⚠️ Confirm Dispute'}
            </button>
            <button
              onClick={() => setShowDispute(false)}
              style={{
                background: 'transparent', color: '#6b7280',
                border: '1px solid #374151', borderRadius: '6px',
                padding: '8px 16px', cursor: 'pointer', fontSize: '13px'
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Info Box */}
      <div style={{
        background: '#1a1a2e', borderRadius: '8px', padding: '12px', marginTop: '12px',
        border: '1px solid #2d2d44'
      }}>
        <div style={{ color: '#6b7280', fontSize: '11px', lineHeight: '1.6' }}>
          <strong style={{ color: '#9ca3af' }}>How 2/3 Multisig works:</strong><br />
          • <strong>Normal:</strong> Buyer + Vendor sign → funds go to vendor<br />
          • <strong>Dispute:</strong> Admin + Buyer sign → refund | Admin + Vendor sign → vendor paid<br />
          • No single party can steal funds — 2 of 3 must agree
        </div>
      </div>
    </div>
  );
}

/**
 * Admin Multisig Panel - Voir tous les wallets multisig
 */
export function AdminMultisigPanel({ username }) {
  const [wallets, setWallets] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [resolving, setResolving] = useState(null);

  useEffect(() => {
    fetchAll();
  }, []);

  const fetchAll = async () => {
    try {
      const [walletsR, summaryR] = await Promise.all([
        fetch(`${API}/api/admin/multisig?username=${username}`, { headers: { ...getAuthHeaders() } }),
        fetch(`${API}/api/admin/multisig/summary?username=${username}`, { headers: { ...getAuthHeaders() } })
      ]);
      if (walletsR.ok) setWallets(await walletsR.json());
      if (summaryR.ok) setSummary(await summaryR.json());
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const resolveDispute = async (orderId, winner) => {
    setResolving(orderId);
    try {
      const r = await fetch(`${API}/api/admin/multisig/${orderId}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
        body: JSON.stringify({ admin: username, winner })
      });
      const data = await r.json();
      if (data.success) {
        fetchAll();
      }
    } catch (e) {
      console.error(e);
    } finally {
      setResolving(null);
    }
  };

  if (loading) return <div style={{ color: '#9ca3af', padding: '20px' }}>Loading multisig data...</div>;

  return (
    <div style={{ fontFamily: 'monospace' }}>
      <h3 style={{ color: '#e2e8f0', marginBottom: '16px' }}>🔐 Multisig 2/3 Admin Panel</h3>

      {/* Summary */}
      {summary && (
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '20px' }}>
          {[
            { label: 'Total', value: summary.total, color: '#9ca3af' },
            { label: 'Awaiting', value: summary.awaiting_deposit + summary.awaiting_signatures, color: '#f59e0b' },
            { label: 'Funded', value: summary.funded, color: '#3b82f6' },
            { label: 'Completed', value: summary.completed, color: '#22c55e' },
            { label: 'Disputes', value: summary.dispute, color: '#ef4444' },
            { label: 'XMR Locked', value: `${summary.total_xmr_locked} XMR`, color: '#a78bfa' },
          ].map(item => (
            <div key={item.label} style={{
              background: '#1a1a2e', border: '1px solid #2d2d44',
              borderRadius: '8px', padding: '12px 16px', textAlign: 'center'
            }}>
              <div style={{ color: item.color, fontSize: '20px', fontWeight: '700' }}>{item.value}</div>
              <div style={{ color: '#6b7280', fontSize: '11px' }}>{item.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Disputes requiring action */}
      {wallets.filter(w => w.status === 'dispute').length > 0 && (
        <div style={{ marginBottom: '20px' }}>
          <div style={{ color: '#ef4444', fontSize: '13px', fontWeight: '600', marginBottom: '10px' }}>
            ⚠️ DISPUTES REQUIRING ACTION
          </div>
          {wallets.filter(w => w.status === 'dispute').map(w => (
            <div key={w.order_id} style={{
              background: '#ef444411', border: '1px solid #ef444433',
              borderRadius: '8px', padding: '14px', marginBottom: '8px'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ color: '#e2e8f0', fontSize: '13px', fontWeight: '600' }}>
                    Order: {w.order_id}
                  </div>
                  <div style={{ color: '#9ca3af', fontSize: '12px', marginTop: '4px' }}>
                    Buyer: {w.buyer} | Vendor: {w.vendor} | {w.amount_xmr} XMR
                  </div>
                  <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '4px' }}>
                    Reason: {w.dispute_reason}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    onClick={() => resolveDispute(w.order_id, w.vendor)}
                    disabled={resolving === w.order_id}
                    style={{
                      background: '#16a34a', color: 'white', border: 'none',
                      borderRadius: '6px', padding: '6px 12px', cursor: 'pointer', fontSize: '12px'
                    }}
                  >
                    ✅ Vendor Wins
                  </button>
                  <button
                    onClick={() => resolveDispute(w.order_id, w.buyer)}
                    disabled={resolving === w.order_id}
                    style={{
                      background: '#7c3aed', color: 'white', border: 'none',
                      borderRadius: '6px', padding: '6px 12px', cursor: 'pointer', fontSize: '12px'
                    }}
                  >
                    ↩️ Refund Buyer
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* All wallets */}
      <div style={{ color: '#6b7280', fontSize: '12px', marginBottom: '8px' }}>
        ALL MULTISIG WALLETS ({wallets.length})
      </div>
      {wallets.length === 0 ? (
        <div style={{ color: '#6b7280', fontSize: '13px', padding: '20px', textAlign: 'center' }}>
          No multisig wallets yet
        </div>
      ) : (
        wallets.map(w => (
          <div key={w.order_id} style={{
            background: '#1a1a2e', border: '1px solid #2d2d44',
            borderRadius: '8px', padding: '12px', marginBottom: '8px',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center'
          }}>
            <div>
              <div style={{ color: '#e2e8f0', fontSize: '12px' }}>{w.order_id}</div>
              <div style={{ color: '#9ca3af', fontSize: '11px' }}>
                {w.buyer} → {w.vendor} | {w.amount_xmr} XMR
              </div>
            </div>
            <span style={{
              color: w.status === 'completed' ? '#22c55e' : w.status === 'dispute' ? '#ef4444' : '#f59e0b',
              fontSize: '11px', fontWeight: '600'
            }}>
              {w.status}
            </span>
          </div>
        ))
      )}
    </div>
  );
}

