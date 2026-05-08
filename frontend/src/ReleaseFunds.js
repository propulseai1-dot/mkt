import React, { useState, useEffect } from 'react';
import { CheckCircle, AlertTriangle, Clock, Shield, Unlock, Star, MessageSquare, X } from 'lucide-react';

// ============================================================
// RELEASE FUNDS COMPONENT
// Buyer releases escrow funds to vendor after receiving order
// ============================================================

export default function ReleaseFunds({ order, user, onReleased, onDispute }) {
  const [step, setStep] = useState('confirm'); // confirm | review | done
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const [result, setResult] = useState(null);
  const [autoFinalizeInfo, setAutoFinalizeInfo] = useState(null);

  useEffect(() => {
    // Check auto-finalize status
    if (order?.status === 'shipped' && order?.shipped_at) {
      const shippedAt = new Date(order.shipped_at);
      const now = new Date();
      const daysElapsed = (now - shippedAt) / (1000 * 60 * 60 * 24);
      const daysRemaining = Math.max(0, 7 - daysElapsed);
      setAutoFinalizeInfo({
        daysElapsed: daysElapsed.toFixed(1),
        daysRemaining: daysRemaining.toFixed(1),
        willAutoFinalize: daysRemaining < 1
      });
    }
  }, [order]);

  if (!order) return null;

  const canRelease = ['escrow', 'shipped', 'pending'].includes(order.status);
  const isCompleted = order.status === 'completed';
  const isDisputed = order.status === 'dispute';

  const releaseFunds = async () => {
    setLoading(true);
    setError('');
    try {
      const r = await fetch(`/api/orders/${order.id}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ buyer: user?.username })
      });
      const data = await r.json();
      if (r.ok && data.status === 'success') {
        setResult(data);
        setStep('review');
      } else {
        setError(data.detail || data.message || 'Failed to release funds');
      }
    } catch (e) {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const submitReview = async () => {
    setLoading(true);
    try {
      await fetch('/api/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          order_id: order.id,
          buyer: user?.username,
          vendor: order.vendor,
          rating,
          comment
        })
      });
    } catch (e) {}
    setStep('done');
    setLoading(false);
    if (onReleased) onReleased(result);
  };

  const skipReview = () => {
    setStep('done');
    if (onReleased) onReleased(result);
  };

  // ===== COMPLETED =====
  if (isCompleted) {
    return (
      <div style={styles.container}>
        <div style={styles.successBox}>
          <CheckCircle size={32} style={{ color: '#27ae60', marginBottom: 8 }} />
          <div style={{ fontSize: 16, fontWeight: 700, color: '#27ae60', marginBottom: 4 }}>
            Order Completed
          </div>
          <div style={{ fontSize: 12, color: '#888' }}>
            Funds have been released to the vendor.
          </div>
        </div>
      </div>
    );
  }

  // ===== DISPUTED =====
  if (isDisputed) {
    return (
      <div style={styles.container}>
        <div style={{ ...styles.warningBox, borderColor: '#e74c3c' }}>
          <AlertTriangle size={24} style={{ color: '#e74c3c', marginBottom: 8 }} />
          <div style={{ fontSize: 14, fontWeight: 700, color: '#e74c3c', marginBottom: 4 }}>
            Dispute In Progress
          </div>
          <div style={{ fontSize: 12, color: '#888' }}>
            Admin is reviewing this dispute. Funds are frozen until resolution.
          </div>
        </div>
      </div>
    );
  }

  // ===== STEP: DONE =====
  if (step === 'done') {
    return (
      <div style={styles.container}>
        <div style={styles.successBox}>
          <div style={{ fontSize: 40, marginBottom: 8 }}>🎉</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#27ae60', marginBottom: 4 }}>
            Funds Released!
          </div>
          {result && (
            <div style={{ fontSize: 12, color: '#888', marginTop: 8 }}>
              <div>Vendor received: <span style={{ color: '#27ae60' }}>{result.vendor_received?.toFixed(6)} XMR</span></div>
              <div>Commission: <span style={{ color: '#f39c12' }}>{result.commission?.toFixed(6)} XMR</span></div>
              {result.vendor_level && (
                <div style={{ marginTop: 4, color: '#9b59b6' }}>Vendor level: {result.vendor_level}</div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ===== STEP: REVIEW =====
  if (step === 'review') {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#f39c12', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Star size={16} /> Leave a Review
          </div>
          <div style={{ fontSize: 12, color: '#888', marginBottom: 16 }}>
            Help other buyers by rating your experience with <strong style={{ color: '#ccc' }}>{order.vendor}</strong>
          </div>

          {/* Star Rating */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 16, justifyContent: 'center' }}>
            {[1, 2, 3, 4, 5].map(n => (
              <button
                key={n}
                onClick={() => setRating(n)}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  fontSize: 28, color: n <= rating ? '#f39c12' : '#333',
                  transition: 'color 0.15s'
                }}
              >
                ★
              </button>
            ))}
          </div>

          <textarea
            value={comment}
            onChange={e => setComment(e.target.value)}
            placeholder="Share your experience (optional)..."
            style={{
              width: '100%', height: 80, background: '#0d0d1a',
              border: '1px solid #222', borderRadius: 8, color: '#ccc',
              padding: 10, fontSize: 12, resize: 'none', outline: 'none',
              boxSizing: 'border-box', marginBottom: 12
            }}
          />

          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={submitReview}
              disabled={loading}
              style={{ ...styles.primaryBtn, flex: 1 }}
            >
              {loading ? '...' : '⭐ Submit Review'}
            </button>
            <button onClick={skipReview} style={{ ...styles.secondaryBtn }}>
              Skip
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ===== STEP: CONFIRM =====
  return (
    <div style={styles.container}>
      <div style={styles.card}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
          <Shield size={18} style={{ color: '#9b59b6' }} />
          <span style={{ fontSize: 15, fontWeight: 700, color: '#ccc' }}>Escrow Release</span>
        </div>

        {/* Order Info */}
        <div style={styles.infoBox}>
          <div style={styles.infoRow}>
            <span style={styles.infoLabel}>Order</span>
            <span style={styles.infoValue}>#{order.id?.slice(-8)}</span>
          </div>
          <div style={styles.infoRow}>
            <span style={styles.infoLabel}>Vendor</span>
            <span style={styles.infoValue}>{order.vendor}</span>
          </div>
          <div style={styles.infoRow}>
            <span style={styles.infoLabel}>Amount</span>
            <span style={{ ...styles.infoValue, color: '#27ae60', fontWeight: 700 }}>
              {order.amount_xmr?.toFixed(6)} XMR
            </span>
          </div>
          <div style={styles.infoRow}>
            <span style={styles.infoLabel}>Status</span>
            <span style={{
              ...styles.infoValue,
              color: order.status === 'shipped' ? '#27ae60' : '#f39c12',
              textTransform: 'uppercase', fontSize: 10
            }}>
              {order.status}
            </span>
          </div>
        </div>

        {/* Auto-finalize warning */}
        {autoFinalizeInfo && (
          <div style={{
            background: autoFinalizeInfo.willAutoFinalize ? 'rgba(231,76,60,0.1)' : 'rgba(243,156,18,0.1)',
            border: `1px solid ${autoFinalizeInfo.willAutoFinalize ? '#e74c3c' : '#f39c12'}`,
            borderRadius: 8, padding: '8px 12px', marginBottom: 12, fontSize: 11,
            color: autoFinalizeInfo.willAutoFinalize ? '#e74c3c' : '#f39c12',
            display: 'flex', alignItems: 'center', gap: 6
          }}>
            <Clock size={12} />
            {autoFinalizeInfo.willAutoFinalize
              ? `⚠️ Auto-finalizes in ${autoFinalizeInfo.daysRemaining} days!`
              : `Auto-finalize in ${autoFinalizeInfo.daysRemaining} days (${autoFinalizeInfo.daysElapsed} days elapsed)`
            }
          </div>
        )}

        {/* Warning */}
        <div style={styles.warningBox}>
          <AlertTriangle size={14} style={{ color: '#f39c12', flexShrink: 0 }} />
          <div style={{ fontSize: 11, color: '#888' }}>
            <strong style={{ color: '#f39c12' }}>Only release funds if you received your order.</strong>
            {' '}This action is irreversible. If you have a problem, open a dispute instead.
          </div>
        </div>

        {/* Error */}
        {error && (
          <div style={{ background: 'rgba(231,76,60,0.1)', border: '1px solid #e74c3c', borderRadius: 8, padding: '8px 12px', marginBottom: 12, fontSize: 12, color: '#e74c3c' }}>
            {error}
          </div>
        )}

        {/* Actions */}
        {canRelease ? (
          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <button
              onClick={releaseFunds}
              disabled={loading}
              style={{ ...styles.releaseBtn, flex: 1 }}
            >
              {loading ? (
                <span>Processing...</span>
              ) : (
                <>
                  <Unlock size={14} />
                  Release Funds to Vendor
                </>
              )}
            </button>
            {onDispute && (
              <button
                onClick={() => onDispute(order.id)}
                style={styles.disputeBtn}
                title="Open Dispute"
              >
                <AlertTriangle size={14} />
              </button>
            )}
          </div>
        ) : (
          <div style={{ textAlign: 'center', color: '#555', fontSize: 12, padding: '8px 0' }}>
            Cannot release funds — order status: {order.status}
          </div>
        )}

        {/* Chat button */}
        {onDispute && (
          <div style={{ marginTop: 8, textAlign: 'center' }}>
            <span style={{ fontSize: 10, color: '#444' }}>
              Problem? <button onClick={() => onDispute && onDispute(order.id)} style={{ background: 'none', border: 'none', color: '#9b59b6', cursor: 'pointer', fontSize: 10, textDecoration: 'underline' }}>Open a dispute</button>
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

const styles = {
  container: {
    width: '100%',
  },
  card: {
    background: '#0d0d1a',
    border: '1px solid #1a1a2e',
    borderRadius: 12,
    padding: 20,
  },
  infoBox: {
    background: '#080810',
    border: '1px solid #111',
    borderRadius: 8,
    padding: '10px 14px',
    marginBottom: 12,
  },
  infoRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '3px 0',
  },
  infoLabel: {
    fontSize: 11,
    color: '#555',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  infoValue: {
    fontSize: 12,
    color: '#ccc',
    fontFamily: 'monospace',
  },
  warningBox: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 8,
    background: 'rgba(243,156,18,0.08)',
    border: '1px solid rgba(243,156,18,0.3)',
    borderRadius: 8,
    padding: '8px 12px',
    marginBottom: 14,
  },
  successBox: {
    background: 'rgba(39,174,96,0.08)',
    border: '1px solid rgba(39,174,96,0.3)',
    borderRadius: 12,
    padding: 24,
    textAlign: 'center',
  },
  releaseBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: '12px 20px',
    background: 'linear-gradient(135deg, #27ae60, #2ecc71)',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 700,
    transition: 'opacity 0.15s',
  },
  disputeBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '12px 14px',
    background: 'rgba(231,76,60,0.15)',
    color: '#e74c3c',
    border: '1px solid rgba(231,76,60,0.3)',
    borderRadius: 8,
    cursor: 'pointer',
    transition: 'all 0.15s',
  },
  primaryBtn: {
    padding: '10px 20px',
    background: '#f39c12',
    color: '#000',
    border: 'none',
    borderRadius: 8,
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 700,
  },
  secondaryBtn: {
    padding: '10px 16px',
    background: '#1a1a2e',
    color: '#888',
    border: '1px solid #222',
    borderRadius: 8,
    cursor: 'pointer',
    fontSize: 13,
  },
};
