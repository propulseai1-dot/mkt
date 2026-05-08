import React from 'react';

function getSessionBearer() {
  try {
    const raw = localStorage.getItem('silkGenesis_session');
    if (!raw) return null;
    const j = JSON.parse(raw);
    return j.session_token || null;
  } catch {
    return null;
  }
}

/**
 * SILKGENESIS - Monero Checkout & Release Funds Components
 * 
 * MoneroCheckout: Displays l'address de deposit + QR code + polling du statut
 * ReleaseFundsButton: Bouton "Release the Funds" pour le buyer apres reception
 * OrderPaymentStatus: Statut de payment en temps reel
 */

function AuthenticatedMoneroQrImg({ srcPathWithQuery, size, alt }) {
  const [blobUrl, setBlobUrl] = React.useState(null);
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => {
    let cancelled = false;
    let objectUrl = null;
    (async () => {
      setFailed(false);
      setBlobUrl(null);
      try {
        const raw = localStorage.getItem('silkGenesis_session');
        const token = raw ? JSON.parse(raw).session_token : null;
        if (!token || !srcPathWithQuery) return;
        const r = await fetch(srcPathWithQuery, { headers: { Authorization: `Bearer ${token}` } });
        if (!r.ok) {
          if (!cancelled) setFailed(true);
          return;
        }
        const blob = await r.blob();
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setBlobUrl(objectUrl);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [srcPathWithQuery]);
  if (failed || !blobUrl) {
    return (
      <div
        style={{
          width: size,
          height: size,
          background: '#111',
          borderRadius: 8,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#666',
          fontSize: 10,
          fontFamily: 'monospace',
        }}
      >
        {failed ? 'QR unavailable' : '…'}
      </div>
    );
  }
  return <img src={blobUrl} alt={alt || 'Monero QR'} width={size} height={size} style={{ display: 'block', borderRadius: 4 }} />;
}

// ============================================================
// QR CODE GENERATOR (sans dependance externe)
// Utilise l'API QR code de Google Charts (fonctionne sur Tor)
// ============================================================
function MoneroQRCode({ address, amount, size = 200 }) {
  if (!address) return null;
  
  // Format URI Monero standard
  const uri = amount 
    ? `monero:${address}?tx_amount=${amount.toFixed(12)}`
    : `monero:${address}`;
  
  // QR generated locally by backend (offline, no third-party service)
  const qrUrl = `/api/qr/monero?uri=${encodeURIComponent(uri)}&size=${size}`;
  
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: '8px'
    }}>
      <div style={{
        padding: '12px',
        background: '#1a1a2e',
        border: '2px solid #f97316',
        borderRadius: '12px',
        display: 'inline-block'
      }}>
        {qrUrl ? (
          <AuthenticatedMoneroQrImg srcPathWithQuery={qrUrl} size={size} alt="Monero QR Code" />
        ) : null}
      </div>
      <span style={{ fontSize: '11px', color: '#888', fontFamily: 'monospace' }}>
        Scan with Monero wallet
      </span>
    </div>
  );
}

// ============================================================
// COPY TO CLIPBOARD BUTTON
// ============================================================
function CopyButton({ text, label = "Copy" }) {
  const [copied, setCopied] = React.useState(false);
  
  const handleCopy = () => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    } else {
      // Fallback
      const el = document.createElement('textarea');
      el.value = text;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };
  
  return (
    <button
      onClick={handleCopy}
      style={{
        background: copied ? '#22c55e' : '#374151',
        color: 'white',
        border: 'none',
        borderRadius: '6px',
        padding: '6px 12px',
        cursor: 'pointer',
        fontSize: '12px',
        fontWeight: '600',
        transition: 'all 0.2s',
        display: 'flex',
        alignItems: 'center',
        gap: '4px',
        whiteSpace: 'nowrap'
      }}
    >
      {copied ? '✓ Copied!' : `📋 ${label}`}
    </button>
  );
}

// ============================================================
// CONFIRMATION PROGRESS BAR
// ============================================================
function ConfirmationProgress({ confirmations, required = 10 }) {
  const pct = Math.min(100, Math.round((confirmations / required) * 100));
  const color = pct === 100 ? '#22c55e' : pct > 50 ? '#f97316' : '#ef4444';
  
  return (
    <div style={{ width: '100%' }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        marginBottom: '4px',
        fontSize: '12px',
        color: '#9ca3af'
      }}>
        <span>Blockchain Confirmations</span>
        <span style={{ color, fontWeight: '700' }}>{confirmations}/{required}</span>
      </div>
      <div style={{
        height: '8px',
        background: '#1f2937',
        borderRadius: '4px',
        overflow: 'hidden'
      }}>
        <div style={{
          height: '100%',
          width: `${pct}%`,
          background: color,
          borderRadius: '4px',
          transition: 'width 0.5s ease'
        }} />
      </div>
      {pct < 100 && (
        <p style={{ fontSize: '11px', color: '#6b7280', marginTop: '4px', textAlign: 'center' }}>
          {required - confirmations} more confirmation{required - confirmations !== 1 ? 's' : ''} needed
        </p>
      )}
    </div>
  );
}

// ============================================================
// MONERO CHECKOUT MODAL
// Shown apres creation d'une order
// ============================================================
function MoneroCheckout({ order, onClose, onPaymentConfirmed }) {
  const [paymentStatus, setPaymentStatus] = React.useState({
    payment_status: 'pending',
    confirmations: 0,
    amount_received_xmr: 0,
    confirmations_needed: 10
  });
  const [polling, setPolling] = React.useState(true);
  const [error, setError] = React.useState(null);
  
  const depositAddress = order?.deposit_address || order?.escrow_address;
  const amountXmr = order?.amount_xmr || 0;
  const orderId = order?.order_id || order?.id;
  
  // Polling du statut de payment toutes les 15 secondes
  React.useEffect(() => {
    if (!orderId || !polling) return;
    
    const poll = async () => {
      try {
        const token = getSessionBearer();
        const resp = await fetch(`/api/order/${orderId}/payment`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (resp.ok) {
          const data = await resp.json();
          setPaymentStatus(data);
          
          if (data.payment_status === 'confirmed') {
            setPolling(false);
            if (onPaymentConfirmed) onPaymentConfirmed(data);
          }
        }
      } catch (e) {
        // Silently fail - network might be slow on Tor
      }
    };
    
    poll(); // Immediat
    const interval = setInterval(poll, 15000); // Toutes les 15s
    return () => clearInterval(interval);
  }, [orderId, polling]);
  
  const isConfirmed = paymentStatus.payment_status === 'confirmed';
  const hasReceived = paymentStatus.amount_received_xmr > 0;
  
  return (
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
        maxWidth: '520px',
        width: '100%',
        maxHeight: '90vh',
        overflowY: 'auto'
      }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
          <div>
            <h2 style={{ color: '#f97316', margin: 0, fontSize: '20px', fontWeight: '700' }}>
              🔒 Escrow Payment
            </h2>
            <p style={{ color: '#6b7280', margin: '4px 0 0', fontSize: '13px' }}>
              Order #{orderId?.slice(-8)}
            </p>
          </div>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', color: '#6b7280',
            fontSize: '24px', cursor: 'pointer', padding: '4px'
          }}>×</button>
        </div>
        
        {/* Status Banner */}
        <div style={{
          background: isConfirmed ? 'rgba(34,197,94,0.1)' : hasReceived ? 'rgba(249,115,22,0.1)' : 'rgba(59,130,246,0.1)',
          border: `1px solid ${isConfirmed ? '#22c55e' : hasReceived ? '#f97316' : '#3b82f6'}`,
          borderRadius: '10px',
          padding: '12px 16px',
          marginBottom: '20px',
          display: 'flex',
          alignItems: 'center',
          gap: '10px'
        }}>
          <span style={{ fontSize: '20px' }}>
            {isConfirmed ? '✅' : hasReceived ? '⏳' : '⏸️'}
          </span>
          <div>
            <p style={{ margin: 0, fontWeight: '700', color: isConfirmed ? '#22c55e' : hasReceived ? '#f97316' : '#93c5fd', fontSize: '14px' }}>
              {isConfirmed ? 'Payment Confirmed!' : hasReceived ? 'Transaction Detected - Waiting for Confirmations' : 'Waiting for Payment'}
            </p>
            <p style={{ margin: '2px 0 0', fontSize: '12px', color: '#9ca3af' }}>
              {isConfirmed 
                ? 'Funds are secured in escrow. You can now release them to the vendor.'
                : hasReceived 
                  ? `${paymentStatus.amount_received_xmr?.toFixed(6)} XMR received - ${paymentStatus.confirmations}/${paymentStatus.confirmations_needed} confirmations`
                  : 'Send the exact amount to the address below. Funds will be held in escrow.'}
            </p>
          </div>
        </div>
        
        {/* Amount */}
        <div style={{
          background: '#1f2937',
          borderRadius: '10px',
          padding: '16px',
          marginBottom: '16px',
          textAlign: 'center'
        }}>
          <p style={{ color: '#9ca3af', margin: '0 0 4px', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '1px' }}>
            Amount to Send
          </p>
          <p style={{ color: '#f97316', margin: 0, fontSize: '28px', fontWeight: '800', fontFamily: 'monospace' }}>
            {amountXmr.toFixed(6)} XMR
          </p>
          <p style={{ color: '#6b7280', margin: '4px 0 0', fontSize: '12px' }}>
            ⚠️ Send EXACTLY this amount - no more, no less
          </p>
        </div>
        
        {/* QR Code */}
        {depositAddress && (
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '16px' }}>
            <MoneroQRCode address={depositAddress} amount={amountXmr} size={180} />
          </div>
        )}
        
        {/* Deposit Address */}
        {depositAddress && (
          <div style={{ marginBottom: '16px' }}>
            <p style={{ color: '#9ca3af', margin: '0 0 6px', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '1px' }}>
              Deposit Address
            </p>
            <div style={{
              background: '#0f172a',
              border: '1px solid #374151',
              borderRadius: '8px',
              padding: '12px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}>
              <code style={{
                color: '#e2e8f0',
                fontSize: '11px',
                fontFamily: 'monospace',
                wordBreak: 'break-all',
                flex: 1,
                lineHeight: '1.5'
              }}>
                {depositAddress}
              </code>
              <CopyButton text={depositAddress} label="Copy" />
            </div>
          </div>
        )}
        
        {/* Confirmation Progress */}
        {hasReceived && !isConfirmed && (
          <div style={{ marginBottom: '16px' }}>
            <ConfirmationProgress 
              confirmations={paymentStatus.confirmations} 
              required={paymentStatus.confirmations_needed || 10} 
            />
          </div>
        )}
        
        {/* Security Info */}
        <div style={{
          background: '#0f172a',
          border: '1px solid #1e3a5f',
          borderRadius: '8px',
          padding: '12px',
          marginBottom: '16px'
        }}>
          <p style={{ color: '#60a5fa', margin: '0 0 6px', fontSize: '12px', fontWeight: '700' }}>
            🔐 Escrow Security
          </p>
          <ul style={{ color: '#9ca3af', margin: 0, padding: '0 0 0 16px', fontSize: '11px', lineHeight: '1.8' }}>
            <li>Funds held in marketplace escrow wallet</li>
            <li>10 blockchain confirmations required (~20 min)</li>
            <li>You control when to release funds to vendor</li>
            <li>Open dispute if order not received</li>
            <li>Auto-release after 7 days if no action</li>
          </ul>
        </div>
        
        {/* Polling indicator */}
        {polling && !isConfirmed && (
          <p style={{ color: '#6b7280', fontSize: '11px', textAlign: 'center', margin: '0 0 16px' }}>
            🔄 Auto-checking payment status every 15 seconds...
          </p>
        )}
        
        {/* Close button */}
        <button onClick={onClose} style={{
          width: '100%',
          background: '#374151',
          color: 'white',
          border: 'none',
          borderRadius: '8px',
          padding: '12px',
          cursor: 'pointer',
          fontSize: '14px',
          fontWeight: '600'
        }}>
          Close (Payment will continue in background)
        </button>
      </div>
    </div>
  );
}

// ============================================================
// RELEASE FUNDS BUTTON
// Shown dans la page des orders du buyer
// ============================================================
function ReleaseFundsButton({ order, currentUser, onReleased }) {
  const [loading, setLoading] = React.useState(false);
  const [released, setReleased] = React.useState(order?.escrow_status === 'released');
  const [error, setError] = React.useState(null);
  const [showConfirm, setShowConfirm] = React.useState(false);
  const [result, setResult] = React.useState(null);
  
  const orderId = order?.id || order?.order_id;
  const isBuyer = order?.buyer === currentUser;
  const canRelease = isBuyer && 
    !released && 
    ['escrow', 'shipped', 'processing'].includes(order?.status) &&
    order?.escrow_status !== 'released';
  
  if (!canRelease && !released) return null;
  
  if (released || order?.escrow_status === 'released') {
    return (
      <div style={{
        background: 'rgba(34,197,94,0.1)',
        border: '1px solid #22c55e',
        borderRadius: '8px',
        padding: '10px 14px',
        display: 'flex',
        alignItems: 'center',
        gap: '8px'
      }}>
        <span>✅</span>
        <span style={{ color: '#22c55e', fontSize: '13px', fontWeight: '600' }}>
          Funds Released to Vendor
        </span>
        {result?.tx_hash && result.tx_hash !== 'OFFLINE_SIMULATED' && (
          <span style={{ color: '#6b7280', fontSize: '11px', fontFamily: 'monospace' }}>
            TX: {result.tx_hash.slice(0, 12)}...
          </span>
        )}
      </div>
    );
  }
  
  const handleRelease = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const sessionToken = getSessionBearer();
      const resp = await fetch(`/api/order/${orderId}/release`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
        },
        body: JSON.stringify({ buyer: currentUser })
      });
      
      const data = await resp.json();
      
      if (resp.ok && data.status === 'success') {
        setReleased(true);
        setResult(data);
        setShowConfirm(false);
        if (onReleased) onReleased(data);
      } else {
        setError(data.detail || 'Failed to release funds');
        setShowConfirm(false);
      }
    } catch (e) {
      setError('Network error. Please try again.');
      setShowConfirm(false);
    } finally {
      setLoading(false);
    }
  };
  
  return (
    <div>
      {/* Confirmation Dialog */}
      {showConfirm && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.8)',
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
            <h3 style={{ color: '#f97316', margin: '0 0 12px', fontSize: '18px' }}>
              ⚠️ Release Funds to Vendor?
            </h3>
            <p style={{ color: '#d1d5db', margin: '0 0 8px', fontSize: '14px', lineHeight: '1.6' }}>
              You are about to release <strong style={{ color: '#f97316' }}>{order?.amount_xmr?.toFixed(6)} XMR</strong> from escrow to the vendor.
            </p>
            <p style={{ color: '#9ca3af', margin: '0 0 20px', fontSize: '13px', lineHeight: '1.6' }}>
              A marketplace fee of <strong>2.5%</strong> will be deducted automatically. 
              <br/>
              <strong style={{ color: '#ef4444' }}>This action cannot be undone.</strong>
            </p>
            
            <div style={{
              background: '#1f2937',
              borderRadius: '8px',
              padding: '12px',
              marginBottom: '20px',
              fontSize: '13px'
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                <span style={{ color: '#9ca3af' }}>Total in escrow:</span>
                <span style={{ color: '#e2e8f0', fontWeight: '700' }}>{order?.amount_xmr?.toFixed(6)} XMR</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                <span style={{ color: '#9ca3af' }}>Marketplace fee (2.5%):</span>
                <span style={{ color: '#ef4444' }}>-{(order?.amount_xmr * 0.025)?.toFixed(6)} XMR</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #374151', paddingTop: '4px', marginTop: '4px' }}>
                <span style={{ color: '#9ca3af' }}>Vendor receives:</span>
                <span style={{ color: '#22c55e', fontWeight: '700' }}>{(order?.amount_xmr * 0.975)?.toFixed(6)} XMR</span>
              </div>
            </div>
            
            <div style={{ display: 'flex', gap: '12px' }}>
              <button
                onClick={() => setShowConfirm(false)}
                style={{
                  flex: 1,
                  background: '#374151',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  padding: '12px',
                  cursor: 'pointer',
                  fontSize: '14px',
                  fontWeight: '600'
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleRelease}
                disabled={loading}
                style={{
                  flex: 1,
                  background: loading ? '#374151' : '#22c55e',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  padding: '12px',
                  cursor: loading ? 'not-allowed' : 'pointer',
                  fontSize: '14px',
                  fontWeight: '700'
                }}
              >
                {loading ? '⏳ Processing...' : '✅ Confirm Release'}
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Error */}
      {error && (
        <div style={{
          background: 'rgba(239,68,68,0.1)',
          border: '1px solid #ef4444',
          borderRadius: '6px',
          padding: '8px 12px',
          marginBottom: '8px',
          fontSize: '12px',
          color: '#ef4444'
        }}>
          ❌ {error}
        </div>
      )}
      
      {/* Release Button */}
      <button
        onClick={() => setShowConfirm(true)}
        disabled={loading}
        style={{
          background: 'linear-gradient(135deg, #22c55e, #16a34a)',
          color: 'white',
          border: 'none',
          borderRadius: '8px',
          padding: '10px 20px',
          cursor: 'pointer',
          fontSize: '14px',
          fontWeight: '700',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          boxShadow: '0 4px 12px rgba(34,197,94,0.3)',
          transition: 'all 0.2s'
        }}
        onMouseEnter={e => e.target.style.transform = 'translateY(-1px)'}
        onMouseLeave={e => e.target.style.transform = 'translateY(0)'}
      >
        💰 Release the Funds
      </button>
    </div>
  );
}

// ============================================================
// ORDER PAYMENT STATUS CARD
// Shown dans la liste des orders
// ============================================================
function OrderPaymentStatus({ order }) {
  const depositAddress = order?.deposit_address;
  const paymentStatus = order?.payment_status || 'pending';
  const escrowStatus = order?.escrow_status || 'holding';
  
  if (!depositAddress) return null;
  
  const statusConfig = {
    pending: { color: '#f59e0b', icon: '⏳', label: 'Awaiting Payment' },
    confirmed: { color: '#22c55e', icon: '✅', label: 'Payment Confirmed' },
    released: { color: '#8b5cf6', icon: '💸', label: 'Funds Released' }
  };
  
  const cfg = statusConfig[paymentStatus] || statusConfig.pending;
  
  return (
    <div style={{
      background: '#0f172a',
      border: `1px solid ${cfg.color}33`,
      borderRadius: '8px',
      padding: '10px 14px',
      marginTop: '8px'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
        <span>{cfg.icon}</span>
        <span style={{ color: cfg.color, fontSize: '13px', fontWeight: '600' }}>{cfg.label}</span>
      </div>
      {depositAddress && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <code style={{ color: '#6b7280', fontSize: '10px', fontFamily: 'monospace', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {depositAddress.slice(0, 20)}...{depositAddress.slice(-8)}
          </code>
          <CopyButton text={depositAddress} label="Addr" />
        </div>
      )}
    </div>
  );
}

// Export global pour utilisation dans App.js
window.MoneroCheckout = MoneroCheckout;
window.ReleaseFundsButton = ReleaseFundsButton;
window.OrderPaymentStatus = OrderPaymentStatus;
window.MoneroQRCode = MoneroQRCode;



