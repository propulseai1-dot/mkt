import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { 
  ShieldCheck, Star, TrendingUp, TrendingDown, Wallet, Shield, 
  ChevronRight, ChevronDown, Camera, Fingerprint, Terminal,
  Layers, Trash2, CheckCircle, XCircle, Zap, UserPlus, DollarSign, 
  UserMinus, Copy, Home, MessageSquare, PlusCircle, Crown,
  User as UserIcon, Package, ArrowUpCircle, ArrowDownCircle, Lock,
  Search, Filter, Tag, Unlock, Key, Globe, Rocket, Share2
} from 'lucide-react';
import Logo from './Silk_logo.png';
import VendorDashboard from './VendorDashboard';
import AdminCategories from './AdminCategories';
import AdminDashboard from './AdminDashboard';
import ReleaseFunds from './ReleaseFunds';
import AboutPage from './AboutPage';
import CanaryPage from './CanaryPage';
import BecomeVendorPage from './BecomeVendorPage';
import AffiliateProgramPage from './AffiliateProgramPage';
import AlphaBanner from './components/AlphaBanner';
import { TwoFactorSetup } from './TwoFactorSetup';
import { silkApiUrl as silkGenesisApiUrl } from './silkApi';

function SystemBanner() {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  return (
    <div style={{ 
      backgroundColor: '#ff4500', // Orange/Rouge ultra visible
      color: 'white',
      width: '100%',
      position: 'fixed', // On la fixe en haut de the screen quoi qu'il arrive
      top: 0,
      left: 0,
      zIndex: 99999, // Render above everything
      padding: '10px',
      textAlign: 'center',
      fontWeight: 'bold',
      borderBottom: '3px solid white'
    }}>
      [ TEST VISUEL ] SILKGENESIS ALPHA EN LIGNE
      <button onClick={() => setDismissed(true)} style={{ float: 'right', marginRight: '20px' }}>X</button>
    </div>
  );
}


// ============================================================
// NOTIFICATION SOUND (Web Audio API)
// ============================================================
function playNotificationSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.setValueAtTime(1100, ctx.currentTime + 0.1);
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.4);
  } catch(e) {}
}

// QR Monero : l'API exige un Bearer (anti abus) — <img src> ne peut pas envoyer de header.
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
// SESSION TIMEOUT HOOK (30 minutes)
// ============================================================
function useSessionTimeout(user, onLogout, timeoutMs = 30 * 60 * 1000) {
  useEffect(() => {
    if (!user) return;
    let timer = setTimeout(() => {
      alert('⏰ Session expired after 30 minutes of inactivity. Please log in again.');
      onLogout();
    }, timeoutMs);
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        alert('⏰ Session expired after 30 minutes of inactivity. Please log in again.');
        onLogout();
      }, timeoutMs);
    };
    window.addEventListener('mousemove', reset);
    window.addEventListener('keydown', reset);
    window.addEventListener('click', reset);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('mousemove', reset);
      window.removeEventListener('keydown', reset);
      window.removeEventListener('click', reset);
    };
  }, [user, onLogout, timeoutMs]);
 }

// ============================================================
// PGP KEY MODAL
// ============================================================
function PGPModal({ isOpen, onClose, user }) {
  const [pgpKey, setPgpKey] = useState('');
  const [saved, setSaved] = useState(false);
  const [existing, setExisting] = useState('');
  useEffect(() => {
    if (isOpen && user) {
      fetch(`/api/pgp/${user.username}`)
        .then(r => r.json())
        .then(d => { if (d.pgp_key) { setExisting(d.pgp_key); setPgpKey(d.pgp_key); } })
        .catch(() => {});
    }
  }, [isOpen, user]);
  if (!isOpen) return null;
  const handleSave = async () => {
    // Note: This component is outside App, so we can't use authenticatedFetch directly unless we pass it.
    // However, we can use a manual fetch with the token from localStorage.
    const token = (JSON.parse(localStorage.getItem('silkGenesis_session') || '{}')).session_token;
    const res = await fetch('/api/pgp/set', {
      method: 'POST', 
      headers: {
        'Content-Type':'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ username: user.username, pgp_key: pgpKey })
    });
    const d = await res.json();
    if (d.status === 'success') { setSaved(true); setTimeout(() => { setSaved(false); onClose(); }, 1500); }
    else alert('Invalid PGP key format. Must start with -----BEGIN PGP PUBLIC KEY BLOCK-----');
  };
  return (
    <div className="fixed inset-0 z-[100] bg-black/95 backdrop-blur-xl flex items-center justify-center p-4">
      <div className="bg-[#0a0a0a] border border-amber-900/60 p-8 rounded-2xl w-[600px] shadow-2xl">
        <h2 className="text-amber-500 text-xl font-black uppercase mb-2 flex items-center gap-2">
          <Key size={22}/> PGP Public Key
        </h2>
        <p className="text-gray-500 text-xs mb-6">Add your PGP public key so vendors can encrypt messages to you.</p>
        {existing && (
          <div className="mb-4 p-3 bg-green-900/20 border border-green-700/30 rounded-xl">
            <p className="text-green-400 text-xs">✓ PGP key already set. You can update it below.</p>
          </div>
        )}
        <textarea
          value={pgpKey}
          onChange={e => setPgpKey(e.target.value)}
          placeholder="-----BEGIN PGP PUBLIC KEY BLOCK-----&#10;...&#10;-----END PGP PUBLIC KEY BLOCK-----"
          rows={10}
          className="w-full bg-black border border-amber-900/40 p-4 rounded-xl text-xs text-amber-400 font-mono outline-none resize-none"
        />
        <div className="flex gap-4 mt-4">
          <button onClick={onClose} className="flex-1 py-3 border border-white/10 text-gray-500 rounded-xl hover:bg-white/5">Cancel</button>
          <button onClick={handleSave} className={`flex-1 py-3 font-black uppercase rounded-xl transition-all ${saved ? 'bg-green-600 text-white' : 'bg-amber-600 text-black hover:bg-amber-500'}`}>
            {saved ? '✓ Saved!' : 'Save PGP Key'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// DEPOSIT MODAL - REAL XMR DEPOSIT
// ============================================================
function DepositModal({ isOpen, onClose, user }) {
  const [copied, setCopied] = React.useState(false);
  const [depositStatus, setDepositStatus] = React.useState(null);
  const [polling, setPolling] = React.useState(false);
  const [depositAddress, setDepositAddress] = React.useState('');
  const [isRealAddress, setIsRealAddress] = React.useState(false);
  const [loadingAddr, setLoadingAddr] = React.useState(false);

  // Fetch real deposit address from backend (creates real XMR subaddress if RPC available)
  React.useEffect(() => {
    if (!isOpen || !user?.username) return;
    setLoadingAddr(true);
    const sessionData = JSON.parse(localStorage.getItem('silkGenesis_session') || '{}');
    const token = sessionData.session_token;
    fetch(`/api/wallet/deposit-address/${user.username}`)
      .then(r => {
        if (!r.ok) {
          throw new Error(`HTTP_${r.status}`);
        }
        return r.json();
      })
      .catch((e) => {
        // Retry with bearer token for secured backend routes.
        if (token) {
          return fetch(`/api/wallet/deposit-address/${user.username}`, {
            headers: { Authorization: `Bearer ${token}` }
          }).then(r2 => r2.json());
        }
        throw e;
      })
      .then(d => {
        if (d.address && d.address.startsWith('8')) {
          setDepositAddress(d.address);
          setIsRealAddress(d.real === true);
        } else {
          setDepositAddress('');
        }
      })
      .catch(() => {
        setDepositAddress('');
      })
      .finally(() => setLoadingAddr(false));
  }, [isOpen, user]);

  const handleCopy = () => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(depositAddress).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    }
  };

  // Polling du statut de deposit toutes les 15s
  React.useEffect(() => {
    if (!isOpen || !depositAddress) return;
    setPolling(true);
    const poll = async () => {
      try {
        const sessionData = JSON.parse(localStorage.getItem('silkGenesis_session') || '{}');
        const token = sessionData.session_token;
        const resp = await fetch(`/api/deposit/status/${depositAddress}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (resp.ok) {
          const data = await resp.json();
          if (data.status !== 'not_found') setDepositStatus(data);
        }
      } catch(e) {}
    };
    poll();
    const interval = setInterval(poll, 15000);
    return () => { clearInterval(interval); setPolling(false); };
  }, [isOpen, depositAddress]);

  if (!isOpen) return null;

  // QR generated locally by backend (offline, no third-party service)
  const qrUrl = depositAddress
    ? `/api/qr/monero?address=${encodeURIComponent(depositAddress)}&size=180`
    : null;

  return (
    <div className="fixed inset-0 z-[100] bg-black/95 backdrop-blur-xl flex items-center justify-center p-4">
      <div className="bg-[#0a0a0a] border border-amber-900/60 p-8 rounded-2xl w-[520px] shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-amber-500 text-xl font-black uppercase flex items-center gap-2">
            <Wallet size={24}/> Deposit XMR
          </h2>
          <button onClick={onClose} className="text-gray-500 hover:text-white text-2xl leading-none">×</button>
        </div>

        {/* Status banner si deposit detecte */}
        {depositStatus && depositStatus.received_xmr > 0 && (
          <div className="mb-4 p-3 rounded-xl border" style={{
            background: depositStatus.status === 'confirmed' ? 'rgba(34,197,94,0.1)' : 'rgba(249,115,22,0.1)',
            borderColor: depositStatus.status === 'confirmed' ? '#22c55e' : '#f97316'
          }}>
            <p className="font-bold text-sm" style={{ color: depositStatus.status === 'confirmed' ? '#22c55e' : '#f97316' }}>
              {depositStatus.status === 'confirmed' ? '✅ Deposit Confirmed!' : '⏳ Transaction Detected'}
            </p>
            <p className="text-xs text-gray-400 mt-1">
              {depositStatus.received_xmr?.toFixed(6)} XMR - {depositStatus.confirmations}/{depositStatus.confirmations_needed || 10} confirmations
            </p>
          </div>
        )}

        {/* QR Code */}
        {qrUrl ? (
          <div className="flex justify-center mb-5">
            <div className="p-3 border-2 border-amber-600 rounded-xl bg-black inline-block">
              <AuthenticatedMoneroQrImg srcPathWithQuery={qrUrl} size={180} alt="XMR QR Code" />
            </div>
          </div>
        ) : null}

        {/* Address */}
        <div className="bg-black p-4 rounded-xl border border-white/5 mb-4">
          <p className="text-[10px] text-gray-500 mb-2 uppercase tracking-widest">Your Unique Deposit Address:</p>
          <div className="flex items-start gap-3">
            <code className="text-[11px] text-amber-500 break-all font-mono flex-1 leading-relaxed">{depositAddress || "SUBADDRESS UNAVAILABLE (RPC OFFLINE)"}</code>
            <button onClick={handleCopy}
              className="shrink-0 px-3 py-2 rounded-lg text-xs font-bold transition-all"
              style={{ background: copied ? '#22c55e' : '#374151', color: 'white' }}>
              {copied ? '✓ Copied' : '📋 Copy'}
            </button>
          </div>
        </div>

        {/* Instructions */}
        <div className="bg-blue-950/30 border border-blue-900/40 rounded-xl p-4 mb-4">
          <p className="text-blue-400 text-xs font-bold mb-2">🔐 How to Deposit XMR</p>
          <ol className="text-gray-400 text-xs space-y-1 list-decimal list-inside leading-relaxed">
            <li>Copy your unique deposit address above</li>
            <li>Open your Monero wallet (GUI, CLI, or mobile)</li>
            <li>Send any amount of XMR to this address</li>
            <li>Wait for <strong className="text-amber-500">10 blockchain confirmations</strong> (~20 min)</li>
            <li>Your balance will update automatically</li>
          </ol>
        </div>

        {/* Polling indicator */}
        <p className="text-[10px] text-gray-600 text-center mb-4">
          🔄 Auto-checking for incoming transactions every 15 seconds...
        </p>

        <button onClick={onClose}
          className="w-full py-3 border border-white/10 text-gray-500 rounded-xl hover:bg-white/5 font-bold">
          Close
        </button>
      </div>
    </div>
  );
}


// ============================================================
// PGP CHAT STATUS - Displays si le chat est encrypted PGP ou non
// ============================================================
function PGPChatStatus({ buyer, vendor }) {
  const [buyerSetupReady, setBuyerSetupReady] = React.useState(null);
  const [vendorSetupReady, setVendorSetupReady] = React.useState(null);

  React.useEffect(() => {
    if (buyer) {
      fetch(`/api/pgp/${buyer}`)
        .then(r => r.json())
        .then(d => setBuyerSetupReady(!!d.pgp_setup_completed))
        .catch(() => setBuyerSetupReady(false));
    }
    if (vendor) {
      fetch(`/api/pgp/${vendor}`)
        .then(r => r.json())
        .then(d => setVendorSetupReady(!!d.pgp_setup_completed))
        .catch(() => setVendorSetupReady(false));
    }
  }, [buyer, vendor]);

  const bothReady = buyerSetupReady && vendorSetupReady;
  const noneReady = buyerSetupReady === false && vendorSetupReady === false;

  if (bothReady) {
    return (
      <div className="flex items-center gap-2 bg-green-900/10 border border-green-600/20 px-3 py-2 rounded-lg">
        <Lock size={14} className="text-green-500 animate-pulse"/>
        <span className="text-green-500 text-[9px] font-black uppercase">🔐 PGP Encrypted - Both parties completed setup</span>
      </div>
    );
  }

  if (noneReady) {
    return (
      <div className="flex items-center gap-2 bg-red-900/10 border border-red-600/30 px-3 py-2 rounded-lg">
        <Unlock size={14} className="text-red-500 animate-pulse"/>
        <span className="text-red-400 text-[9px] font-black uppercase">⚠️ SETUP REQUIRED - Both parties must complete PGP setup in Identity.</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 bg-yellow-900/10 border border-yellow-600/30 px-3 py-2 rounded-lg">
      <Unlock size={14} className="text-yellow-500"/>
      <span className="text-yellow-400 text-[9px] font-black uppercase">
        ⚠️ PARTIAL SETUP - {!buyerSetupReady ? 'Buyer' : 'Vendor'} must finish PGP setup in Identity.
      </span>
    </div>
  );
}

// ============================================================
// SILKGENESIS PGP COMPONENTS
// ============================================================
// PGPPrivateKeyModal - Shown ONCE after registration
// PGPKeySection - Full PGP management in user profile
// EncryptedMessageBubble - Chat message display with decrypt button
// ============================================================

// ============================================================
// PGP PRIVATE KEY MODAL
// Shown ONCE after registration - private key NEVER shown again
// ============================================================
/**
 * SILKGENESIS - Monero Checkout & Release Funds Components
 * 
 * MoneroCheckout: Displays l'address de deposit + QR code + polling du statut
 * ReleaseFundsButton: Bouton "Release the Funds" pour le buyer apres reception
 * OrderPaymentStatus: Statut de payment en temps reel
 */

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
        const resp = await fetch(`/api/order/${orderId}/payment`);
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
      const sessionData = JSON.parse(localStorage.getItem('silkGenesis_session') || '{}');
      const token = sessionData.session_token;
      
      const resp = await fetch(`/api/orders/${orderId}/release`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ buyer_username: currentUser })
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

function PGPPrivateKeyModal({ isOpen, onClose, pgpData }) {
  const [copied, setCopied] = React.useState(false);
  const [confirmed, setConfirmed] = React.useState(false);

  if (!isOpen || !pgpData) return null;

  const copyPrivateKey = () => {
    navigator.clipboard.writeText(pgpData.pgp_private_key_encrypted || '');
    setCopied(true);
    setTimeout(() => setCopied(false), 3000);
  };

  const downloadKey = () => {
    const blob = new Blob([pgpData.pgp_private_key_encrypted || ''], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'silkgenesis_private_key.asc';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-[200] bg-black/98 backdrop-blur-xl flex items-center justify-center p-4">
      <div className="bg-[#0a0a0a] border-2 border-red-600/60 p-8 rounded-2xl w-[700px] max-h-[90vh] overflow-y-auto shadow-2xl shadow-red-900/20">
        <div className="flex items-center gap-3 mb-6 pb-4 border-b border-red-900/30">
          <div className="w-10 h-10 bg-red-900/20 border border-red-600/40 rounded-xl flex items-center justify-center text-xl">🔐</div>
          <div>
            <h2 className="text-red-400 text-xl font-black uppercase">⚠️ SAVE YOUR PRIVATE KEY</h2>
            <p className="text-[10px] text-red-700 uppercase tracking-widest">This is shown ONCE - Never again</p>
          </div>
        </div>

        <div className="bg-red-900/10 border border-red-600/30 p-4 rounded-xl mb-6">
          <p className="text-red-400 text-xs font-black uppercase mb-2">⚠️ CRITICAL SECURITY NOTICE</p>
          <ul className="text-[11px] text-red-300/80 space-y-1 list-disc list-inside">
            <li>This private key is <span className="font-black text-red-400">NEVER stored on the server</span></li>
            <li>Without it, you <span className="font-black text-red-400">CANNOT decrypt</span> messages sent to you</li>
            <li>Save it in a secure location (KeePass, encrypted USB, paper)</li>
            <li>Your passphrase is your <span className="font-black text-amber-400">account password</span></li>
          </ul>
        </div>

        {pgpData.pgp_fingerprint && (
          <div className="bg-black/60 border border-amber-900/20 p-4 rounded-xl mb-4">
            <p className="text-[9px] text-gray-500 uppercase mb-1">Key Fingerprint:</p>
            <code className="text-amber-500 text-[11px] font-mono tracking-wider break-all">{pgpData.pgp_fingerprint}</code>
          </div>
        )}

        <div className="mb-6">
          <p className="text-[9px] text-gray-500 uppercase mb-2">Your Encrypted Private Key (protected by your password):</p>
          <textarea
            readOnly
            value={pgpData.pgp_private_key_encrypted || ''}
            rows={10}
            className="w-full bg-black border border-red-900/40 p-4 rounded-xl text-[10px] text-red-300 font-mono outline-none resize-none"
          />
        </div>

        <div className="flex gap-4 mb-6">
          <button onClick={copyPrivateKey}
            className={`flex-1 py-3 rounded-xl font-black text-[11px] uppercase transition-all flex items-center justify-center gap-2 ${copied ? 'bg-green-600 text-black' : 'bg-amber-900/20 border border-amber-600/40 text-amber-500 hover:bg-amber-600 hover:text-black'}`}>
            {copied ? '✓ COPIED!' : '📋 Copy Private Key'}
          </button>
          <button onClick={downloadKey}
            className="flex-1 py-3 bg-blue-900/20 border border-blue-600/40 text-blue-400 rounded-xl font-black text-[11px] uppercase hover:bg-blue-600 hover:text-black transition-all flex items-center justify-center gap-2">
            💾 Download .asc File
          </button>
        </div>

        <div className="bg-amber-900/10 border border-amber-900/30 p-4 rounded-xl mb-6">
          <label className="flex items-start gap-3 cursor-pointer">
            <input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)}
              className="mt-1 w-4 h-4 accent-amber-500"/>
            <span className="text-[11px] text-amber-400">
              I understand that this private key will <span className="font-black">NEVER be shown again</span>.
              I have saved it securely. My passphrase is my account password.
            </span>
          </label>
        </div>

        <button
          onClick={onClose}
          disabled={!confirmed}
          className={`w-full py-4 rounded-xl font-black uppercase text-[12px] transition-all ${confirmed ? 'bg-amber-600 text-black hover:bg-amber-500' : 'bg-gray-900 text-gray-700 cursor-not-allowed'}`}>
          {confirmed ? '✓ I Have Saved My Key - Enter Market' : 'Check the box above to continue'}
        </button>
      </div>
    </div>
  );
}

// ============================================================
// PGP KEY SECTION - In user profile
// ============================================================
function PGPKeySection({ user, onSetupComplete, currentToken, onSessionExpired }) {
  const [pgpData, setPgpData] = React.useState(null);
  const [showPrivateKey, setShowPrivateKey] = React.useState(false);
  const [privateKeyData, setPrivateKeyData] = React.useState(null);
  const [password, setPassword] = React.useState('');
  const [newPubKey, setNewPubKey] = React.useState('');
  const [validating, setValidating] = React.useState(false);
  const [saveStatus, setSaveStatus] = React.useState('');
  const [copiedPub, setCopiedPub] = React.useState(false);
  const [copiedFp, setCopiedFp] = React.useState(false);
  const [setupPassword, setSetupPassword] = React.useState('');
  const [setupLoading, setSetupLoading] = React.useState(false);
  const [setupStatus, setSetupStatus] = React.useState('');
  const [showAdvancedImport, setShowAdvancedImport] = React.useState(false);
  const [autoDecryptKey, setAutoDecryptKey] = React.useState('');
  const [autoDecryptPassphrase, setAutoDecryptPassphrase] = React.useState('');
  const [autoDecryptStatus, setAutoDecryptStatus] = React.useState('');

  const getSessionToken = () => {
    if (currentToken) return currentToken;
    try {
      const sessionData = JSON.parse(localStorage.getItem('silkGenesis_session') || '{}');
      return sessionData.session_token || '';
    } catch {
      return '';
    }
  };

  const handleSessionExpired = () => {
    if (onSessionExpired) {
      onSessionExpired();
      return;
    }
    localStorage.removeItem('silkGenesis_session');
    alert('Session expired. Please login again.');
    window.location.reload();
  };

  const loadPGPData = React.useCallback(async () => {
    try {
      const res = await fetch('/api/pgp/' + user.username);
      if (res.ok) {
        const data = await res.json();
        setPgpData(data);
        if (data?.pgp_setup_completed && onSetupComplete) {
          onSetupComplete();
        }
      }
    } catch(e) {}
  }, [user.username, onSetupComplete]);

  React.useEffect(() => { loadPGPData(); }, [loadPGPData]);

  const fetchPrivateKey = async () => {
    if (!password) { alert('Enter your password to retrieve your private key'); return; }
    try {
      const token = getSessionToken();
      const res = await fetch('/api/pgp/' + user.username + '/private?password=' + encodeURIComponent(password), {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      const data = await res.json();
      if (res.ok && data.pgp_private_key_encrypted) {
        setPrivateKeyData(data);
        setShowPrivateKey(true);
        setPassword('');
      } else {
        if (data?.detail === 'SESSION_TOKEN_REQUIRED' || data?.detail === 'INVALID_SESSION') {
          handleSessionExpired();
          return;
        }
        if (data?.detail === 'PGP_PRIVATE_KEY_ALREADY_VIEWED') {
          alert('Private key retrieval is disabled after one-time setup.');
        } else {
          alert(data.detail || 'Error retrieving private key');
        }
      }
    } catch(e) { alert('Connection error'); }
  };

  const runMandatorySetup = async () => {
    if (!setupPassword) {
      setSetupStatus('❌ Enter your account password.');
      return;
    }
    setSetupLoading(true);
    setSetupStatus('');
    try {
      const token = getSessionToken();
      const res = await fetch('/api/pgp/setup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ username: user.username, password: setupPassword })
      });
      const data = await res.json();
      if (res.ok && data.status === 'success') {
        setSetupStatus('✅ PGP setup completed. Save your private key now.');
        setPrivateKeyData(data);
        setShowPrivateKey(true);
        if (data?.pgp_private_key_encrypted && setupPassword) {
          sessionStorage.setItem('silkGenesis_pgp_private_key', data.pgp_private_key_encrypted);
          sessionStorage.setItem('silkGenesis_pgp_passphrase', setupPassword);
          setAutoDecryptStatus('✅ Auto-decrypt enabled for this session.');
        }
        setSetupPassword('');
        if (onSetupComplete) onSetupComplete();
        loadPGPData();
      } else {
        if (data?.detail === 'SESSION_TOKEN_REQUIRED' || data?.detail === 'INVALID_SESSION') {
          handleSessionExpired();
          return;
        }
        setSetupStatus('❌ ' + (data.detail || data.message || 'Setup failed'));
      }
    } catch (e) {
      setSetupStatus('❌ Connection error');
    } finally {
      setSetupLoading(false);
    }
  };

  const savePubKey = async () => {
    if (!newPubKey.trim()) return;
    setValidating(true);
    setSaveStatus('');
    try {
      const valRes = await fetch('/api/pgp/validate', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ pgp_key: newPubKey })
      });
      const valData = await valRes.json();
      if (!valData.valid) {
        setSaveStatus('❌ Invalid PGP key: ' + valData.error);
        setValidating(false);
        return;
      }
      const res = await fetch('/api/pgp/set', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(getSessionToken() ? { 'Authorization': `Bearer ${getSessionToken()}` } : {})
        },
        body: JSON.stringify({ username: user.username, pgp_key: newPubKey })
      });
      const data = await res.json();
      if (data.status === 'success') {
        setSaveStatus('✅ PGP key saved! Fingerprint: ' + data.fingerprint);
        setNewPubKey('');
        loadPGPData();
      } else {
        setSaveStatus('❌ Error: ' + (data.detail || data.error));
      }
    } catch(e) {
      setSaveStatus('❌ Connection error');
    } finally {
      setValidating(false);
    }
  };

  const enableAutoDecrypt = async () => {
    if (!autoDecryptKey.trim()) {
      setAutoDecryptStatus('❌ Paste your private key first.');
      return;
    }
    if (!autoDecryptPassphrase.trim()) {
      setAutoDecryptStatus('❌ Enter your account password/passphrase.');
      return;
    }
    try {
      if (!window.openpgp) {
        setAutoDecryptStatus('❌ OpenPGP library not loaded. Refresh the page to load crypto dependencies.');
        return;
      }
      const privKeyObj = await window.openpgp.readPrivateKey({ armoredKey: autoDecryptKey });
      await window.openpgp.decryptKey({ privateKey: privKeyObj, passphrase: autoDecryptPassphrase });
      sessionStorage.setItem('silkGenesis_pgp_private_key', autoDecryptKey);
      sessionStorage.setItem('silkGenesis_pgp_passphrase', autoDecryptPassphrase);
      setAutoDecryptStatus('✅ Auto-decrypt enabled for this session.');
    } catch (e) {
      setAutoDecryptStatus(`❌ Invalid key or passphrase: ${e.message}`);
    }
  };

  const disableAutoDecrypt = () => {
    sessionStorage.removeItem('silkGenesis_pgp_private_key');
    sessionStorage.removeItem('silkGenesis_pgp_passphrase');
    setAutoDecryptStatus('✅ Auto-decrypt disabled.');
  };

  const hasPGP = pgpData && pgpData.has_pgp;
  const requiresMandatorySetup = user?.role !== 'admin' && !pgpData?.pgp_setup_completed;
  const setupCompleted = !!pgpData?.pgp_setup_completed;
  const keyAlgorithmLabel = (pgpData?.pgp_public_key || pgpData?.pgp_key || '').includes('Ed25519') ? 'Ed25519' : 'RSA';

  return (
    <div className="bg-[#111] border border-amber-900/20 rounded-3xl p-8 shadow-2xl space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-amber-500 text-sm font-black uppercase flex items-center gap-2">
          🔐 PGP Encryption Keys
        </h3>
        <div className={`px-3 py-1 rounded-lg text-[9px] font-black uppercase border ${hasPGP ? 'bg-green-900/20 border-green-600/40 text-green-400' : 'bg-red-900/20 border-red-600/40 text-red-400'}`}>
          {hasPGP ? '🔒 ENCRYPTED' : '⚠️ NO KEY'}
        </div>
      </div>

      <div className={`rounded-xl p-4 border ${requiresMandatorySetup ? 'bg-red-900/10 border-red-600/30' : 'bg-green-900/10 border-green-600/30'}`}>
        {requiresMandatorySetup ? (
          <>
            <p className="text-red-300 text-[11px] font-black uppercase mb-2">Quick setup required to unlock messaging</p>
            <p className="text-[10px] text-gray-200">
              One-time setup only: type your account password, click setup, then copy and store your private key.
            </p>
          </>
        ) : (
          <>
            <p className="text-green-300 text-[11px] font-black uppercase mb-2">PGP ready</p>
            <p className="text-[10px] text-gray-200">
              Your encrypted messaging identity is active. You can copy your fingerprint/public key below anytime.
            </p>
          </>
        )}
      </div>

      <div className="bg-black/40 border border-cyan-900/30 p-4 rounded-xl space-y-3">
        <p className="text-cyan-300 text-[10px] font-black uppercase">Auto decrypt for chat (buyer/vendor)</p>
        <p className="text-[10px] text-gray-400">
          Enable once per session to decrypt incoming PGP messages automatically in chat.
        </p>
        <textarea
          value={autoDecryptKey}
          onChange={e => setAutoDecryptKey(e.target.value)}
          placeholder={"-----BEGIN PGP PRIVATE KEY BLOCK-----\n...\n-----END PGP PRIVATE KEY BLOCK-----"}
          rows={4}
          className="w-full bg-black border border-cyan-900/30 p-3 rounded-xl text-[10px] text-cyan-300 font-mono outline-none resize-none"
        />
        <div className="flex gap-3">
          <input
            type="password"
            value={autoDecryptPassphrase}
            onChange={e => setAutoDecryptPassphrase(e.target.value)}
            placeholder="Account password / key passphrase"
            className="flex-1 bg-black border border-cyan-900/30 p-3 rounded-xl text-[11px] text-cyan-200 outline-none font-mono"
          />
          <button
            onClick={enableAutoDecrypt}
            className="px-4 py-3 bg-cyan-900/20 border border-cyan-600/40 text-cyan-300 rounded-xl text-[10px] font-black hover:bg-cyan-600 hover:text-black transition-all"
          >
            Enable Auto
          </button>
          <button
            onClick={disableAutoDecrypt}
            className="px-4 py-3 bg-gray-900 border border-white/10 text-gray-300 rounded-xl text-[10px] font-black hover:bg-white/10 transition-all"
          >
            Disable
          </button>
        </div>
        {autoDecryptStatus && (
          <p className={`text-[10px] font-mono ${autoDecryptStatus.startsWith('✅') ? 'text-green-400' : 'text-red-400'}`}>
            {autoDecryptStatus}
          </p>
        )}
      </div>

      {requiresMandatorySetup && (
        <div className="bg-red-900/10 border border-red-600/30 p-5 rounded-xl space-y-4">
          <div>
            <p className="text-red-400 text-[11px] font-black mb-2 uppercase">Mandatory PGP setup required</p>
            <p className="text-[10px] text-gray-300">
              Messaging is locked until setup is done once. Steps: enter your account password, click setup, then save your private key safely.
            </p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-[10px]">
            <div className="bg-black/50 border border-white/10 rounded-lg p-2 text-gray-300">1. Confirm password</div>
            <div className="bg-black/50 border border-white/10 rounded-lg p-2 text-gray-300">2. Generate keys</div>
            <div className="bg-black/50 border border-white/10 rounded-lg p-2 text-gray-300">3. Save private key</div>
          </div>
          <div className="flex gap-3">
            <input
              type="password"
              value={setupPassword}
              onChange={e => setSetupPassword(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && runMandatorySetup()}
              placeholder="Your account password"
              className="flex-1 bg-black border border-red-900/30 p-3 rounded-xl text-[11px] text-red-200 outline-none font-mono"
            />
            <button
              onClick={runMandatorySetup}
              disabled={setupLoading}
              className="px-4 py-3 bg-red-900/20 border border-red-600/40 text-red-400 rounded-xl text-[10px] font-black hover:bg-red-600 hover:text-black transition-all disabled:opacity-50"
            >
              {setupLoading ? '⏳ Setting up...' : 'Setup secure messaging now'}
            </button>
          </div>
          {setupStatus && (
            <p className={`text-[10px] mt-2 font-mono ${setupStatus.startsWith('✅') ? 'text-green-400' : 'text-red-400'}`}>{setupStatus}</p>
          )}
        </div>
      )}

      {(hasPGP || setupCompleted) && pgpData && (
        <div className="space-y-4">
          {pgpData.pgp_fingerprint && (
            <div className="bg-black/60 border border-amber-900/20 p-4 rounded-xl">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[9px] text-gray-500 uppercase">Key Fingerprint</p>
                <button onClick={() => { navigator.clipboard.writeText(pgpData.pgp_fingerprint); setCopiedFp(true); setTimeout(() => setCopiedFp(false), 2000); }}
                  className={`text-[9px] px-2 py-1 rounded transition-all ${copiedFp ? 'bg-green-600 text-black' : 'bg-amber-900/20 text-amber-500 hover:bg-amber-600 hover:text-black'}`}>
                  {copiedFp ? '✓ Copied' : '📋 Copy'}
                </button>
              </div>
              <code className="text-amber-500 text-[10px] font-mono tracking-wider break-all">{pgpData.pgp_fingerprint}</code>
              <p className="text-[9px] text-gray-500 mt-2">Algorithm: {keyAlgorithmLabel}</p>
            </div>
          )}

          <div className="bg-black/60 border border-green-900/20 p-4 rounded-xl">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[9px] text-gray-500 uppercase">Public Key (share freely)</p>
              <button onClick={() => { navigator.clipboard.writeText(pgpData.pgp_public_key || pgpData.pgp_key || ''); setCopiedPub(true); setTimeout(() => setCopiedPub(false), 2000); }}
                className={`text-[9px] px-2 py-1 rounded transition-all ${copiedPub ? 'bg-green-600 text-black' : 'bg-green-900/20 text-green-400 hover:bg-green-600 hover:text-black'}`}>
                {copiedPub ? '✓ Copied' : '📋 Copy'}
              </button>
            </div>
            <textarea readOnly value={pgpData.pgp_public_key || pgpData.pgp_key || ''} rows={4}
              className="w-full bg-transparent text-[9px] text-green-400 font-mono outline-none resize-none"/>
          </div>

          <div className="bg-black/60 border border-red-900/20 p-4 rounded-xl">
            <p className="text-[9px] text-gray-500 uppercase mb-3">Retrieve Encrypted Private Key</p>
            <p className="text-[10px] text-gray-600 mb-3">Enter your password to retrieve your encrypted private key.</p>
            <div className="flex gap-3">
              <input type="password" placeholder="Your account password" value={password} onChange={e => setPassword(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && fetchPrivateKey()}
                className="flex-1 bg-black border border-red-900/30 p-3 rounded-xl text-[11px] text-red-300 outline-none font-mono"/>
              <button onClick={fetchPrivateKey}
                className="px-4 py-3 bg-red-900/20 border border-red-600/40 text-red-400 rounded-xl text-[10px] font-black hover:bg-red-600 hover:text-black transition-all">
                🔑 Retrieve
              </button>
            </div>
          </div>

          {showPrivateKey && privateKeyData && (
            <div className="bg-black/80 border border-red-600/40 p-4 rounded-xl">
              <div className="flex items-center justify-between mb-3">
                <p className="text-[9px] text-red-400 uppercase font-black">⚠️ Encrypted Private Key</p>
                <button onClick={() => { navigator.clipboard.writeText(privateKeyData.pgp_private_key_encrypted); alert('Private key copied!'); }}
                  className="text-[9px] px-2 py-1 bg-red-900/20 border border-red-600/40 text-red-400 rounded hover:bg-red-600 hover:text-black transition-all">
                  📋 Copy
                </button>
              </div>
              <textarea readOnly value={privateKeyData.pgp_private_key_encrypted || ''} rows={8}
                className="w-full bg-transparent text-[9px] text-red-300 font-mono outline-none resize-none"/>
              <p className="text-[9px] text-gray-600 mt-2 italic">Protected by your account password (AES-256). The server cannot decrypt this.</p>
              <p className="text-[9px] text-gray-500 mt-1">
                Short private key length is normal when algorithm is Ed25519. It is modern and secure.
              </p>
              <button onClick={() => setShowPrivateKey(false)} className="mt-2 text-[9px] text-gray-600 hover:text-gray-400">Hide</button>
            </div>
          )}
        </div>
      )}

      {!hasPGP && (
        <div className="bg-red-900/5 border border-red-900/20 p-4 rounded-xl">
          <p className="text-red-400 text-[11px] font-black mb-2">⚠️ No PGP key configured</p>
          <p className="text-[10px] text-gray-500 mb-4">
            A PGP key was automatically generated when you registered.
            If you lost it, you can import an external public key below.
          </p>
        </div>
      )}

      <div className="border-t border-white/5 pt-6">
        <button
          onClick={() => setShowAdvancedImport(prev => !prev)}
          className="w-full py-3 border border-amber-900/30 rounded-xl text-[10px] text-amber-300 hover:bg-amber-900/10 transition-all"
        >
          {showAdvancedImport ? 'Hide advanced key import' : 'Advanced: import external public key'}
        </button>
        {showAdvancedImport && (
          <div className="mt-3">
            <p className="text-[9px] text-gray-500 uppercase mb-3">
              {hasPGP ? 'Update Public Key (import external key)' : 'Import External PGP Public Key'}
            </p>
            <textarea
              value={newPubKey}
              onChange={e => setNewPubKey(e.target.value)}
              placeholder={"-----BEGIN PGP PUBLIC KEY BLOCK-----\n...\n-----END PGP PUBLIC KEY BLOCK-----"}
              rows={5}
              className="w-full bg-black border border-amber-900/30 p-4 rounded-xl text-[10px] text-amber-400 font-mono outline-none resize-none mb-3"
            />
            <button onClick={savePubKey} disabled={validating || !newPubKey.trim()}
              className={`w-full py-3 rounded-xl font-black text-[11px] uppercase transition-all ${validating ? 'bg-gray-900 text-gray-600' : newPubKey.trim() ? 'bg-amber-600 text-black hover:bg-amber-500' : 'bg-gray-900 text-gray-700 cursor-not-allowed'}`}>
              {validating ? '⏳ Validating...' : '✓ Save Public Key'}
            </button>
            {saveStatus && (
              <p className={`text-[10px] mt-2 font-mono ${saveStatus.startsWith('✅') ? 'text-green-400' : 'text-red-400'}`}>{saveStatus}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// ENCRYPTED MESSAGE BUBBLE - Chat display with decrypt button
// ============================================================
function EncryptedMessageBubble({ msg, currentUser, isOwn }) {
  const [decrypted, setDecrypted] = React.useState(null);
  const [showDecryptModal, setShowDecryptModal] = React.useState(false);
  const [privateKey, setPrivateKey] = React.useState('');
  const [passphrase, setPassphrase] = React.useState('');
  const [decryptError, setDecryptError] = React.useState('');
  const [decrypting, setDecrypting] = React.useState(false);

  const isEncrypted = msg.encrypted && msg.message && msg.message.includes('-----BEGIN PGP MESSAGE-----');

  React.useEffect(() => {
    const autoDecrypt = async () => {
      if (!isEncrypted || decrypted) return;
      try {
        const storedKey = sessionStorage.getItem('silkGenesis_pgp_private_key') || '';
        const storedPass = sessionStorage.getItem('silkGenesis_pgp_passphrase') || '';
        if (!storedKey || !window.openpgp) return;
        const privKeyObj = await window.openpgp.readPrivateKey({ armoredKey: storedKey });
        const unlockedKey = storedPass
          ? await window.openpgp.decryptKey({ privateKey: privKeyObj, passphrase: storedPass })
          : privKeyObj;
        const message = await window.openpgp.readMessage({ armoredMessage: msg.message });
        const { data } = await window.openpgp.decrypt({ message, decryptionKeys: unlockedKey });
        setDecrypted(data);
      } catch {
        // Silent fail: manual decrypt remains available.
      }
    };
    autoDecrypt();
  }, [isEncrypted, msg.message, decrypted]);

  const decryptLocally = async () => {
    if (!privateKey.trim()) { setDecryptError('Paste your private key'); return; }
    setDecrypting(true);
    setDecryptError('');
    try {
      if (window.openpgp) {
        const privKeyObj = await window.openpgp.readPrivateKey({ armoredKey: privateKey });
        const decryptedKey = passphrase
          ? await window.openpgp.decryptKey({ privateKey: privKeyObj, passphrase })
          : privKeyObj;
        const message = await window.openpgp.readMessage({ armoredMessage: msg.message });
        const { data } = await window.openpgp.decrypt({ message, decryptionKeys: decryptedKey });
        setDecrypted(data);
        setShowDecryptModal(false);
      } else {
        setDecryptError('OpenPGP library not loaded. Refresh page and try again.');
      }
    } catch(e) {
      setDecryptError('Decryption failed: ' + e.message);
    } finally {
      setDecrypting(false);
    }
  };

  if (!isEncrypted) {
    return (
      <div className={`max-w-[70%] p-4 rounded-xl ${isOwn ? 'bg-amber-900/20 border border-amber-900/40' : 'bg-white/5 border border-white/10'}`}>
        <p className="text-[10px] text-gray-500 mb-1">{msg.sender}</p>
        <p className="text-sm text-white">{msg.message}</p>
        {msg.pgp_warning && (
          <p className="text-[8px] text-yellow-600 mt-1">⚠️ {msg.pgp_warning}</p>
        )}
        <p className="text-[9px] text-gray-600 mt-2">{new Date(msg.timestamp).toLocaleTimeString()}</p>
      </div>
    );
  }

  return (
    <div className={`max-w-[75%] rounded-xl overflow-hidden border ${isOwn ? 'border-amber-900/40' : 'border-green-900/40'}`}>
      <div className={`px-4 py-2 flex items-center gap-2 ${isOwn ? 'bg-amber-900/20' : 'bg-green-900/20'}`}>
        <span className="text-sm">🔐</span>
        <span className="text-[9px] font-black uppercase text-green-400">PGP Encrypted Message</span>
        <span className="ml-auto text-[8px] text-gray-600">{msg.sender}</span>
      </div>

      <div className="bg-black/60 p-4">
        {decrypted ? (
          <div>
            <span className="text-[9px] text-green-400 font-black block mb-2">✓ DECRYPTED</span>
            <p className="text-sm text-white">{decrypted}</p>
          </div>
        ) : (
          <div>
            <div className="bg-black/40 border border-green-900/20 p-3 rounded-lg mb-3 max-h-20 overflow-hidden relative">
              <pre className="text-[8px] text-green-600 font-mono leading-relaxed overflow-hidden">
                {msg.message.substring(0, 200)}...
              </pre>
              <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-black/80 to-transparent"/>
            </div>
            <button
              onClick={() => setShowDecryptModal(true)}
              className="w-full py-2 bg-green-900/20 border border-green-600/40 text-green-400 rounded-lg text-[10px] font-black hover:bg-green-600 hover:text-black transition-all flex items-center justify-center gap-2">
              🔓 Decrypt with Private Key
            </button>
          </div>
        )}
      </div>

      <p className="text-[9px] text-gray-600 px-4 py-1 bg-black/40">{new Date(msg.timestamp).toLocaleTimeString()}</p>

      {showDecryptModal && (
        <div className="fixed inset-0 z-[300] bg-black/95 flex items-center justify-center p-4">
          <div className="bg-[#0a0a0a] border border-green-900/60 p-8 rounded-2xl w-[600px] shadow-2xl">
            <h3 className="text-green-400 text-lg font-black uppercase mb-2">🔓 Local Decryption</h3>
            <p className="text-[10px] text-gray-500 mb-6">
              Your private key is <span className="text-green-400 font-black">NEVER sent to the server</span>.
              Decryption happens entirely in your browser.
            </p>
            <div className="space-y-4">
              <div>
                <label className="text-[9px] text-gray-500 uppercase block mb-2">Your Private Key (armored)</label>
                <textarea
                  value={privateKey}
                  onChange={e => setPrivateKey(e.target.value)}
                  placeholder={"-----BEGIN PGP PRIVATE KEY BLOCK-----\n...\n-----END PGP PRIVATE KEY BLOCK-----"}
                  rows={8}
                  className="w-full bg-black border border-green-900/40 p-4 rounded-xl text-[10px] text-green-400 font-mono outline-none resize-none"
                />
              </div>
              <div>
                <label className="text-[9px] text-gray-500 uppercase block mb-2">Passphrase (your account password)</label>
                <input type="password" value={passphrase} onChange={e => setPassphrase(e.target.value)}
                  placeholder="Your account password"
                  className="w-full bg-black border border-amber-900/30 p-3 rounded-xl text-[11px] text-amber-400 outline-none"/>
              </div>
              {decryptError && (
                <div className="bg-red-900/10 border border-red-900/30 p-3 rounded-xl">
                  <pre className="text-[10px] text-red-400 whitespace-pre-wrap">{decryptError}</pre>
                </div>
              )}
              <div className="bg-black/60 border border-white/5 p-4 rounded-xl">
                <p className="text-[9px] text-gray-500 uppercase mb-2">Alternative: Decrypt with GPG CLI</p>
                <code className="text-[10px] text-amber-500 font-mono">echo "PGP_MESSAGE" | gpg --decrypt</code>
              </div>
              <div className="flex gap-4">
                <button onClick={() => { setShowDecryptModal(false); setDecryptError(''); }}
                  className="flex-1 py-3 border border-white/10 text-gray-500 rounded-xl hover:bg-white/5">Cancel</button>
                <button onClick={decryptLocally} disabled={decrypting}
                  className="flex-1 py-3 bg-green-600 text-black font-black rounded-xl hover:bg-green-500 disabled:opacity-50">
                  {decrypting ? '⏳ Decrypting...' : '🔓 Decrypt Locally'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


// ============================================================
// GENERAL CHAT MODAL
// ============================================================
function GeneralChatModal({ isOpen, onClose, buyer, vendor, currentUser, currentToken, authFetch }) {
  const [messages, setMessages] = useState([]);
  const [newMsg, setNewMsg] = useState('');
  const chatKey = `${buyer}_${vendor}`;

  useEffect(() => {
    if (isOpen && buyer && vendor) {
      loadMessages();
      const interval = setInterval(loadMessages, 3000);
      return () => clearInterval(interval);
    }
  }, [isOpen, buyer, vendor]);

  const loadMessages = async () => {
    try {
      const res = await fetch(`/api/chat/general/${buyer}/${vendor}`);
      const data = await res.json();
      setMessages(data.messages || []);
    } catch (e) { console.error("Error loading chat:", e); }
  };

  const sendMessage = async () => {
    if (!newMsg.trim()) return;
    try {
      // E2E: chiffrer cote client avec la cle publique du destinataire.
      const recipient = currentUser === buyer ? vendor : buyer;
      const { fetchUserPublicKey, encryptForRecipient } = await import('./pgpClient');
      let recipientPub;
      try {
        recipientPub = await fetchUserPublicKey((p) => silkGenesisApiUrl(p), recipient);
      } catch (e) {
        alert('Cannot fetch recipient PGP key.');
        return;
      }
      if (!recipientPub) {
        alert('Recipient has no PGP key. Chat blocked.');
        return;
      }
      let armored;
      try {
        armored = await encryptForRecipient(newMsg, recipientPub);
      } catch (e) {
        alert('Local PGP encryption failed: ' + (e?.message || e));
        return;
      }
      const res = await (authFetch || fetch)('/api/chat/general', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ buyer, vendor, sender: currentUser, message: armored, encrypted: true })
      });
      const data = await res.json();
      if (!res.ok) {
        if (data?.detail === 'PGP_SETUP_REQUIRED') {
          alert('Mandatory PGP setup is required for both users before chat. Complete setup in Identity.');
          return;
        }
        if (data?.detail === 'PGP_REQUIRED_FOR_CHAT' || data?.detail === 'MESSAGE_MUST_BE_PGP_ARMORED') {
          alert('PGP required for both users. Chat is blocked until both parties have a PGP key.');
          return;
        }
        if (data?.detail === 'SESSION_TOKEN_REQUIRED' || data?.detail === 'INVALID_SESSION') {
          alert('Session expired. Please log in again.');
          return;
        }
        alert(`Chat error: ${data?.detail || 'SEND_FAILED'}`);
        return;
      }
      setNewMsg('');
      loadMessages();
    } catch (e) { console.error("Error sending message:", e); }
  };

  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-[100] bg-black/95 backdrop-blur-xl flex items-center justify-center p-4">
      <div className="bg-[#0a0a0a] border border-amber-900/60 rounded-2xl w-[600px] h-[600px] shadow-2xl flex flex-col">
        <div className="p-6 border-b border-amber-900/30">
          <div className="flex justify-between items-center mb-3">
            <h2 className="text-amber-500 text-xl font-black uppercase flex items-center gap-2">
              <MessageSquare size={24}/> Chat with {vendor}
            </h2>
            <button onClick={onClose} className="text-gray-500 hover:text-white"><XCircle size={24}/></button>
          </div>
          <PGPChatStatus buyer={buyer} vendor={vendor} />
        </div>
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {messages.length === 0 ? (
            <div className="text-center text-gray-600 text-sm mt-20">
              <MessageSquare size={48} className="mx-auto mb-4 opacity-20"/>
              <p>No messages yet. Start the conversation!</p>
            </div>
          ) : messages.map(msg => (
            <div key={msg.id} className={`flex ${msg.sender === currentUser ? 'justify-end' : 'justify-start'}`}>
              <EncryptedMessageBubble msg={msg} currentUser={currentUser} isOwn={msg.sender === currentUser} />
            </div>
          ))}
        </div>
        <div className="p-6 border-t border-amber-900/30">
          <div className="flex gap-4">
            <input type="text" value={newMsg} onChange={(e) => setNewMsg(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
              placeholder="Type your message... (PGP encrypted)"
              className="flex-1 bg-black border border-amber-900/50 p-4 rounded-xl text-sm text-white outline-none"/>
            <button onClick={sendMessage} className="bg-amber-600 text-black px-8 rounded-xl font-black hover:bg-amber-500 transition-all">🔐 Send</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// ORDER CHAT MODAL
// ============================================================
function OrderChatModal({ isOpen, onClose, orderId, currentUser, currentToken, authFetch }) {
  const [messages, setMessages] = useState([]);
  const [newMsg, setNewMsg] = useState('');

  useEffect(() => {
    if (isOpen && orderId) {
      loadMessages();
      const interval = setInterval(loadMessages, 3000);
      return () => clearInterval(interval);
    }
  }, [isOpen, orderId]);

  const loadMessages = async () => {
    try {
      const res = await fetch(`/api/chat/order/${orderId}`);
      const data = await res.json();
      setMessages(data.messages || []);
    } catch (e) { console.error("Error loading order chat:", e); }
  };

  const sendMessage = async () => {
    if (!newMsg.trim()) return;
    try {
      // Lookup the order to discover the recipient.
      const orderRes = await (authFetch || fetch)(`/api/orders/${orderId}`);
      const orderJson = orderRes.ok ? await orderRes.json() : null;
      const order = orderJson?.order || orderJson;
      if (!order || !order.buyer || !order.vendor) {
        alert('Order not found.');
        return;
      }
      const recipient = currentUser === order.buyer ? order.vendor : order.buyer;
      const { fetchUserPublicKey, encryptForRecipient } = await import('./pgpClient');
      let recipientPub;
      try {
        recipientPub = await fetchUserPublicKey((p) => silkGenesisApiUrl(p), recipient);
      } catch (e) {
        alert('Cannot fetch recipient PGP key.');
        return;
      }
      if (!recipientPub) {
        alert('Recipient has no PGP key. Order chat blocked.');
        return;
      }
      let armored;
      try {
        armored = await encryptForRecipient(newMsg, recipientPub);
      } catch (e) {
        alert('Local PGP encryption failed: ' + (e?.message || e));
        return;
      }
      const res = await (authFetch || fetch)('/api/chat/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ order_id: orderId, sender: currentUser, message: armored })
      });
      const data = await res.json();
      if (!res.ok) {
        if (data?.detail === 'PGP_SETUP_REQUIRED') {
          alert('Mandatory PGP setup is required for both users before order chat. Complete setup in Identity.');
          return;
        }
        if (data?.detail === 'PGP_REQUIRED_FOR_CHAT' || data?.detail === 'MESSAGE_MUST_BE_PGP_ARMORED') {
          alert('PGP required for both users. Order chat is blocked.');
          return;
        }
        if (data?.detail === 'SESSION_TOKEN_REQUIRED' || data?.detail === 'INVALID_SESSION') {
          alert('Session expired. Please log in again.');
          return;
        }
        alert(`Chat error: ${data?.detail || 'SEND_FAILED'}`);
        return;
      }
      setNewMsg('');
      loadMessages();
    } catch (e) { console.error("Error sending message:", e); }
  };

  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-[100] bg-black/95 backdrop-blur-xl flex items-center justify-center p-4">
      <div className="bg-[#0a0a0a] border border-amber-900/60 rounded-2xl w-[600px] h-[600px] shadow-2xl flex flex-col">
        <div className="p-6 border-b border-amber-900/30 flex justify-between items-center">
          <h2 className="text-amber-500 text-xl font-black uppercase flex items-center gap-2">
            <Shield size={24}/> Order Chat #{orderId?.slice(-8)}
          </h2>
          <button onClick={onClose} className="text-gray-500 hover:text-white"><XCircle size={24}/></button>
        </div>
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {messages.length === 0 ? (
            <div className="text-center text-gray-600 text-sm mt-20">
              <Shield size={48} className="mx-auto mb-4 opacity-20"/>
              <p>No messages yet. Discuss your order here!</p>
            </div>
          ) : messages.map(msg => (
            <div key={msg.id} className={`flex ${msg.sender === currentUser ? 'justify-end' : 'justify-start'}`}>
              <EncryptedMessageBubble msg={msg} currentUser={currentUser} isOwn={msg.sender === currentUser} />
            </div>
          ))}
        </div>
        <div className="p-6 border-t border-amber-900/30">
          <div className="flex gap-4">
            <input type="text" value={newMsg} onChange={(e) => setNewMsg(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
              placeholder="Type your message... (PGP encrypted)"
              className="flex-1 bg-black border border-amber-900/50 p-4 rounded-xl text-sm text-white outline-none"/>
            <button onClick={sendMessage} className="bg-amber-600 text-black px-8 rounded-xl font-black hover:bg-amber-500 transition-all">🔐 Send</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function FounderVendorBadge({ compact = false }) {
  return (
    <span
      className="inline-flex items-center align-middle"
      title="SilkGenesis Founder Vendor — early verified vendor"
    >
      <span
        className={`relative isolate inline-flex items-center gap-2 rounded-full border border-amber-200/50 bg-gradient-to-b from-zinc-900 via-black to-zinc-950 text-amber-100 shadow-[0_0_0_1px_rgba(0,0,0,0.75),inset_0_1px_0_rgba(255,255,255,0.07),0_0_28px_rgba(234,179,8,0.18),0_8px_28px_rgba(0,0,0,0.55)] ${
          compact ? 'px-2.5 py-1' : 'px-4 py-2'
        }`}
      >
        <span
          className="pointer-events-none absolute inset-0 rounded-full bg-gradient-to-r from-amber-400/25 via-yellow-200/12 to-amber-500/20 opacity-90 blur-[10px] -z-10"
          aria-hidden
        />
        <span className="relative z-[1] inline-flex items-center gap-2">
          <Crown
            size={compact ? 12 : 14}
            strokeWidth={2.25}
            className="shrink-0 text-amber-300 drop-shadow-[0_0_8px_rgba(251,191,36,0.55)]"
          />
          <span
            className={`font-black uppercase tracking-[0.28em] leading-none bg-gradient-to-b from-amber-50 via-amber-200 to-amber-600 bg-clip-text text-transparent ${
              compact ? 'text-[8px]' : 'text-[10px]'
            }`}
          >
            {compact ? 'Founder' : (
              <>
                Founder<span className="mx-1.5 text-amber-400/80 font-light tracking-normal">·</span>Vendor
              </>
            )}
          </span>
        </span>
      </span>
    </span>
  );
}

// ============================================================
// VENDOR PROFILE PAGE
// ============================================================
function VendorProfilePage({ vendorName, products, onBack, onViewProduct, currentUser, authenticatedFetch, onBadgeUpdated }) {
  const [reviews, setReviews] = useState([]);
  const [avgRating, setAvgRating] = useState(0);
  const [totalReviews, setTotalReviews] = useState(0);
  const [vendorBadge, setVendorBadge] = useState(null);
  const [badgeSaving, setBadgeSaving] = useState(false);
  const vendorProducts = products.filter(p => p.vendor === vendorName);
  const totalSales = vendorProducts.reduce((sum, p) => sum + (p.sales || 0), 0);

  useEffect(() => {
    const loadReviews = async () => {
      try {
        const res = await fetch(`/api/reviews/${vendorName}`);
        if (res.ok) {
          const data = await res.json();
          setReviews(data.reviews || []);
          setAvgRating(data.average_rating || 0);
          setTotalReviews(data.total_reviews || 0);
        }
      } catch (e) { console.error("Error loading reviews:", e); }
    };
    loadReviews();
  }, [vendorName]);

  const isAdmin = currentUser?.role === 'admin';
  const toggleFounderBadge = async () => {
    if (!isAdmin || !authenticatedFetch || badgeSaving) return;
    setBadgeSaving(true);
    try {
      const res = await authenticatedFetch(`/api/admin/vendor/${vendorName}/founder-badge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !vendorBadge?.founder_vendor_badge }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(`Error: ${data?.detail || 'Unable to update founder badge'}`);
      } else {
        setVendorBadge({
          username: vendorName,
          founder_vendor_badge: !!data.founder_vendor_badge,
          founder_vendor_serial: data.founder_vendor_serial,
          founder_vendor_badge_label: data.founder_vendor_badge ? 'Founder Vendor' : null,
        });
        if (typeof onBadgeUpdated === 'function') onBadgeUpdated();
      }
    } catch {
      alert('Connection error while updating founder badge');
    } finally {
      setBadgeSaving(false);
    }
  };

  useEffect(() => {
    const loadVendorBadge = async () => {
      try {
        const res = await fetch(`/api/vendor/${vendorName}/badge`);
        if (!res.ok) {
          setVendorBadge(null);
          return;
        }
        const data = await res.json();
        setVendorBadge(data);
      } catch {
        setVendorBadge(null);
      }
    };
    loadVendorBadge();
  }, [vendorName]);

  return (
    <div className="animate-in fade-in duration-500">
      <button onClick={onBack} className="mb-6 flex items-center gap-2 text-amber-500 hover:text-amber-400 transition-all text-sm font-black uppercase">
        <ChevronRight size={20} className="rotate-180"/> Back to Market
      </button>
      <div className="bg-gradient-to-r from-amber-900/20 to-transparent border border-amber-900/20 rounded-3xl p-8 mb-8">
        <div className="flex items-center gap-6">
          <div className="w-24 h-24 bg-gradient-to-br from-amber-900/40 to-purple-900/40 rounded-2xl flex items-center justify-center text-4xl font-black text-amber-500 border-2 border-amber-600/30">
            {vendorName[0]}
          </div>
          <div className="flex-1">
            <h1 className="text-4xl font-black text-white mb-2 flex items-center gap-3">
              <span>{vendorName}</span>
              {vendorBadge?.founder_vendor_badge && (
                <FounderVendorBadge />
              )}
            </h1>
            <div className="flex items-center gap-6 text-sm">
              <div className="flex items-center gap-2">
                <Star size={16} className="fill-amber-500 text-amber-500"/>
                <span className="text-amber-500 font-black">{avgRating}</span>
                <span className="text-gray-600">({reviews.length} reviews)</span>
              </div>
              <div className="text-gray-500"><span className="text-white font-black">{totalSales}</span> total sales</div>
              <div className="text-gray-500"><span className="text-white font-black">{vendorProducts.length}</span> active listings</div>
            </div>
            {isAdmin && (
              <div className="mt-4">
                <button
                  type="button"
                  onClick={toggleFounderBadge}
                  disabled={badgeSaving}
                  className={`px-4 py-2 rounded-lg text-xs font-black uppercase tracking-wide border transition-all ${
                    vendorBadge?.founder_vendor_badge
                      ? 'border-red-500/40 text-red-300 hover:bg-red-900/20'
                      : 'border-amber-500/40 text-amber-300 hover:bg-amber-900/20'
                  } ${badgeSaving ? 'opacity-60 cursor-not-allowed' : ''}`}
                >
                  {badgeSaving
                    ? 'Saving...'
                    : vendorBadge?.founder_vendor_badge
                      ? 'Remove Founder Badge'
                      : 'Set Founder Badge'}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-6">
          <h2 className="text-2xl font-black text-white flex items-center gap-3"><Package size={24}/> Active Listings</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {vendorProducts.map(p => (
              <div key={p.id} onClick={() => onViewProduct(p)} className="bg-[#111] border border-white/5 p-4 rounded-xl hover:border-amber-900/30 transition-all cursor-pointer group">
                <div className="h-44 bg-black rounded-lg mb-4 overflow-hidden flex items-center justify-center">
                  {p.image ? <img loading="lazy" src={p.image} className="w-full h-full object-cover group-hover:scale-105 transition-all" alt={p.title}/> : <Package size={48} className="text-gray-800"/>}
                </div>
                <h4 className="text-lg text-white group-hover:text-amber-500 transition-colors truncate">{p.title}</h4>
                <div className="mt-4 flex justify-between items-end border-t border-white/5 pt-4">
                  <p className="text-xl text-amber-500 tracking-tighter italic">{parseFloat(p.price_xmr).toFixed(4)} XMR</p>
                  <p className="text-[9px] text-gray-600">{p.sales} sold</p>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="space-y-6">
          <h2 className="text-2xl font-black text-white flex items-center gap-3"><Star size={24} className="text-amber-500"/> Reviews ({totalReviews})</h2>
          <div className="space-y-4">
            {reviews.length === 0 ? (
              <div className="bg-[#111] border border-white/5 p-8 rounded-xl text-center">
                <Star size={32} className="mx-auto mb-2 opacity-10"/>
                <p className="text-gray-600 text-sm">No reviews yet</p>
              </div>
            ) : reviews.map((review, idx) => (
              <div key={review.id || idx} className="bg-[#111] border border-white/5 p-4 rounded-xl">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm text-gray-500">{review.buyer}</span>
                  <div className="flex items-center gap-1">
                    {[...Array(5)].map((_, i) => (
                      <Star key={i} size={12} className={i < review.rating ? "fill-amber-500 text-amber-500" : "text-gray-700"}/>
                    ))}
                  </div>
                </div>
                <p className="text-sm text-gray-300 mb-2">{review.comment}</p>
                <p className="text-[9px] text-gray-600">{review.date}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// PRODUCT DETAIL PAGE
// ============================================================
function ProductDetailPage({ product, user, onBack, onBuy, onContactVendor, onViewVendor, xmrRate = 352 }) {
  const [vendorStats, setVendorStats] = useState({ positive: 0, negative: 0 });
  const [escrowMode, setEscrowMode] = useState((parseFloat(product?.price_xmr || 0) >= 0.5) ? 'multisig' : 'standard');

  useEffect(() => {
    setEscrowMode((parseFloat(product?.price_xmr || 0) >= 0.5) ? 'multisig' : 'standard');
  }, [product?.id, product?.price_xmr]);

  useEffect(() => {
    const loadVendorStats = async () => {
      try {
        const res = await fetch(`/api/reviews/${product.vendor}`);
        if (res.ok) {
          const data = await res.json();
          const positive = data.reviews.filter(r => r.rating >= 4).length;
          const negative = data.reviews.filter(r => r.rating < 4).length;
          setVendorStats({ positive, negative });
        }
      } catch (e) { console.error("Error loading vendor stats:", e); }
    };
    if (product) loadVendorStats();
  }, [product]);

  if (!product) return null;
  return (
    <div className="animate-in fade-in duration-500">
      <button onClick={onBack} className="mb-6 flex items-center gap-2 text-amber-500 hover:text-amber-400 transition-all text-sm font-black uppercase">
        <ChevronRight size={20} className="rotate-180"/> Back to Market
      </button>
      <div className="bg-[#111] border border-amber-900/20 rounded-3xl overflow-hidden shadow-2xl">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 p-8">
          <div className="bg-black rounded-2xl h-96 flex items-center justify-center overflow-hidden">
            {product.image ? <img loading="lazy" src={product.image} className="w-full h-full object-cover" alt={product.title}/> : <Package size={96} className="text-gray-800"/>}
          </div>
          <div className="space-y-6">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[10px] bg-amber-900/20 border border-amber-900/40 text-amber-600 px-2 py-1 rounded uppercase">
                  <Tag size={10} className="inline mr-1"/>{product.category}
                </span>
              </div>
              <h1 className="text-4xl font-black text-white mb-2">{product.title}</h1>
              <div className="flex items-center gap-3">
                <p className="text-amber-500 text-sm flex items-center gap-2">
                  <UserIcon size={16}/> Vendor: 
                  <span onClick={onViewVendor} className="hover:text-amber-400 cursor-pointer underline decoration-dotted">{product.vendor}</span>
                </p>
                <div className="flex items-center gap-2">
                  <span className="text-green-500 text-xs font-black bg-green-900/20 px-2 py-1 rounded border border-green-600/30">+{vendorStats.positive}</span>
                  <span className="text-red-500 text-xs font-black bg-red-900/20 px-2 py-1 rounded border border-red-600/30">-{vendorStats.negative}</span>
                </div>
              </div>
              <p className="text-gray-600 text-xs mt-1">{product.sales || 0} sales</p>
            </div>
            <div className="bg-black/60 p-6 rounded-xl border border-amber-900/10">
              <p className="text-[10px] text-gray-500 mb-2 uppercase">Price:</p>
              <p className="text-4xl text-amber-500 font-black tracking-tighter">${(parseFloat(product.price_xmr) * xmrRate).toFixed(2)}</p>
              <p className="text-sm text-gray-600 mt-2">{parseFloat(product.price_xmr).toFixed(4)} XMR</p>
            </div>
            <div>
              <p className="text-[10px] text-gray-500 mb-3 uppercase">Description:</p>
              <p className="text-gray-300 text-sm leading-relaxed">{product.description}</p>
            </div>
            <div className="flex gap-4 pt-4">
              <button onClick={onContactVendor} className="flex-1 bg-white/5 border border-amber-900/40 text-amber-500 py-4 rounded-xl font-black hover:bg-amber-900/10 transition-all flex items-center justify-center gap-2 text-sm uppercase">
                <MessageSquare size={18}/> Contact Vendor
              </button>
              <button onClick={() => onBuy && onBuy(escrowMode)} className="flex-1 bg-amber-600 text-black py-4 rounded-xl font-black hover:bg-amber-500 transition-all flex items-center justify-center gap-2 text-sm uppercase">
                <ShieldCheck size={18}/> Buy Now
              </button>
            </div>
            <div className="bg-black/40 border border-white/10 p-4 rounded-xl">
              <p className="text-[10px] text-gray-500 uppercase mb-2">Escrow Mode</p>
              <div className="flex gap-2">
                <button
                  onClick={() => setEscrowMode('standard')}
                  className={`px-3 py-2 rounded-lg text-[10px] font-black uppercase transition-all ${escrowMode === 'standard' ? 'bg-amber-900/30 border border-amber-600 text-amber-400' : 'bg-white/5 border border-white/10 text-gray-500 hover:text-gray-300'}`}
                >
                  Standard (Fast)
                </button>
                <button
                  onClick={() => setEscrowMode('multisig')}
                  className={`px-3 py-2 rounded-lg text-[10px] font-black uppercase transition-all ${escrowMode === 'multisig' ? 'bg-purple-900/30 border border-purple-600 text-purple-300' : 'bg-white/5 border border-white/10 text-gray-500 hover:text-gray-300'}`}
                >
                  Multisig 2/3 (Safer)
                </button>
              </div>
            </div>
            <div className="bg-amber-900/10 border border-amber-900/20 p-4 rounded-xl">
              <p className="text-[9px] text-amber-600 uppercase mb-2">⚠️ Security Notice:</p>
              <p className="text-[10px] text-gray-500">Funds will be held in escrow until you confirm receipt. Always use the chat to communicate with the vendor.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}


// ============================================================

// ============================================================
// MNEMONIC SEED PHRASE COMPONENT (Admin only)
// ============================================================
function MnemonicViewer({ user }) {
  const [password, setPassword] = React.useState('');
  const [mnemonic, setMnemonic] = React.useState(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState(null);
  const [revealed, setRevealed] = React.useState(false);
  const [copied, setCopied] = React.useState(false);

  const fetchMnemonic = async () => {
    if (!password) { setError('Enter your admin password first'); return; }
    setLoading(true); setError(null);
    try {
      const res = await fetch('/api/wallet/mnemonic', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: user.username, password })
      });
      const data = await res.json();
      if (data.success) {
        setMnemonic(data);
        setRevealed(false);
      } else {
        setError(data.error || data.detail || 'Failed to retrieve mnemonic');
      }
    } catch (e) { setError('Connection error: ' + e.message); }
    setLoading(false);
  };

  const copyToClipboard = () => {
    if (mnemonic?.mnemonic) {
      navigator.clipboard.writeText(mnemonic.mnemonic);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    }
  };

  const words = mnemonic?.mnemonic ? mnemonic.mnemonic.split(' ') : [];

  return (
    <div className="bg-[#0a0a0a] border border-red-900/30 rounded-2xl p-6">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 bg-red-900/20 rounded-xl flex items-center justify-center">
          <span className="text-xl">🔑</span>
        </div>
        <div>
          <h3 className="text-white font-black text-lg">Master Wallet Seed Phrase</h3>
          <p className="text-[10px] text-red-400 uppercase font-black">⚠️ CRITICAL - Admin Only</p>
        </div>
      </div>

      <div className="bg-red-950/20 border border-red-900/30 rounded-xl p-4 mb-4">
        <p className="text-red-400 text-xs font-bold mb-1">⚠️ SECURITY WARNING</p>
        <ul className="text-[10px] text-red-300/70 space-y-1 list-disc list-inside">
          <li>This phrase gives FULL CONTROL over all marketplace funds</li>
          <li>Write it down on paper - NEVER store digitally</li>
          <li>Never share it with anyone, ever</li>
          <li>This action is logged with timestamp</li>
        </ul>
      </div>

      {!mnemonic ? (
        <div className="space-y-3">
          <div>
            <label className="text-[10px] text-gray-500 uppercase mb-1 block">Admin Password (to confirm)</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && fetchMnemonic()}
              placeholder="Enter your admin password..."
              className="w-full bg-black border border-white/10 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-red-500/50"
            />
          </div>
          {error && <p className="text-red-400 text-xs bg-red-900/10 p-3 rounded-xl">{error}</p>}
          <button
            onClick={fetchMnemonic}
            disabled={loading}
            className="w-full py-3 bg-red-900/30 border border-red-700/40 text-red-400 rounded-xl hover:bg-red-900/50 transition-all font-black text-sm disabled:opacity-50"
          >
            {loading ? '⏳ Retrieving from RPC...' : '🔑 Reveal Seed Phrase'}
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-500">{words.length} words • Monero 25-word seed</span>
            <div className="flex gap-2">
              <button
                onClick={() => setRevealed(!revealed)}
                className="px-3 py-1.5 bg-white/5 border border-white/10 text-gray-400 rounded-lg text-xs hover:bg-white/10"
              >
                {revealed ? '🙈 Hide' : '👁️ Show'}
              </button>
              <button
                onClick={copyToClipboard}
                className="px-3 py-1.5 bg-amber-900/20 border border-amber-700/30 text-amber-400 rounded-lg text-xs hover:bg-amber-900/40"
              >
                {copied ? '✅ Copied!' : '📋 Copy'}
              </button>
            </div>
          </div>

          {revealed ? (
            <div className="grid grid-cols-5 gap-2">
              {words.map((word, i) => (
                <div key={i} className="bg-black border border-white/10 rounded-lg p-2 text-center">
                  <span className="text-[9px] text-gray-600 block">{i + 1}</span>
                  <span className="text-xs text-green-400 font-mono font-bold">{word}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="bg-black border border-white/10 rounded-xl p-6 text-center">
              <p className="text-gray-600 text-sm">🔒 Seed phrase hidden - click "Show" to reveal</p>
              <p className="text-[10px] text-gray-700 mt-1">Make sure no one is watching your screen</p>
            </div>
          )}

          <div className="bg-amber-950/20 border border-amber-900/20 rounded-xl p-3">
            <p className="text-amber-400 text-[10px] font-bold">📝 {mnemonic.warning}</p>
          </div>

          <button
            onClick={() => { setMnemonic(null); setPassword(''); setRevealed(false); }}
            className="w-full py-2 border border-white/10 text-gray-600 rounded-xl hover:bg-white/5 text-xs"
          >
            Clear & Close
          </button>
        </div>
      )}
    </div>
  );
}

// NOTE: AboutPage is imported from ./AboutPage.js
// ============================================================
function _AboutPageLegacy({ onNavigate }) {
  const [canary, setCanary] = React.useState(null);
  const [showCanary, setShowCanary] = React.useState(false);

  React.useEffect(() => {
    fetch('/api/canary')
      .then(r => r.json())
      .then(d => setCanary(d))
      .catch(() => {});
  }, []);

return (
    <div className="min-h-screen bg-black text-white font-mono flex flex-col">
      
      <SystemBanner />
      {/* HERO */}
      <div className="relative overflow-hidden border-b border-amber-900/30">
        <div className="absolute inset-0 bg-gradient-to-br from-amber-900/10 via-black to-black pointer-events-none"/>
        <div className="relative max-w-4xl mx-auto px-8 py-20">
          <div className="flex items-center gap-4 mb-6">
            <div className="w-1 h-16 bg-amber-600"/>
            <div>
              <p className="text-amber-600 text-[10px] tracking-[0.5em] uppercase mb-1">Est. 2026 - Rebuilt from Zero</p>
              <h1 className="text-5xl font-black tracking-tighter text-white">SILK<span className="text-amber-500">GENESIS</span></h1>
            </div>
          </div>
          <p className="text-xl text-gray-300 leading-relaxed max-w-2xl italic">
            "The Renaissance of Liberty - A ground-up reconstruction of the original 2011 vision, 
            built for the age of surveillance capitalism."
          </p>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-8 py-16 space-y-16">

        {/* MISSION */}
        <section>
          <h2 className="text-amber-500 text-[10px] tracking-[0.5em] uppercase mb-6 flex items-center gap-3">
            <div className="w-8 h-px bg-amber-600"/>
            Our Mission
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="space-y-4">
              <p className="text-gray-300 text-sm leading-relaxed">
                In 2011, a marketplace emerged that proved something radical: free markets could exist 
                outside the reach of state violence. It was shut down. Then rebuilt. Then shut down again.
              </p>
              <p className="text-gray-300 text-sm leading-relaxed">
                SilkGenesis is the 2026 reconstruction - not a copy, but an evolution. Built with 
                the lessons of every predecessor, hardened against every known attack vector.
              </p>
            </div>
            <div className="space-y-4">
              <p className="text-gray-300 text-sm leading-relaxed">
                We believe in the sovereignty of the individual. In the right to transact freely, 
                communicate privately, and exist without surveillance.
              </p>
              <p className="text-gray-300 text-sm leading-relaxed">
                Every line of code, every protocol choice, every design decision reflects one 
                principle: <span className="text-amber-500 font-black">your data belongs to you.</span>
              </p>
            </div>
          </div>
        </section>

        {/* PILLARS */}
        <section>
          <h2 className="text-amber-500 text-[10px] tracking-[0.5em] uppercase mb-8 flex items-center gap-3">
            <div className="w-8 h-px bg-amber-600"/>
            Security Architecture
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              {
                icon: "⬡",
                title: "Full Monero (XMR)",
                desc: "Every transaction uses Monero - the only cryptocurrency with mandatory privacy. Ring signatures, stealth addresses, RingCT. No optional privacy. No metadata leaks.",
                color: "amber"
              },
              {
                icon: "◈",
                title: "Zero-Data Policy",
                desc: "Order messages and shipping addresses are automatically wiped 168 hours after completion. We cannot hand over what we do not have. Architecture-level privacy.",
                color: "green"
              },
              {
                icon: "⬟",
                title: "Anti-Phishing Protocol",
                desc: "Every account has a personal security phrase displayed before password entry. If you don't see your phrase, you're on a phishing site. Leave immediately.",
                color: "blue"
              }
            ].map((pillar, i) => (
              <div key={i} className={`bg-[#0a0a0a] border border-${pillar.color}-900/30 p-6 rounded-2xl`}>
                <div className={`text-3xl text-${pillar.color}-500 mb-4 font-black`}>{pillar.icon}</div>
                <h3 className={`text-${pillar.color}-400 font-black text-sm uppercase mb-3`}>{pillar.title}</h3>
                <p className="text-gray-500 text-xs leading-relaxed">{pillar.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* TECHNICAL SPECS */}
        <section>
          <h2 className="text-amber-500 text-[10px] tracking-[0.5em] uppercase mb-8 flex items-center gap-3">
            <div className="w-8 h-px bg-amber-600"/>
            Technical Specifications
          </h2>
          <div className="bg-[#0a0a0a] border border-white/5 rounded-2xl overflow-hidden">
            {[
              ["Network Layer", "Tor Hidden Service (.onion) - All traffic routed through Tor"],
              ["Payment Protocol", "Monero (XMR) - RingCT + Stealth Addresses + Ring Signatures"],
              ["Escrow System", "Multi-signature escrow with 7-day auto-finalization"],
              ["Data Retention", "Zero - Messages wiped 168h post-completion"],
              ["Authentication", "2-step: User ID -> Anti-Phishing Phrase -> Passphrase"],
              ["Encryption", "PGP end-to-end for all vendor-buyer communications"],
              ["Rate Limiting", "Brute-force protection on all auth endpoints"],
              ["Frontend", "100% local assets - No external CDN, no Google Fonts, no trackers"],
            ].map(([key, val], i) => (
              <div key={i} className={`flex items-start gap-6 p-4 ${i % 2 === 0 ? 'bg-white/2' : ''} border-b border-white/5 last:border-0`}>
                <span className="text-amber-600 text-[10px] uppercase font-black w-40 flex-shrink-0">{key}</span>
                <span className="text-gray-400 text-[11px]">{val}</span>
              </div>
            ))}
          </div>
        </section>

        {/* WARRANT CANARY */}
        <section>
          <h2 className="text-amber-500 text-[10px] tracking-[0.5em] uppercase mb-6 flex items-center gap-3">
            <div className="w-8 h-px bg-amber-600"/>
            Warrant Canary
          </h2>
          <div className="bg-[#0a0a0a] border border-green-900/30 rounded-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"/>
                <span className="text-green-400 text-xs font-black uppercase">Status: ACTIVE</span>
                {canary && <span className="text-gray-600 text-[10px]">Last updated: {canary.last_updated}</span>}
              </div>
              <button
                onClick={() => setShowCanary(!showCanary)}
                className="text-amber-500 text-[10px] uppercase font-black border border-amber-900/40 px-3 py-1.5 rounded hover:bg-amber-900/10 transition-all"
              >
                {showCanary ? 'Hide' : 'View'} Signed Message
              </button>
            </div>
            <div className="space-y-2 text-[11px] text-gray-400">
              <p>✓ SilkGenesis has received <span className="text-green-400 font-black">ZERO</span> legal requests, subpoenas, or warrants</p>
              <p>✓ Infrastructure has <span className="text-green-400 font-black">NOT</span> been compromised or seized</p>
              <p>✓ No user data has been disclosed to any third party</p>
              <p>✓ No backdoors have been installed</p>
            </div>
            {showCanary && canary && (
              <div className="mt-4 bg-black p-4 rounded-xl border border-white/5">
                <pre className="text-[9px] text-green-400 font-mono whitespace-pre-wrap overflow-x-auto leading-relaxed">
                  {canary.canary_text}
                </pre>
              </div>
            )}
            <p className="text-[9px] text-gray-600 mt-4 italic">
              This canary is updated monthly. If it disappears or is not updated, assume the platform has been compromised.
              Verify the PGP signature against the admin public key.
            </p>
          </div>
        </section>

        {/* OPSEC GUIDE */}
        <section>
          <h2 className="text-amber-500 text-[10px] tracking-[0.5em] uppercase mb-6 flex items-center gap-3">
            <div className="w-8 h-px bg-amber-600"/>
            Operational Security Guide
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[
              { n: "01", title: "Always use Tor Browser", desc: "Never access this platform from a regular browser. Use the latest Tor Browser with JavaScript enabled only for this site." },
              { n: "02", title: "Verify your anti-phishing phrase", desc: "Before entering your password, always verify your personal security phrase is displayed. If absent, you are on a phishing site." },
              { n: "03", title: "Use PGP for all communications", desc: "Set your PGP public key in your profile. All sensitive communications should be encrypted end-to-end." },
              { n: "04", title: "Monero only", desc: "Never use Bitcoin or any traceable cryptocurrency. Monero is the only payment method that provides true financial privacy." },
              { n: "05", title: "Verify the .onion address", desc: "Bookmark the official .onion address. Never click links from external sources. Phishing sites are indistinguishable from the real site without your anti-phishing phrase." },
              { n: "06", title: "Enable withdrawal PIN", desc: "Set a 6-digit PIN for withdrawals in your profile settings. This prevents unauthorized fund transfers even if your account is compromised." },
            ].map((item, i) => (
              <div key={i} className="bg-[#0a0a0a] border border-white/5 p-5 rounded-xl flex gap-4">
                <span className="text-amber-900 text-2xl font-black flex-shrink-0">{item.n}</span>
                <div>
                  <h4 className="text-white text-xs font-black uppercase mb-1">{item.title}</h4>
                  <p className="text-gray-500 text-[10px] leading-relaxed">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* FOOTER */}
        <div className="border-t border-white/5 pt-8 text-center">
          <p className="text-gray-700 text-[10px] italic">
            "The only way to deal with an unfree world is to become so absolutely free that your very existence is an act of rebellion."
          </p>
          <p className="text-gray-800 text-[9px] mt-2">- Albert Camus</p>
          <button
            onClick={() => onNavigate && onNavigate('market')}
            className="mt-6 px-8 py-3 bg-amber-600 text-black font-black uppercase text-[11px] rounded-xl hover:bg-amber-500 transition-all"
          >
            Enter the Market ->
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// CLOCK CAPTCHA
// ============================================================
function ClockCaptcha({ isOpen, onClose, onVerify }) {
  const [targetTime, setTargetTime] = useState({ h: 0, m: 0 });
  const [hourInput, setHourInput] = useState('');
  const [minInput, setMinInput] = useState('');
  const [timeLeft, setTimeLeft] = useState(30);
  const [isExpired, setIsExpired] = useState(false);

  const generateRandomTime = useCallback(() => {
    const h = Math.floor(Math.random() * 12) || 12;
    const m = Math.floor(Math.random() * 60);
    setTargetTime({ h, m });
    setHourInput(''); setMinInput('');
    setTimeLeft(30); setIsExpired(false);
  }, []);

  useEffect(() => {
    let timer;
    if (isOpen && timeLeft > 0 && !isExpired) timer = setTimeout(() => setTimeLeft(timeLeft - 1), 1000);
    else if (timeLeft === 0) setIsExpired(true);
    return () => clearTimeout(timer);
  }, [isOpen, timeLeft, isExpired]);

  useEffect(() => { if (isOpen) generateRandomTime(); }, [isOpen, generateRandomTime]);

  if (!isOpen) return null;

  const verify = () => {
    if (isExpired) return;
    if (parseInt(hourInput) === targetTime.h && parseInt(minInput) === targetTime.m) {
      onVerify(btoa(`VALID_CLOCK_${hourInput}:${minInput}_${Date.now()}`));
      onClose();
    } else { alert("VERIFICATION FAILED"); generateRandomTime(); }
  };

  const hourDeg = (targetTime.h * 30) + (targetTime.m * 0.5);
  const minDeg = targetTime.m * 6;

  return (
    <div className="fixed inset-0 z-[100] bg-black/98 backdrop-blur-2xl flex items-center justify-center p-4 font-mono text-center">
      <div className="bg-[#0a0a0a] border border-amber-900/60 p-8 rounded-lg w-[400px] shadow-2xl relative">
        <div className="flex justify-between items-center mb-6 border-b border-amber-900/30 pb-3 text-amber-500 font-black uppercase text-[11px]">
          <div className="flex items-center gap-2 tracking-widest"><Shield size={16} className={!isExpired ? "animate-pulse" : ""}/><span>Biometric Clock Sync</span></div>
          <div>00:{timeLeft.toString().padStart(2, '0')}</div>
        </div>
        {!isExpired ? (
          <>
            <div className="relative w-40 h-40 mx-auto mb-10 border-4 border-amber-600/40 rounded-full bg-black">
              {[...Array(60)].map((_, i) => (
                <div key={i} className="absolute inset-0 flex justify-center" style={{ transform: `rotate(${i * 6}deg)` }}>
                  <div className={`w-[1px] ${i % 5 === 0 ? 'h-3 bg-amber-500' : 'h-1 bg-gray-600'}`}></div>
                </div>
              ))}
              <div className="absolute inset-0 flex justify-center items-center" style={{ transform: `rotate(${hourDeg}deg)` }}>
                <div className="w-1.5 h-12 bg-amber-600 rounded-full -translate-y-6 shadow-lg"></div>
              </div>
              <div className="absolute inset-0 flex justify-center items-center" style={{ transform: `rotate(${minDeg}deg)` }}>
                <div className="w-1 h-16 bg-white rounded-full -translate-y-8 shadow-lg"></div>
              </div>
            </div>
            <div className="flex items-center justify-center gap-3 mb-6">
              <input type="text" maxLength="2" placeholder="00" value={hourInput} onChange={(e) => setHourInput(e.target.value.replace(/\D/g, ''))} className="w-16 bg-black border border-amber-900/50 p-3 rounded text-center text-2xl text-amber-500 font-black outline-none"/>
              <span className="text-2xl text-amber-500 font-black animate-pulse">:</span>
              <input type="text" maxLength="2" placeholder="00" value={minInput} onChange={(e) => setMinInput(e.target.value.replace(/\D/g, ''))} className="w-16 bg-black border border-amber-900/50 p-3 rounded text-center text-2xl text-amber-500 font-black outline-none"/>
            </div>
            <button onClick={verify} className="w-full py-4 bg-amber-600 text-black text-[12px] font-black uppercase hover:bg-amber-400">Confirm Sequence</button>
          </>
        ) : (
          <button onClick={generateRandomTime} className="w-full py-4 text-amber-500 border border-amber-900/40 uppercase text-[11px] font-black">Retry</button>
        )}
      </div>
    </div>
  );
}

// ============================================================
// ORDERS PAGE (ESCROW) - WITH RELEASE FUNDS BUTTON
// ============================================================
function OrdersPage({ user, orders, products, onMarkShipped, onComplete, onOpenChat, onSubmitReview, onReleaseFunds, onOpenDispute, xmrRate = 352 }) {
  const [reviewOrderId, setReviewOrderId] = useState(null);
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const [releasingFunds, setReleasingFunds] = useState(null);

  const getProductTitle = (listingId) => {
    const product = products.find(p => p.id === listingId);
    return product ? product.title : "Unknown Product";
  };

  const handleSubmitReview = async (order) => {
    if (!comment.trim()) { alert("Please write a comment"); return; }
    const success = await onSubmitReview(order.id, order.vendor, rating, comment);
    if (success) { setReviewOrderId(null); setRating(5); setComment(''); }
  };

  const handleReleaseFunds = async (orderId) => {
    setReleasingFunds(orderId);
    await onComplete(orderId);
    setReleasingFunds(null);
  };

  const myOrders = orders.filter(o => o.buyer === user.username || o.vendor === user.username);

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <h2 className="text-3xl font-black text-white flex items-center gap-3">
        <Shield size={32} className="text-amber-500"/> Escrow Transactions
      </h2>

      {myOrders.length === 0 ? (
        <div className="bg-[#111] border border-white/5 p-20 rounded-3xl text-center">
          <Package size={64} className="mx-auto mb-4 opacity-10"/>
          <p className="text-gray-600 text-sm">No active transactions</p>
        </div>
      ) : myOrders.map(order => (
        <div key={order.id} className="bg-[#111] border border-amber-900/20 p-6 rounded-2xl shadow-xl">
          {/* HEADER */}
          <div className="flex justify-between items-start mb-6 pb-4 border-b border-white/5">
            <div>
              <h3 className="text-xl text-amber-500 font-black">#{order.id}</h3>
              <p className="text-sm text-gray-500 mt-1">
                {user.username === order.buyer ? `Vendor: ${order.vendor}` : `Buyer: ${order.buyer}`}
              </p>
              <p className="text-xs text-gray-600 mt-1">{getProductTitle(order.listing_id)}</p>
            </div>
            <div className={`px-6 py-3 rounded-xl text-xs font-black ${
              order.status === 'escrow' ? 'bg-yellow-900/20 text-yellow-500 border border-yellow-900/40' :
              order.status === 'shipped' ? 'bg-blue-900/20 text-blue-500 border border-blue-900/40' :
              'bg-green-900/20 text-green-500 border border-green-900/40'
            }`}>
              {order.status.toUpperCase()}
            </div>
          </div>

          {/* ESCROW INFO */}
          <div className="bg-black/60 p-6 rounded-xl mb-6 border border-amber-900/10">
            <div className="grid grid-cols-2 gap-6">
              <div>
                <p className="text-[10px] text-gray-500 mb-2 uppercase">Escrow Amount:</p>
                <p className="text-2xl text-amber-500 font-black">${(parseFloat(order.amount_xmr) * xmrRate).toFixed(2)}</p>
              <p className="text-[10px] text-gray-600 mt-1">{order.amount_xmr} XMR</p>
              </div>
              <div>
                <p className="text-[10px] text-gray-500 mb-2 uppercase">Status:</p>
                <p className="text-sm text-white">
                  {order.status === 'escrow' && '🔒 Funds locked in escrow'}
                  {order.status === 'shipped' && '📦 Package shipped, awaiting confirmation'}
                {order.status === 'shipped' && order.buyer === user?.username && (
                  <div style={{display:'flex',gap:8,marginTop:8}}>
                    <button onClick={() => onReleaseFunds && onReleaseFunds(order.id)} style={{padding:'8px 14px',background:'#27ae60',color:'#fff',border:'none',borderRadius:6,cursor:'pointer',fontSize:12,fontWeight:'bold'}}>
                      ✅ Release Funds
                    </button>
                    <button onClick={() => onOpenDispute && onOpenDispute(order.id)} style={{padding:'8px 14px',background:'#e74c3c',color:'#fff',border:'none',borderRadius:6,cursor:'pointer',fontSize:12}}>
                      ⚠️ Open Dispute
                    </button>
                  </div>
                )}
                  {order.status === 'completed' && '✅ Funds released to vendor'}
                </p>
              </div>
            </div>
          </div>

          {/* ACTIONS */}
          <div className="space-y-4">
            <div className="flex gap-4 flex-wrap">
              {/* VENDOR: Mark as shipped */}
              {user.username === order.vendor && order.status === 'escrow' && (
                <button onClick={() => onMarkShipped(order.id)}
                  className="flex-1 bg-blue-600 text-black py-4 rounded-xl font-black hover:bg-blue-500 transition-all flex items-center justify-center gap-2 text-sm">
                  <Package size={18}/> Mark as Shipped
                </button>
              )}

              {/* ACHETEUR: RELEASE THE FUNDS - Bouton principal */}
              {user.username === order.buyer && order.status === 'shipped' && (
                <button
                  onClick={() => {
                    if (window.confirm(`⚠️ RELEASE FUNDS TO VENDOR?\n\nAmount: ${order.amount_xmr} XMR\nVendor: ${order.vendor}\n\nThis action is IRREVERSIBLE. Only release funds if you received your order.\n\nProceed?`)) {
                      handleReleaseFunds(order.id);
                    }
                  }}
                  disabled={releasingFunds === order.id}
                  className="flex-1 bg-gradient-to-r from-green-600 to-emerald-600 text-black py-4 rounded-xl font-black hover:from-green-500 hover:to-emerald-500 transition-all flex items-center justify-center gap-2 text-sm shadow-lg shadow-green-900/30 disabled:opacity-50"
                >
                  {releasingFunds === order.id ? (
                    <><div className="w-4 h-4 border-2 border-black border-t-transparent rounded-full animate-spin"/> Processing...</>
                  ) : (
                    <><Unlock size={18}/> 🔓 RELEASE THE FUNDS</>
                  )}
                </button>
              )}

              {/* ACHETEUR: En pending d'shipment */}
              {user.username === order.buyer && order.status === 'escrow' && (
                <div className="flex-1 bg-yellow-900/10 border border-yellow-900/30 text-yellow-600 py-4 rounded-xl flex items-center justify-center gap-2 text-sm font-black">
                  <Lock size={18}/> Waiting for vendor to ship...
                </div>
              )}

              {/* CHAT */}
              <button onClick={() => onOpenChat(order.id)}
                className="px-8 py-4 border border-amber-900/40 text-amber-500 rounded-xl hover:bg-amber-900/10 transition-all flex items-center gap-2 text-sm font-black">
                <MessageSquare size={18}/> Open Chat
              </button>
            </div>

            {/* REVIEW FORM */}
            {user.username === order.buyer && order.status === 'completed' && (
              reviewOrderId === order.id ? (
                <div className="bg-black/60 p-6 rounded-xl border border-amber-900/20">
                  <h4 className="text-amber-500 font-black mb-4 flex items-center gap-2"><Star size={18}/> Leave a Review</h4>
                  <div className="space-y-4">
                    <div>
                      <p className="text-[10px] text-gray-500 mb-2 uppercase">Rating:</p>
                      <div className="flex gap-2">
                        {[1, 2, 3, 4, 5].map(r => (
                          <button key={r} type="button" onClick={() => setRating(r)} className="p-2">
                            <Star size={24} className={r <= rating ? "fill-amber-500 text-amber-500" : "text-gray-700"}/>
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <p className="text-[10px] text-gray-500 mb-2 uppercase">Comment:</p>
                      <textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Share your experience..."
                        className="w-full bg-black border border-white/10 p-4 rounded-xl text-sm text-white outline-none h-24"/>
                    </div>
                    <div className="flex gap-4">
                      <button onClick={() => setReviewOrderId(null)} className="flex-1 py-3 border border-white/10 text-gray-500 rounded-xl hover:bg-white/5">Cancel</button>
                      <button onClick={() => handleSubmitReview(order)} className="flex-1 py-3 bg-amber-600 text-black font-black rounded-xl hover:bg-amber-500">Submit Review</button>
                    </div>
                  </div>
                </div>
              ) : (
                <button onClick={() => setReviewOrderId(order.id)}
                  className="w-full py-3 border border-amber-900/40 text-amber-500 rounded-xl hover:bg-amber-900/10 transition-all flex items-center justify-center gap-2 text-sm font-black">
                  <Star size={18}/> Leave a Review
                </button>
              )
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ============================================================
// PROFILE PAGE
// ============================================================
function ProfilePage({ user, onUpdateAvatar, onUpgrade, onDelete }) {
  const [tempImg, setTempImg] = useState(user?.avatar || null);

  const handleAvatarChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => { setTempImg(reader.result); onUpdateAvatar(reader.result); };
      reader.readAsDataURL(file);
    }
  };

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 font-mono uppercase italic font-black space-y-6">
      <div className="bg-[#111] border border-amber-900/20 rounded-3xl overflow-hidden shadow-2xl">
        <div className="bg-gradient-to-r from-amber-900/20 to-transparent p-10 border-b border-amber-900/10 flex items-end gap-8">
          <div className="relative group">
            <div className="w-28 h-28 bg-black border-2 border-amber-600/30 rounded-2xl flex items-center justify-center text-amber-600 font-black text-4xl shadow-xl overflow-hidden">
              {tempImg ? <img loading="lazy" src={tempImg} className="w-full h-full object-cover" alt="Avatar"/> : (user?.username ? user.username[0].toUpperCase() : '?')}
            </div>
            <label className="absolute inset-0 bg-black/60 flex items-center justify-center opacity-0 group-hover:opacity-100 cursor-pointer transition-all rounded-2xl">
              <Camera size={24} className="text-amber-500"/>
              <input type="file" className="hidden" accept="image/*" onChange={handleAvatarChange}/>
            </label>
          </div>
          <div className="flex-1">
            <h2 className="text-5xl font-black text-white tracking-tighter">{user?.username}</h2>
            <p className="text-gray-500 text-[11px] normal-case not-italic font-medium tracking-tight mt-2 flex items-center gap-2">
              <Shield size={14} className="text-amber-600/80 flex-shrink-0" /> Use the <strong className="text-gray-400">2FA</strong> card just below, then PGP, to harden this account.
            </p>
          </div>
          {user?.role === 'buyer' && (
            <button onClick={onUpgrade} className="bg-amber-600 text-black px-6 py-3 rounded-xl text-[11px] hover:bg-amber-400 transition-all flex items-center gap-2 shadow-xl">
              <Zap size={14}/> Become vendor
            </button>
          )}
        </div>
      </div>
      <div className="flex justify-end">
        <button onClick={onDelete} className="flex items-center gap-2 text-red-900 hover:text-red-500 text-[10px] tracking-widest transition-all p-2 border border-red-900/20 rounded-lg bg-red-900/5">
          <UserMinus size={14}/> Purge Identity (Permanent Delete)
        </button>
      </div>
    </div>
  );
}

function WalletPage({ user, onWithdraw, authenticatedFetch, balance, xmrRate }) {
  const [wAddr, setWAddr] = useState('');
  const [wAmt, setWAmt] = useState('');
  const [profileDepositAddress, setProfileDepositAddress] = useState('');
  const [recentWithdrawals, setRecentWithdrawals] = useState([]);
  const [recentDeposits, setRecentDeposits] = useState([]);

  const getSessionToken = () => {
    try {
      const raw = localStorage.getItem('silkGenesis_session');
      if (!raw) return '';
      const parsed = JSON.parse(raw);
      return parsed.session_token || '';
    } catch {
      return '';
    }
  };

  useEffect(() => {
    setProfileDepositAddress('');
    if (!user?.username) return;
    const token = getSessionToken();
    fetch(`/api/wallet/deposit-address/${user.username}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {}
    })
      .then(r => r.json())
      .then(d => {
        if (d?.address && d.address.startsWith('8')) setProfileDepositAddress(d.address);
        else setProfileDepositAddress('');
      })
      .catch(() => setProfileDepositAddress(''));
  }, [user?.username]);

  useEffect(() => {
    let cancelled = false;
    const loadWalletActivity = async () => {
      if (!authenticatedFetch || !user?.username) return;
      try {
        const [wdRes, depRes] = await Promise.all([
          authenticatedFetch('/api/withdrawal/history'),
          authenticatedFetch(`/api/xmr/deposit-diagnostics/${encodeURIComponent(user.username)}`)
        ]);

        if (!cancelled && wdRes?.ok) {
          const wdData = await wdRes.json();
          const allWd = Array.isArray(wdData?.withdrawals) ? wdData.withdrawals : [];
          setRecentWithdrawals(allWd.slice(0, 5));
        }

        if (!cancelled && depRes?.ok) {
          const depData = await depRes.json();
          const incoming = Array.isArray(depData?.recent_incoming_for_address)
            ? depData.recent_incoming_for_address
            : [];
          setRecentDeposits(incoming.slice(0, 5));
        }
      } catch {
        if (!cancelled) {
          setRecentWithdrawals([]);
          setRecentDeposits([]);
        }
      }
    };
    loadWalletActivity();
    return () => { cancelled = true; };
  }, [authenticatedFetch, user?.username]);

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 font-mono uppercase italic font-black space-y-6">
      <div className="bg-[#111] border border-emerald-900/20 rounded-3xl p-6 shadow-2xl">
        <h3 className="text-emerald-500 mb-3 flex items-center gap-2 normal-case not-italic"><Wallet size={18}/> Account balance</h3>
        <div className="text-[10px] text-gray-500 normal-case not-italic">Estimated USD value</div>
        <div className="text-sm text-emerald-300">
          ${(((Number(balance) || 0) * (Number(xmrRate) || 0))).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </div>
        <div className="text-2xl text-amber-500 tracking-tight">
          {(Number(balance) || 0).toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 4 })} XMR
        </div>
      </div>

      <div className="bg-[#111] border border-amber-900/20 rounded-3xl p-8 shadow-2xl">
        <h3 className="text-amber-500 mb-2 flex items-center gap-2 normal-case not-italic"><DollarSign size={20}/> Monero deposit address</h3>
        <p className="text-[10px] text-gray-500 mb-4">Subaddress for incoming XMR. Shown when the market wallet RPC is available.</p>
        <div className="bg-black p-4 rounded-xl border border-white/5 flex items-center justify-between group">
          <code className="text-[11px] text-amber-600 break-all font-mono">{profileDepositAddress || "SUBADDRESS UNAVAILABLE (RPC OFFLINE)"}</code>
          <button onClick={() => { navigator.clipboard.writeText(profileDepositAddress || ''); alert("COPIED"); }} className="ml-4 p-2 bg-amber-900/20 text-amber-500 rounded hover:bg-amber-600 hover:text-black transition-all"><Copy size={14}/></button>
        </div>
      </div>

      <div className="bg-[#111] border border-red-900/20 rounded-3xl p-8 shadow-2xl">
        <h3 className="text-red-500 mb-6 flex items-center gap-2"><ArrowUpCircle size={20}/> Outbound Fund Transfer</h3>
        <div className="space-y-4">
          <input type="text" placeholder="EXTERNAL XMR ADDRESS" value={wAddr} onChange={e => setWAddr(e.target.value)} className="w-full bg-black border border-white/10 p-4 rounded-xl text-[11px] text-amber-500 outline-none font-mono" />
          <div className="flex gap-4">
            <input type="number" placeholder="AMOUNT" value={wAmt} onChange={e => setWAmt(e.target.value)} className="flex-1 bg-black border border-white/10 p-4 rounded-xl text-[11px] text-amber-500 font-mono" />
            <button onClick={() => onWithdraw(wAddr, parseFloat(wAmt))} className="bg-red-600 text-black px-8 rounded-xl font-black uppercase text-[11px] hover:bg-red-500">Execute</button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-[#111] border border-green-900/20 rounded-3xl p-6 shadow-2xl">
          <h3 className="text-green-500 mb-4 flex items-center gap-2 normal-case not-italic"><ArrowDownCircle size={18}/> Recent deposits</h3>
          <div className="space-y-3">
            {recentDeposits.length === 0 && (
              <p className="text-[10px] text-gray-500 normal-case not-italic">No recent incoming deposits detected for this address.</p>
            )}
            {recentDeposits.map((dep, idx) => (
              <div key={`${dep.txid || 'dep'}-${idx}`} className="bg-black border border-white/5 rounded-xl p-3">
                <div className="flex items-center justify-between text-[10px] mb-1">
                  <span className="text-green-400">{Number(dep.amount_xmr || 0).toFixed(6)} XMR</span>
                  <span className={`${Number(dep.confirmations || 0) > 0 ? 'text-amber-500' : 'text-gray-500'}`}>
                    {Number(dep.confirmations || 0)} conf
                  </span>
                </div>
                <code className="text-[9px] text-gray-500 break-all">{dep.txid || 'pending txid'}</code>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-[#111] border border-amber-900/20 rounded-3xl p-6 shadow-2xl">
          <h3 className="text-amber-500 mb-4 flex items-center gap-2 normal-case not-italic"><ArrowUpCircle size={18}/> Recent withdrawals</h3>
          <div className="space-y-3">
            {recentWithdrawals.length === 0 && (
              <p className="text-[10px] text-gray-500 normal-case not-italic">No withdrawal history yet.</p>
            )}
            {recentWithdrawals.map((wd, idx) => (
              <div key={`${wd.id || 'wd'}-${idx}`} className="bg-black border border-white/5 rounded-xl p-3">
                <div className="flex items-center justify-between text-[10px] mb-1">
                  <span className="text-amber-500">{Number(wd.amount_xmr || 0).toFixed(6)} XMR</span>
                  <span className="text-gray-400">{String(wd.status || 'pending').toUpperCase()}</span>
                </div>
                <div className="text-[9px] text-gray-600 normal-case not-italic">
                  {wd.created_at ? new Date(wd.created_at).toLocaleString() : 'No date'}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// LOGIN PAGE
// ============================================================
// ============================================================
// ANTI-PHISHING LOGIN - Component login 2 etapes
// ============================================================
function AntiPhishingLogin({ onLogin }) {
  const [step, setStep] = React.useState(1); // 1=user, 2=pass, 3=2fa
  const [username, setUsername] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [totpCode, setTotpCode] = React.useState('');
  const [hasPhrase, setHasPhrase] = React.useState(false);
  const [error, setError] = React.useState('');
  const [loading, setLoading] = React.useState(false);

  const checkUsername = async () => {
    if (!username.trim()) { setError('Enter your User ID'); return; }
    setLoading(true);
    setError('');
    try {
      const resp = await fetch('/api/auth/check-user', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({username: username.trim()})
      });
      const data = await resp.json();
      if (resp.status === 429) {
        setError('Rate limited. Wait ' + data.retry_after + 's before retrying.');
        setLoading(false); return;
      }
      if (!data.exists) {
        setError('User ID not found');
        setLoading(false); return;
      }
      setHasPhrase(!!data.has_phrase);
      setStep(2);
    } catch(e) {
      setError('Connection error - is the backend running?');
    } finally {
      setLoading(false);
    }
  };

  const doLogin = async () => {
    if (step !== 3 && !password.trim()) { setError('Enter your passphrase'); return; }
    if (step === 3 && !totpCode.trim()) { setError('Enter your 6-digit authenticator code (or backup code)'); return; }
    setLoading(true);
    setError('');
    try {
      const body = { username: username.trim(), password: password.trim() };
      if (step === 3) {
        body.totp_code = totpCode.trim();
      } else {
        try {
          const { mineProofOfWork } = await import('./silkApi');
          body.pow_solution = await mineProofOfWork('login');
        } catch (powErr) {
          setError('Proof-of-Work failed. Refresh and try again.');
          setLoading(false);
          return;
        }
      }
      const resp = await fetch(silkGenesisApiUrl('/api/login'), {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(body),
      });
      const data = await resp.json();
      if (resp.status === 429) {
        setError('Rate limited. Wait ' + data.retry_after + 's.');
        setLoading(false); return;
      }
      if (resp.ok && data.status === '2fa_required') {
        setStep(3);
        setTotpCode('');
        setLoading(false);
        return;
      }
      if (resp.ok && data.status === '2fa_setup_required') {
        setError('2FA setup is mandatory for this account role. Complete 2FA setup first.');
        setLoading(false);
        return;
      }
      if (resp.ok && data.status === 'success') {
        if (data.anti_phishing_phrase) {
          window.alert(
            `Login successful.\n\nYour anti-phishing phrase:\n\n"${data.anti_phishing_phrase}"\n\nIf this does not match what you expect, log out immediately.`
          );
        }
        onLogin(data.user, data.session_token);
      } else {
        setError(data.detail === 'INVALID_2FA_CODE' ? 'Invalid 2FA code. Try again.' : 'Invalid credentials');
        if (step === 3) setTotpCode('');
        else {
          setStep(1);
          setUsername('');
          setPassword('');
        }
      }
    } catch(e) {
      setError('Connection error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{minHeight:'100vh',background:'#050505',display:'flex',alignItems:'center',justifyContent:'center'}}>
      <div style={{border:'1px solid #00ff41',padding:'30px',width:'380px',background:'rgba(0,20,0,0.95)',boxShadow:'0 0 30px rgba(0,255,65,0.2)'}}>
        <div style={{textAlign:'center',marginBottom:'20px'}}>
          <div style={{fontSize:'28px',color:'#00ff41',fontFamily:'monospace',fontWeight:'bold'}}>SilkGenesis</div>
          <div style={{color:'#666',fontSize:'12px',marginTop:'4px'}}>SECURE DARKNET MARKETPLACE</div>
        </div>

        {step === 1 && (
          <div>
            <div style={{color:'#00ff41',fontSize:'13px',marginBottom:'15px',fontFamily:'monospace'}}>
              STEP 1/3 - ENTER YOUR USER ID
            </div>
            <input
              value={username}
              onChange={e => setUsername(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && checkUsername()}
              placeholder="User ID"
              style={{width:'100%',background:'#000',border:'1px solid #00ff41',color:'#00ff41',padding:'10px',marginBottom:'12px',boxSizing:'border-box',fontFamily:'monospace'}}
            />
            <button
              onClick={checkUsername}
              disabled={loading}
              style={{width:'100%',background:'#00ff41',color:'#000',border:'none',padding:'12px',cursor:'pointer',fontWeight:'bold',fontFamily:'monospace',fontSize:'14px'}}
            >
              {loading ? 'CHECKING...' : 'CONTINUE'}
            </button>
          </div>
        )}

        {step === 3 && (
          <div>
            <div style={{color:'#00ff41',fontSize:'13px',marginBottom:'15px',fontFamily:'monospace'}}>
              STEP 3/3 - TWO-FACTOR AUTHENTICATION
            </div>
            <div style={{color:'#888',fontSize:'11px',marginBottom:'12px',fontFamily:'monospace'}}>
              Account <span style={{color:'#00ff41'}}>{username}</span> requires a TOTP code from your authenticator app (or a backup code).
            </div>
            <input
              type="text"
              value={totpCode}
              onChange={e => setTotpCode(e.target.value.replace(/\s/g, ''))}
              onKeyDown={e => e.key === 'Enter' && doLogin()}
              placeholder="6-digit code"
              style={{width:'100%',background:'#000',border:'1px solid #00ff41',color:'#00ff41',padding:'12px',marginBottom:'12px',boxSizing:'border-box',fontFamily:'monospace',letterSpacing:'0.3em',textAlign:'center',fontSize:'18px'}}
            />
            <div style={{display:'flex',gap:'8px'}}>
              <button
                type="button"
                onClick={() => { setStep(2); setTotpCode(''); setError(''); }}
                style={{flex:1,background:'transparent',color:'#666',border:'1px solid #333',padding:'10px',cursor:'pointer',fontFamily:'monospace'}}
              >
                BACK
              </button>
              <button
                type="button"
                onClick={doLogin}
                disabled={loading}
                style={{flex:2,background:'#00ff41',color:'#000',border:'none',padding:'10px',cursor:'pointer',fontWeight:'bold',fontFamily:'monospace'}}
              >
                {loading ? 'VERIFYING...' : 'VERIFY 2FA'}
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div>
            <div style={{color:'#00ff41',fontSize:'13px',marginBottom:'15px',fontFamily:'monospace'}}>
              STEP 2/3 - VERIFY SITE AND ENTER PASSPHRASE
            </div>
            <div style={{background:'rgba(0,255,65,0.05)',border:'1px solid #00ff41',padding:'12px',marginBottom:'15px'}}>
              <div style={{color:'#888',fontSize:'11px',marginBottom:'6px',fontFamily:'monospace'}}>ANTI-PHISHING</div>
              <div style={{color:'#00ff41',fontSize:'12px',fontFamily:'monospace',lineHeight:1.5}}>
                {hasPhrase
                  ? 'A custom phrase is configured on this account. It will be shown once in a dialog immediately after a successful login — not before your password.'
                  : 'No phrase configured yet. You can set one in your profile after login.'}
              </div>
              <div style={{color:'#555',fontSize:'10px',marginTop:'6px',fontFamily:'monospace'}}>
                Never trust a site that asks for your password before you have authenticated.
              </div>
            </div>
            <div style={{color:'#888',fontSize:'11px',marginBottom:'6px',fontFamily:'monospace'}}>Logging in as: <span style={{color:'#00ff41'}}>{username}</span></div>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && doLogin()}
              placeholder="Passphrase"
              style={{width:'100%',background:'#000',border:'1px solid #00ff41',color:'#00ff41',padding:'10px',marginBottom:'12px',boxSizing:'border-box',fontFamily:'monospace'}}
            />
            <div style={{display:'flex',gap:'8px'}}>
              <button
                onClick={() => { setStep(1); setPassword(''); setError(''); }}
                style={{flex:1,background:'transparent',color:'#666',border:'1px solid #333',padding:'10px',cursor:'pointer',fontFamily:'monospace'}}
              >
                BACK
              </button>
              <button
                onClick={doLogin}
                disabled={loading}
                style={{flex:2,background:'#00ff41',color:'#000',border:'none',padding:'10px',cursor:'pointer',fontWeight:'bold',fontFamily:'monospace'}}
              >
                {loading ? 'LOGGING IN...' : 'LOGIN'}
              </button>
            </div>
          </div>
        )}

        {error && (
          <div style={{color:'#ff4444',marginTop:'12px',fontSize:'12px',fontFamily:'monospace',textAlign:'center'}}>
            {error}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// PGP KEY MANAGER
// ============================================================
function PGPKeyManager({ currentUser }) {
  const [pgpKey, setPgpKey] = React.useState('');
  const [currentKey, setCurrentKey] = React.useState(null);
  const [status, setStatus] = React.useState('');
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    fetch('/api/user/' + currentUser.username + '/pgp-key')
      .then(r => r.json())
      .then(d => { if (d.pgp_public_key) setCurrentKey(d.pgp_public_key); })
      .catch(() => {});
  }, [currentUser.username]);

  const savePGP = async () => {
    setLoading(true);
    try {
      const resp = await fetch('/api/user/pgp-key', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({username: currentUser.username, pgp_public_key: pgpKey})
      });
      const data = await resp.json();
      if (resp.ok) {
        setStatus('PGP key saved! Messages to you will be encrypted.');
        setCurrentKey(pgpKey);
        setPgpKey('');
      } else {
        setStatus('Error: ' + (data.message || data.detail));
      }
    } catch(e) {
      setStatus('Connection error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{background:'rgba(0,20,0,0.8)',border:'1px solid #00ff41',padding:'20px',marginTop:'20px',borderRadius:'8px'}}>
      <h3 style={{color:'#00ff41',fontFamily:'monospace',marginTop:0}}>PGP PUBLIC KEY</h3>
      {currentKey && (
        <div style={{background:'#000',border:'1px solid #333',padding:'10px',marginBottom:'15px',fontSize:'11px',color:'#888',fontFamily:'monospace',maxHeight:'80px',overflow:'auto'}}>
          <div style={{color:'#00ff41',marginBottom:'4px'}}>Current key set:</div>
          {currentKey.substring(0, 100)}...
        </div>
      )}
      <textarea
        value={pgpKey}
        onChange={e => setPgpKey(e.target.value)}
        placeholder="-----BEGIN PGP PUBLIC KEY BLOCK-----"
        rows={5}
        style={{width:'100%',background:'#000',border:'1px solid #00ff41',color:'#00ff41',padding:'10px',fontFamily:'monospace',fontSize:'11px',boxSizing:'border-box',resize:'vertical'}}
      />
      <button
        onClick={savePGP}
        disabled={loading || !pgpKey.trim()}
        style={{marginTop:'10px',background:'#00ff41',color:'#000',border:'none',padding:'10px 20px',cursor:'pointer',fontWeight:'bold',fontFamily:'monospace'}}
      >
        {loading ? 'SAVING...' : 'SAVE PGP KEY'}
      </button>
      {status && <div style={{color: status.startsWith('PGP') ? '#00ff41' : '#ff4444',marginTop:'8px',fontFamily:'monospace',fontSize:'12px'}}>{status}</div>}
    </div>
  );
}

// ============================================================
// ANTI-PHISHING PHRASE MANAGER
// ============================================================
function AntiPhishingPhraseManager({ currentUser, sessionToken }) {
  const [phrase, setPhrase] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [status, setStatus] = React.useState('');
  const [loading, setLoading] = React.useState(false);

  const savePhrase = async () => {
    if (!phrase.trim() || !password.trim()) { setStatus('Fill all fields'); return; }
    if (!sessionToken) { setStatus('Session expired. Please log in again.'); return; }
    setLoading(true);
    try {
      const resp = await fetch('/api/user/anti-phishing-phrase', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sessionToken}`
        },
        body: JSON.stringify({username: currentUser.username, phrase: phrase.trim(), password: password.trim()})
      });
      const data = await resp.json();
      if (resp.ok) {
        setStatus('Anti-phishing phrase saved! You will see it on every login.');
        setPhrase('');
        setPassword('');
      } else {
        setStatus('Error: ' + (data.message || data.detail));
      }
    } catch(e) {
      setStatus('Connection error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-[#111] border border-amber-900/30 rounded-3xl p-6 shadow-2xl">
      <h3 className="text-amber-500 text-sm font-black tracking-widest uppercase not-italic">Anti-phishing phrase</h3>
      <p className="text-gray-500 text-[11px] normal-case not-italic font-medium mt-1">
        Set a secret phrase shown on every login. If you do not see your phrase, you are on a phishing site.
      </p>
      <input
        value={phrase}
        onChange={e => setPhrase(e.target.value)}
        placeholder="Your secret phrase (e.g. purple elephant 42)"
        className="w-full bg-black border border-white/10 rounded-lg px-3 py-2 text-amber-500 text-sm font-mono not-italic mt-4 mb-2"
      />
      <input
        type="password"
        value={password}
        onChange={e => setPassword(e.target.value)}
        placeholder="Confirm with your passphrase"
        className="w-full bg-black border border-white/10 rounded-lg px-3 py-2 text-amber-500 text-sm font-mono not-italic mb-3"
      />
      <button
        onClick={savePhrase}
        disabled={loading}
        className="bg-amber-600 text-black px-4 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wide hover:bg-amber-500 not-italic disabled:opacity-50"
      >
        {loading ? 'SAVING...' : 'SET PHRASE'}
      </button>
      {status && (
        <div className={`mt-2 text-xs font-mono normal-case not-italic ${status.startsWith('Anti') ? 'text-green-400' : 'text-red-400'}`}>
          {status}
        </div>
      )}
    </div>
  );
}

function SessionSecurityCenter({ currentUser }) {
  const [sessions, setSessions] = React.useState([]);
  const [loading, setLoading] = React.useState(false);
  const [status, setStatus] = React.useState('');

  const getToken = () => {
    try {
      const raw = localStorage.getItem('silkGenesis_session');
      if (!raw) return '';
      const parsed = JSON.parse(raw);
      return parsed?.session_token || '';
    } catch {
      return '';
    }
  };

  const loadSessions = async () => {
    const token = getToken();
    if (!token) {
      setStatus('No active session token found. Re-login to enable session controls.');
      setSessions([]);
      return;
    }
    setLoading(true);
    setStatus('');
    try {
      const res = await fetch('/api/security/sessions', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (res.ok) {
        setSessions(Array.isArray(data.sessions) ? data.sessions : []);
      } else {
        setStatus('Error: ' + (data.detail || 'Failed to load sessions'));
      }
    } catch (e) {
      setStatus('Connection error');
    } finally {
      setLoading(false);
    }
  };

  const logoutOtherDevices = async () => {
    const token = getToken();
    if (!token) return;
    if (!window.confirm('Terminate all other active sessions?')) return;
    setLoading(true);
    setStatus('');
    try {
      const res = await fetch('/api/security/sessions/logout-all', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({})
      });
      const data = await res.json();
      if (res.ok) {
        setStatus(`Done: ${data.closed_sessions || 0} session(s) terminated.`);
        await loadSessions();
      } else {
        setStatus('Error: ' + (data.detail || 'Failed to terminate sessions'));
      }
    } catch (e) {
      setStatus('Connection error');
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => {
    if (currentUser?.username) loadSessions();
  }, [currentUser?.username]);

  return (
    <div className="bg-[#111] border border-amber-900/30 rounded-3xl p-6 shadow-2xl">
      <h3 className="text-amber-500 text-sm font-black tracking-widest uppercase not-italic">Session security center</h3>
      <p className="text-gray-500 text-[11px] normal-case not-italic font-medium mt-1">
        Monitor active sessions and terminate all other devices instantly.
      </p>
      <div className="flex gap-2 mb-3 mt-4">
        <button onClick={loadSessions} disabled={loading} className="bg-black border border-white/10 rounded-lg px-3 py-2 text-gray-300 text-[10px] font-bold uppercase not-italic hover:bg-white/5 disabled:opacity-50">
          {loading ? 'LOADING...' : 'REFRESH SESSIONS'}
        </button>
        <button onClick={logoutOtherDevices} disabled={loading} className="bg-amber-600 text-black px-4 py-2 rounded-xl text-[10px] font-bold uppercase hover:bg-amber-500 disabled:opacity-50 not-italic">
          LOGOUT OTHER DEVICES
        </button>
      </div>
      {sessions.length > 0 ? (
        <div className="bg-black border border-white/10 rounded-xl p-3 max-h-[180px] overflow-auto">
          {sessions.map((s, i) => (
            <div key={i} className={`py-2 ${i === sessions.length - 1 ? '' : 'border-b border-white/5'}`}>
              <div className="text-amber-500 text-xs font-mono normal-case not-italic">Session {s.token_preview}</div>
              <div className="text-gray-500 text-[10px] font-mono normal-case not-italic">Active {Math.floor((s.idle_seconds || 0) / 60)} min ago · Age {Math.floor((s.age_seconds || 0) / 60)} min</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-gray-500 text-xs normal-case not-italic">No active sessions found.</div>
      )}
      {status && (
        <div className={`mt-2 text-xs font-mono normal-case not-italic ${status.startsWith('Done') ? 'text-green-400' : 'text-red-400'}`}>
          {status}
        </div>
      )}
    </div>
  );
}

// ============================================================
// Identity: 2FA (TOTP) — visible in Profile tab, above PGP
// ============================================================
function TwoFactorIdentityPanel({ username, sessionToken, onEnabled, onDisabled }) {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [disableCode, setDisableCode] = useState('');
  const [disableErr, setDisableErr] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!username) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const r = await fetch(`/api/2fa/status/${encodeURIComponent(username)}`);
      const d = await r.json();
      if (r.ok) setStatus(d);
      else setStatus({ enabled: false, backup_codes_remaining: 0 });
    } catch {
      setStatus({ enabled: false, backup_codes_remaining: 0 });
    } finally {
      setLoading(false);
    }
  }, [username]);

  useEffect(() => { load(); }, [load]);

  const doDisable = async (e) => {
    e?.preventDefault();
    if (!disableCode || disableCode.length !== 6) {
      setDisableErr('Enter your current 6-digit authenticator code.');
      return;
    }
    setBusy(true);
    setDisableErr('');
    try {
      const r = await fetch('/api/2fa/disable', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
        },
        body: JSON.stringify({ username, code: disableCode.replace(/\s/g, '') }),
      });
      const d = await r.json();
      if (!r.ok) {
        setDisableErr(typeof d.detail === 'string' ? d.detail : 'Failed to disable 2FA');
        setBusy(false);
        return;
      }
      setDisableCode('');
      onDisabled?.();
      await load();
    } catch {
      setDisableErr('Network error');
    }
    setBusy(false);
  };

  if (!username) return null;

  return (
    <div className="bg-[#111] border border-amber-900/30 rounded-3xl p-6 shadow-2xl">
      <div>
        <h3 className="text-amber-500 text-sm font-black tracking-widest uppercase not-italic flex items-center gap-2">
          <Key size={18} /> Two-factor authentication (2FA)
        </h3>
        <p className="text-gray-500 text-[11px] normal-case not-italic font-medium mt-1 max-w-xl">
          Set up 2FA here. This is an offline TOTP (one-time password) flow generated locally by your authenticator app. After enabling, store backup codes in a safe place.
        </p>
      </div>
      {loading ? (
        <p className="text-gray-500 text-xs mt-4">Loading…</p>
      ) : status?.enabled ? (
        <div className="mt-4 space-y-3">
          <p className="text-green-500 text-xs font-mono not-italic">
            ● 2FA is on · {status.backup_codes_remaining ?? 0} backup code(s) left
          </p>
          <form onSubmit={doDisable} className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-end max-w-lg">
            <div className="flex-1">
              <label className="text-[10px] text-gray-500 block mb-1 normal-case not-italic">
                Turn off 2FA (current 6-digit code)
              </label>
              <input
                value={disableCode}
                onChange={e => setDisableCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                className="w-full bg-black border border-white/10 rounded-lg px-3 py-2 text-amber-500 text-sm font-mono not-italic"
                placeholder="000000"
                inputMode="numeric"
                autoComplete="one-time-code"
              />
            </div>
            <button
              type="submit"
              disabled={busy}
              className="bg-red-900/40 text-red-300 border border-red-800/50 px-4 py-2 rounded-lg text-[10px] font-bold uppercase hover:bg-red-800/50 disabled:opacity-50 not-italic"
            >
              {busy ? '…' : 'Turn off 2FA'}
            </button>
          </form>
          {disableErr && <p className="text-red-400 text-xs normal-case not-italic">{disableErr}</p>}
        </div>
      ) : (
        <div className="mt-4">
          <p className="text-amber-600/80 text-xs not-italic mb-3">2FA is not enabled for this account.</p>
          <button
            type="button"
            onClick={() => setShowModal(true)}
            className="bg-amber-600 text-black px-4 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wide hover:bg-amber-500 not-italic"
          >
            Set up 2FA
          </button>
        </div>
      )}
      {showModal && (
        <TwoFactorSetup
          user={username}
          token={sessionToken}
          onClose={() => { setShowModal(false); load(); }}
          onEnabled={() => {
            onEnabled?.();
            setShowModal(false);
            load();
          }}
        />
      )}
    </div>
  );
}

function LoginPage({ onLogin, onRegister }) {
  const [isRegister, setIsRegister] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [captchaToken, setCaptchaToken] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [awaiting2fa, setAwaiting2fa] = useState(false);
  const [totpCode, setTotpCode] = useState('');
  const [login2faError, setLogin2faError] = useState('');
  const [loginBusy, setLoginBusy] = useState(false);
  const [showMandatory2faSetup, setShowMandatory2faSetup] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!captchaToken) return;
    if (isRegister) {
      const success = await onRegister(username, password, captchaToken);
      if (success) setIsRegister(false);
      return;
    }
    setLoginBusy(true);
    try {
      const code = awaiting2fa ? totpCode.trim() : '';
      if (awaiting2fa && !code) {
        alert('Enter your 6-digit authenticator code (or a backup code).');
        return;
      }
      const result = await onLogin(username, password, captchaToken, code);
      if (result === '2fa_required') {
        setAwaiting2fa(true);
        setTotpCode('');
        setLogin2faError('');
        return;
      }
      if (result === '2fa_setup_required') {
        setShowMandatory2faSetup(true);
        setAwaiting2fa(false);
        setTotpCode('');
        setLogin2faError('');
        return;
      }
      if (result === 'invalid_2fa') {
        setLogin2faError('Invalid 2FA code. Try again.');
        setTotpCode('');
        return;
      }
      if (result === 'success') {
        setAwaiting2fa(false);
        setTotpCode('');
        setLogin2faError('');
      }
    } finally {
      setLoginBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#050505] bg-[radial-gradient(circle_at_top,rgba(245,158,11,0.15),transparent_55%)] flex items-center justify-center p-4 font-mono relative uppercase italic font-black text-center">
      <div className="w-full max-w-lg bg-[#0d0d0d]/95 border border-amber-500/60 p-12 rounded-3xl shadow-[0_0_25px_rgba(245,158,11,0.4),0_0_80px_rgba(245,158,11,0.12)]">
        <div className="text-center mb-10">
          <img src={Logo} alt="SilkGenesis" className="h-16 mx-auto mb-8"/>
          <p className="text-[10px] text-amber-300 tracking-[0.7em] border-t border-amber-500/30 pt-5 uppercase">
            {isRegister ? "Fabricate New Identity" : "Authentication Gateway"}
          </p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-6">
          <input
            type="text"
            placeholder="USER ID"
            value={username}
            disabled={awaiting2fa}
            className="w-full bg-black/70 border-2 border-amber-500/25 p-5 rounded-2xl text-amber-200 outline-none text-lg font-black placeholder:text-amber-200/45 focus:border-amber-400 disabled:opacity-50"
            onChange={(e) => { setUsername(e.target.value); }}
          />
          {!isRegister && (
            <div style={{minHeight:'28px'}}>
              <div style={{background:'rgba(0,20,0,0.5)',border:'1px solid #444',padding:'8px 12px',borderRadius:'8px',color:'#888',fontSize:'10px',fontFamily:'monospace',textAlign:'center'}}>
                Anti-phishing phrase is only shown after successful login (never before password).
              </div>
            </div>
          )}
          <input
            type="password"
            placeholder="PASSPHRASE"
            value={password}
            disabled={awaiting2fa}
            className="w-full bg-black/70 border-2 border-amber-500/25 p-5 rounded-2xl text-amber-200 outline-none text-lg font-black placeholder:text-amber-200/45 focus:border-amber-400 disabled:opacity-50"
            onChange={(e) => setPassword(e.target.value)}
          />
          {!isRegister && awaiting2fa && (
            <div className="space-y-2">
              <p className="text-[10px] text-amber-400/90 normal-case not-italic font-medium text-left">
                This account has 2FA enabled. Enter the 6-digit code from your authenticator app (or a backup code).
              </p>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="000000"
                value={totpCode}
                onChange={(e) => { setTotpCode(e.target.value.replace(/\s/g, '')); setLogin2faError(''); }}
                className="w-full bg-black/70 border-2 border-amber-500/50 p-5 rounded-2xl text-amber-200 outline-none text-2xl font-mono tracking-[0.35em] text-center not-italic placeholder:text-amber-200/45 focus:border-amber-400"
              />
              {login2faError ? (
                <p className="text-[11px] text-red-400/95 normal-case not-italic font-medium text-center">{login2faError}</p>
              ) : null}
              <button
                type="button"
                onClick={() => { setAwaiting2fa(false); setTotpCode(''); setLogin2faError(''); }}
                className="text-[10px] text-gray-500 hover:text-amber-300 normal-case not-italic underline"
              >
                Change username / password
              </button>
            </div>
          )}
          <div className="bg-black border border-amber-700/30 p-6 rounded-2xl text-center space-y-4 shadow-inner">
            {!captchaToken ? (
              <button type="button" onClick={() => setIsModalOpen(true)} className="w-full py-3.5 border-2 border-amber-500/40 text-amber-200 text-[10px] uppercase hover:bg-amber-700/20 flex items-center justify-center gap-3 rounded-xl">
                <Fingerprint size={18}/> Run integrity check
              </button>
            ) : (
              <div className="flex items-center justify-center gap-3 text-green-500 font-black text-[11px] py-2 animate-pulse uppercase">
                <ShieldCheck size={20}/><span>GATEWAY ACCESS CONFIRMED</span>
              </div>
            )}
          </div>
          <ClockCaptcha isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} onVerify={setCaptchaToken}/>
          <button type="submit" disabled={!captchaToken || loginBusy} className={`w-full py-5 rounded-2xl tracking-[0.4em] text-[13px] font-black transition-all ${captchaToken && !loginBusy ? 'bg-amber-500 text-black hover:bg-amber-400 shadow-[0_0_20px_rgba(245,158,11,0.45)]' : 'bg-gray-900 text-gray-700'}`}>
            {loginBusy ? '…' : isRegister ? 'Fabricate Identity' : awaiting2fa ? 'Verify 2FA' : 'Initialize Access'}
          </button>
          <p className="text-[10px] text-gray-300 mt-4 cursor-pointer hover:text-amber-300 transition-colors uppercase" onClick={() => {setIsRegister(!isRegister); setCaptchaToken(null); setAwaiting2fa(false); setTotpCode(''); setLogin2faError('');}}>
            {isRegister ? "Already in network? Login" : "No node found? Register"}
          </p>
        </form>
        {showMandatory2faSetup && (
          <TwoFactorSetup
            user={username.trim()}
            password={password.trim()}
            onClose={() => setShowMandatory2faSetup(false)}
            onEnabled={() => {
              setShowMandatory2faSetup(false);
              setAwaiting2fa(true);
              setLogin2faError('2FA enabled. Enter your authenticator code to complete login.');
              setTotpCode('');
            }}
          />
        )}
      </div>
    </div>
  );
}

// ============================================================
// CATEGORY SIDEBAR COMPONENT
// ============================================================
function CategorySidebar({ categories, selectedCategory, onSelectCategory, products }) {
  const [expandedCats, setExpandedCats] = useState({ "Drugs": true });

  const parentCats = categories.filter(c => !c.parent);

  const getCount = (catName) => {
    // Count products in this category and all its children
    const childNames = categories.filter(c => c.parent === catName).map(c => c.name);
    return products.filter(p => p.category === catName || childNames.includes(p.category)).length;
  };

  const toggleCat = (catName) => {
    setExpandedCats(prev => ({ ...prev, [catName]: !prev[catName] }));
  };

  return (
    <div className="space-y-1">
      {/* ALL */}
      <div
        onClick={() => onSelectCategory("All")}
        className={`flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer transition-all text-[11px] font-black uppercase ${
          selectedCategory === "All" ? 'text-amber-500 bg-amber-900/10 border-l-2 border-amber-500' : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'
        }`}
      >
        <span className="flex items-center gap-2">
          <span>🏪</span> All Listings
        </span>
        <span className="text-[9px] bg-white/5 px-1.5 py-0.5 rounded text-gray-600">{products.length}</span>
      </div>

      <div className="border-t border-white/5 my-2"/>

      {parentCats.map(cat => {
        const children = categories.filter(c => c.parent === cat.name);
        const hasChildren = children.length > 0;
        const isExpanded = expandedCats[cat.name];
        const isSelected = selectedCategory === cat.name;
        const count = getCount(cat.name);

        return (
          <div key={cat.name}>
            {/* PARENT CATEGORY */}
            <div
              className={`flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer transition-all group ${
                isSelected ? 'text-amber-500 bg-amber-900/10 border-l-2 border-amber-500' : 'text-gray-400 hover:text-gray-200 hover:bg-white/5'
              }`}
              onClick={() => {
                onSelectCategory(cat.name);
                if (hasChildren) toggleCat(cat.name);
              }}
            >
              <span className="flex items-center gap-2 text-[11px] font-black uppercase">
                <span className="text-base">{cat.icon || '📦'}</span>
                <span>{cat.name}</span>
              </span>
              <div className="flex items-center gap-1">
                {count > 0 && <span className="text-[9px] bg-white/5 px-1.5 py-0.5 rounded text-gray-600">{count}</span>}
                {hasChildren && (
                  isExpanded
                    ? <ChevronDown size={12} className="text-gray-600"/>
                    : <ChevronRight size={12} className="text-gray-600"/>
                )}
              </div>
            </div>

            {/* CHILD CATEGORIES */}
            {hasChildren && isExpanded && (
              <div className="ml-3 border-l border-amber-900/20 pl-2 mt-1 space-y-0.5">
                {children.map(sub => {
                  const subCount = products.filter(p => p.category === sub.name).length;
                  const isSubSelected = selectedCategory === sub.name;
                  return (
                    <div
                      key={sub.name}
                      onClick={() => onSelectCategory(sub.name)}
                      className={`flex items-center justify-between px-3 py-1.5 rounded cursor-pointer transition-all text-[10px] ${
                        isSubSelected ? 'text-amber-400 bg-amber-900/10' : 'text-gray-600 hover:text-gray-300 hover:bg-white/5'
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        <span>{sub.icon || '▸'}</span>
                        <span>{sub.name}</span>
                      </span>
                      {subCount > 0 && <span className="text-[9px] text-gray-700">{subCount}</span>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ============================================================
// ADMIN CATEGORY MANAGER
// ============================================================
function AdminCategoryManager({ categories, onAddCategory, onDeleteCategory }) {
  const [newCatName, setNewCatName] = useState('');
  const [newCatParent, setNewCatParent] = useState('');
  const [newCatIcon, setNewCatIcon] = useState('📦');
  const [activeTab, setActiveTab] = useState('tree'); // 'tree' | 'add'

  const parentCats = categories.filter(c => !c.parent);

  const handleAdd = async () => {
    if (!newCatName.trim()) { alert("Enter a category name"); return; }
    const ok = await onAddCategory(newCatName.trim(), newCatParent || null, newCatIcon);
    if (ok) { setNewCatName(''); setNewCatParent(''); setNewCatIcon('📦'); }
  };

  const ICON_OPTIONS = ['📦','💊','🌿','⚡','🍄','💉','🌀','❤️','💪','🏥','💳','🏦','💰','🪪','🖨️','💻','🔑','🦠','🔓','📚','🔐','🛠️','🧹','🔄','🔒','🔫','🎯','🔪','💎','📱','🔥','⭐','🎭','🎪'];

  return (
    <div className="bg-[#111] border border-white/5 p-8 rounded-3xl">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-white text-sm flex items-center gap-3"><Layers size={18}/> Directory Structure</h3>
        <div className="flex gap-2">
          <button onClick={() => setActiveTab('tree')} className={`px-4 py-2 rounded-lg text-[10px] font-black uppercase transition-all ${activeTab === 'tree' ? 'bg-amber-600 text-black' : 'border border-white/10 text-gray-500 hover:bg-white/5'}`}>Tree View</button>
          <button onClick={() => setActiveTab('add')} className={`px-4 py-2 rounded-lg text-[10px] font-black uppercase transition-all ${activeTab === 'add' ? 'bg-amber-600 text-black' : 'border border-white/10 text-gray-500 hover:bg-white/5'}`}>+ Add Category</button>
        </div>
      </div>

      {activeTab === 'add' && (
        <div className="bg-black/40 border border-amber-900/20 p-6 rounded-2xl mb-6 space-y-4">
          <h4 className="text-amber-500 text-[11px] uppercase font-black mb-4">Add New Category</h4>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[9px] text-gray-500 uppercase block mb-2">Category Name *</label>
              <input type="text" placeholder="e.g. Stimulants" value={newCatName} onChange={e => setNewCatName(e.target.value)}
                className="w-full bg-black border border-white/10 p-3 rounded-xl text-[11px] text-amber-500 outline-none"/>
            </div>
            <div>
              <label className="text-[9px] text-gray-500 uppercase block mb-2">Parent Category (optional)</label>
              <select value={newCatParent} onChange={e => setNewCatParent(e.target.value)}
                className="w-full bg-black border border-white/10 p-3 rounded-xl text-[11px] text-gray-400 outline-none">
                <option value="">- ROOT (Parent Category) -</option>
                {parentCats.map(c => <option key={c.name} value={c.name}>{c.icon} {c.name}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="text-[9px] text-gray-500 uppercase block mb-2">Icon</label>
            <div className="flex flex-wrap gap-2 mb-2">
              {ICON_OPTIONS.map(icon => (
                <button key={icon} onClick={() => setNewCatIcon(icon)}
                  className={`w-8 h-8 rounded text-lg flex items-center justify-center transition-all ${newCatIcon === icon ? 'bg-amber-600 scale-110' : 'bg-black/60 hover:bg-white/10'}`}>
                  {icon}
                </button>
              ))}
            </div>
            <p className="text-[9px] text-gray-600">Selected: <span className="text-amber-500">{newCatIcon}</span></p>
          </div>
          <button onClick={handleAdd} className="w-full py-3 bg-amber-600 text-black font-black uppercase text-[11px] rounded-xl hover:bg-amber-500 transition-all">
            ✓ Create Category
          </button>
        </div>
      )}

      {activeTab === 'tree' && (
        <div className="space-y-3">
          {parentCats.map(parent => {
            const children = categories.filter(c => c.parent === parent.name);
            return (
              <div key={parent.name} className="bg-black/40 border border-white/5 rounded-xl overflow-hidden">
                {/* PARENT */}
                <div className="flex items-center justify-between p-4 border-b border-white/5">
                  <div className="flex items-center gap-3">
                    <span className="text-xl">{parent.icon || '📦'}</span>
                    <span className="text-amber-500 font-black text-sm uppercase">{parent.name}</span>
                    <span className="text-[9px] bg-amber-900/20 text-amber-700 px-2 py-0.5 rounded">ROOT</span>
                  </div>
                  <button onClick={() => onDeleteCategory(parent.name)} className="text-red-900 hover:text-red-500 transition-all p-1 rounded hover:bg-red-900/10">
                    <Trash2 size={14}/>
                  </button>
                </div>
                {/* CHILDREN */}
                {children.length > 0 && (
                  <div className="p-3 space-y-1">
                    {children.map(child => (
                      <div key={child.name} className="flex items-center justify-between px-4 py-2 rounded-lg bg-black/20 group hover:bg-white/5">
                        <div className="flex items-center gap-3">
                          <span className="text-gray-600">└</span>
                          <span className="text-base">{child.icon || '▸'}</span>
                          <span className="text-gray-400 text-[11px]">{child.name}</span>
                        </div>
                        <button onClick={() => onDeleteCategory(child.name)} className="text-red-900 opacity-0 group-hover:opacity-100 hover:text-red-500 transition-all p-1 rounded">
                          <Trash2 size={12}/>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {children.length === 0 && (
                  <div className="px-4 py-2 text-[9px] text-gray-700 italic">No subcategories</div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ============================================================
// MESSAGES INBOX
// ============================================================
function MessagesInbox({ user, onOpenChat }) {
  const [conversations, setConversations] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadConversations();
    const interval = setInterval(loadConversations, 5000);
    return () => clearInterval(interval);
  }, [user]);

  const loadConversations = async () => {
    try {
      const res = await fetch(`/api/chat/conversations/${user.username}`);
      if (res.ok) {
        const data = await res.json();
        setConversations(data.conversations || []);
      }
    } catch (e) { console.error('Error loading conversations:', e); }
    finally { setLoading(false); }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <h2 className="text-3xl font-black text-white flex items-center gap-3">
        <MessageSquare size={32} className="text-amber-500"/> Messages
        {conversations.length > 0 && (
          <span className="text-sm bg-amber-600 text-black px-2 py-0.5 rounded-full">{conversations.length}</span>
        )}
      </h2>

      {loading ? (
        <div className="bg-[#111] border border-white/5 p-20 rounded-3xl text-center">
          <div className="w-8 h-8 border-2 border-amber-600 border-t-transparent rounded-full animate-spin mx-auto mb-4"/>
          <p className="text-gray-600 text-sm">Loading conversations...</p>
        </div>
      ) : conversations.length === 0 ? (
        <div className="bg-[#111] border border-white/5 p-20 rounded-3xl text-center">
          <MessageSquare size={64} className="mx-auto mb-4 opacity-10"/>
          <p className="text-gray-600 text-sm mb-4">No messages yet</p>
          <p className="text-[10px] text-gray-700">Contact vendors from product pages to start conversations</p>
        </div>
      ) : (
        <div className="space-y-3">
          {conversations.map((conv, idx) => {
            const otherUser = conv.buyer === user.username ? conv.vendor : conv.buyer;
            const lastMsg = conv.last_message;
            const unread = conv.unread || 0;
            return (
              <div
                key={idx}
                onClick={() => onOpenChat(otherUser)}
                className="bg-[#111] border border-white/5 p-5 rounded-2xl hover:border-amber-900/40 transition-all cursor-pointer group flex items-center gap-4"
              >
                {/* Avatar */}
                <div className="w-12 h-12 bg-gradient-to-br from-amber-900/30 to-purple-900/30 rounded-xl flex items-center justify-center text-xl font-black text-amber-500 border border-amber-900/20 flex-shrink-0">
                  {otherUser[0].toUpperCase()}
                </div>
                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-white font-black text-sm group-hover:text-amber-500 transition-colors">{otherUser}</span>
                    <span className="text-[9px] text-gray-600">{lastMsg ? new Date(lastMsg.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : ''}</span>
                  </div>
                  <p className="text-[11px] text-gray-500 truncate">
                    {lastMsg ? (lastMsg.sender === user.username ? 'You: ' : '') + lastMsg.message : 'No messages yet'}
                  </p>
                </div>
                {/* Unread badge */}
                {unread > 0 && (
                  <span className="bg-amber-600 text-black text-[9px] font-black px-1.5 py-0.5 rounded-full flex-shrink-0">{unread}</span>
                )}
                {/* Arrow */}
                <ChevronRight size={16} className="text-gray-700 group-hover:text-amber-500 transition-colors flex-shrink-0"/>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ============================================================
// VENDOR LEVEL CARD
// ============================================================
function VendorLevelCard({ username }) {
  const [levelData, setLevelData] = useState(null);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch(`/api/vendor/${username}/level`);
        if (res.ok) setLevelData(await res.json());
      } catch(e) {}
    };
    load();
  }, [username]);

  if (!levelData) return null;

  const { level, total_sales, total_volume_xmr, levels } = levelData;
  const currentIdx = levels.findIndex(l => l.name === level.name);
  const nextLevel = levels[currentIdx + 1];

  return (
    <div className="bg-[#111] border border-amber-900/20 rounded-3xl p-8 shadow-2xl">
      <h3 className="text-amber-500 mb-6 flex items-center gap-2 text-sm font-black uppercase">
        <Star size={18}/> Vendor Level
      </h3>
      {/* Current Level */}
      <div className="flex items-center gap-6 mb-6 p-4 bg-black/40 rounded-2xl border border-white/5">
        <div className="text-5xl">{level.icon}</div>
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-1">
            <span className="text-2xl font-black" style={{color: level.color}}>{level.name}</span>
            <span className="text-[9px] px-2 py-0.5 rounded border text-gray-500 border-gray-700">CURRENT LEVEL</span>
          </div>
          <div className="flex gap-6 text-[10px] text-gray-500">
            <span>📦 <span className="text-white font-black">{total_sales}</span> sales</span>
            <span>💰 <span className="text-amber-500 font-black">{total_volume_xmr.toFixed(4)}</span> XMR volume</span>
            <span>💸 Commission: <span className="text-green-500 font-black">{(level.commission * 100).toFixed(1)}%</span></span>
          </div>
        </div>
      </div>

      {/* Progress to next level */}
      {nextLevel && (
        <div className="mb-6">
          <div className="flex justify-between text-[10px] text-gray-500 mb-2">
            <span>Progress to <span style={{color: nextLevel.color}}>{nextLevel.icon} {nextLevel.name}</span></span>
            <span>{nextLevel.min_sales - total_sales} more sales needed</span>
          </div>
          <div className="h-2 bg-black rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${Math.min(100, (total_sales / nextLevel.min_sales) * 100)}%`,
                background: `linear-gradient(90deg, ${level.color}, ${nextLevel.color})`
              }}
            />
          </div>
        </div>
      )}

      {/* All levels */}
      <div className="grid grid-cols-3 gap-2">
        {levels.map((lvl, idx) => (
          <div key={lvl.name} className={`p-3 rounded-xl border text-center transition-all ${lvl.name === level.name ? 'border-amber-600/40 bg-amber-900/10' : idx < currentIdx ? 'border-green-900/20 bg-green-900/5' : 'border-white/5 bg-black/20 opacity-40'}`}>
            <div className="text-xl mb-1">{lvl.icon}</div>
            <div className="text-[9px] font-black" style={{color: lvl.color}}>{lvl.name}</div>
            <div className="text-[8px] text-gray-600 mt-1">{lvl.min_sales} sales</div>
            <div className="text-[8px] text-green-600">{(lvl.commission * 100).toFixed(1)}% fee</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// REFERRAL CARD
// ============================================================
function ReferralCard({ username }) {
  const [info, setInfo] = useState(null);
  const [applyCode, setApplyCode] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch(`/api/referral/${username}`);
        if (res.ok) setInfo(await res.json());
      } catch(e) {}
    };
    load();
  }, [username]);

  const copyCode = () => {
    if (info?.code) {
      navigator.clipboard.writeText(info.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const applyReferral = async () => {
    if (!applyCode.trim()) return;
    try {
      const res = await fetch('/api/referral/apply', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ code: applyCode.trim().toUpperCase(), username })
      });
      const data = await res.json();
      if (data.status === 'success') {
        alert(`✅ Referral applied!\nYou received ${data.bonus_received} XMR bonus!`);
        setApplyCode('');
        const res2 = await fetch(`/api/referral/${username}`);
        if (res2.ok) setInfo(await res2.json());
      } else {
        alert(`❌ ${data.detail || 'Error applying referral code'}`);
      }
    } catch(e) { alert('Connection error'); }
  };

  return (
    <div className="bg-[#111] border border-purple-900/20 rounded-3xl p-8 shadow-2xl">
      <h3 className="text-purple-400 mb-6 flex items-center gap-2 text-sm font-black uppercase">
        <UserPlus size={18}/> Referral Program
      </h3>

      <div className="grid grid-cols-2 gap-6">
        {/* MY REFERRAL CODE */}
        <div className="space-y-4">
          <h4 className="text-[10px] text-gray-500 uppercase font-black">Your Referral Code</h4>
          <div className="bg-black/60 border border-purple-900/30 p-4 rounded-xl">
            <div className="flex items-center justify-between mb-3">
              <code className="text-purple-400 font-black text-lg tracking-widest">{info?.code || '...'}</code>
              <button onClick={copyCode} className={`p-2 rounded-lg transition-all ${copied ? 'bg-green-600 text-black' : 'bg-purple-900/20 text-purple-400 hover:bg-purple-600 hover:text-black'}`}>
                {copied ? <CheckCircle size={16}/> : <Copy size={16}/>}
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3 text-[10px]">
              <div className="bg-black/40 p-2 rounded-lg text-center">
                <div className="text-purple-400 font-black text-lg">{info?.uses || 0}</div>
                <div className="text-gray-600">Referrals</div>
              </div>
              <div className="bg-black/40 p-2 rounded-lg text-center">
                <div className="text-amber-500 font-black text-lg">{(info?.earnings_xmr || 0).toFixed(4)}</div>
                <div className="text-gray-600">XMR Earned</div>
              </div>
            </div>
          </div>
          <div className="bg-purple-900/10 border border-purple-900/20 p-3 rounded-xl text-[9px] text-gray-500 space-y-1">
            <p>🎁 You earn <span className="text-purple-400 font-black">0.005 XMR</span> per referral</p>
            <p>🎁 New user gets <span className="text-amber-500 font-black">0.01 XMR</span> bonus</p>
            <p>📋 Share your code with friends!</p>
          </div>
        </div>

        {/* APPLY A CODE */}
        <div className="space-y-4">
          <h4 className="text-[10px] text-gray-500 uppercase font-black">Apply a Referral Code</h4>
          {info?.referred_by ? (
            <div className="bg-green-900/10 border border-green-900/30 p-4 rounded-xl text-center">
              <CheckCircle size={32} className="text-green-500 mx-auto mb-2"/>
              <p className="text-green-500 font-black text-sm">Already Referred!</p>
              <p className="text-[10px] text-gray-500 mt-1">Referred by: <span className="text-white">{info.referred_by}</span></p>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="bg-black/40 border border-white/5 p-4 rounded-xl">
                <p className="text-[9px] text-gray-600 mb-3">Enter a friend's referral code to get a bonus:</p>
                <input
                  type="text"
                  placeholder="SG-XXXX-XXXXXX"
                  value={applyCode}
                  onChange={e => setApplyCode(e.target.value.toUpperCase())}
                  className="w-full bg-black border border-white/10 p-3 rounded-xl text-[11px] text-purple-400 outline-none font-mono tracking-widest mb-3"
                />
                <button onClick={applyReferral} className="w-full py-3 bg-purple-600 text-black font-black uppercase text-[10px] rounded-xl hover:bg-purple-500 transition-all">
                  Apply Code -> Get 0.01 XMR
                </button>
              </div>
            </div>
          )}

          {/* REFERRAL LIST */}
          {info?.referrals?.length > 0 && (
            <div className="bg-black/40 border border-white/5 p-4 rounded-xl max-h-40 overflow-y-auto">
              <p className="text-[9px] text-gray-500 uppercase mb-2">Your Referrals:</p>
              {info.referrals.map((ref, idx) => (
                <div key={idx} className="flex justify-between text-[9px] py-1 border-b border-white/5">
                  <span className="text-gray-400">{ref.username}</span>
                  <span className="text-gray-600">{new Date(ref.joined_at).toLocaleDateString()}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// MY LISTINGS PAGE (VENDOR)
// ============================================================
function MyListingsPage({ user, products, onDeleteListing, onNewListing, xmrRate = 352 }) {
  const myProducts = products.filter(p => p.vendor === user.username);
  const totalSales = myProducts.reduce((sum, p) => sum + (p.sales || 0), 0);
  const totalRevenue = myProducts.reduce((sum, p) => sum + (parseFloat(p.price_xmr) * (p.sales || 0)), 0);

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* HEADER */}
      <div className="flex items-center justify-between">
        <h2 className="text-3xl font-black text-white flex items-center gap-3">
          <Package size={32} className="text-purple-500"/> My Listings
        </h2>
        <button onClick={onNewListing}
          className="bg-purple-600 text-black px-6 py-3 rounded-xl font-black text-[11px] hover:bg-purple-500 transition-all flex items-center gap-2">
          <PlusCircle size={16}/> + New Listing
        </button>
      </div>

      {/* STATS */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-[#111] border border-purple-900/20 p-6 rounded-2xl text-center">
          <p className="text-[10px] text-gray-500 uppercase mb-2">Active Listings</p>
          <p className="text-3xl font-black text-purple-400">{myProducts.length}</p>
        </div>
        <div className="bg-[#111] border border-amber-900/20 p-6 rounded-2xl text-center">
          <p className="text-[10px] text-gray-500 uppercase mb-2">Total Sales</p>
          <p className="text-3xl font-black text-amber-500">{totalSales}</p>
        </div>
        <div className="bg-[#111] border border-green-900/20 p-6 rounded-2xl text-center">
          <p className="text-[10px] text-gray-500 uppercase mb-2">Total Revenue</p>
          <p className="text-3xl font-black text-green-500">{totalRevenue.toFixed(4)} XMR</p>
          <p className="text-[9px] text-gray-600">${(totalRevenue * xmrRate).toFixed(2)}</p>
        </div>
      </div>

      {/* LISTINGS GRID */}
      {myProducts.length === 0 ? (
        <div className="bg-[#111] border border-white/5 p-20 rounded-3xl text-center">
          <Package size={64} className="mx-auto mb-4 opacity-10"/>
          <p className="text-gray-600 text-sm mb-4">No listings yet</p>
          <button onClick={onNewListing} className="bg-purple-600 text-black px-6 py-3 rounded-xl font-black text-[11px] hover:bg-purple-500 transition-all">
            Create Your First Listing
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {myProducts.map(p => (
            <div key={p.id} className="bg-[#111] border border-white/5 rounded-2xl overflow-hidden hover:border-purple-900/40 transition-all group shadow-xl">
              {/* IMAGE */}
              <div className="h-48 bg-black relative overflow-hidden">
                {p.image ? (
                  <img loading="lazy" src={p.image} alt={p.title} className="w-full h-full object-cover group-hover:scale-105 transition-all"/>
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <Package size={48} className="text-gray-800"/>
                  </div>
                )}
                {/* CATEGORY BADGE */}
                <div className="absolute top-3 left-3">
                  <span className="text-[9px] bg-black/80 text-amber-500 px-2 py-1 rounded-lg border border-amber-900/30 backdrop-blur-sm">
                    {p.category}
                  </span>
                </div>
                {/* DELETE BUTTON */}
                <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-all">
                  <button
                    onClick={() => onDeleteListing(p.id)}
                    className="bg-red-900/80 text-red-400 p-2 rounded-lg hover:bg-red-600 hover:text-white transition-all backdrop-blur-sm border border-red-900/40"
                    title="Delete listing"
                  >
                    <Trash2 size={14}/>
                  </button>
                </div>
              </div>

              {/* CONTENT */}
              <div className="p-5">
                <h3 className="text-white font-black text-sm mb-1 truncate group-hover:text-purple-400 transition-colors">{p.title}</h3>
                <p className="text-[10px] text-gray-600 mb-4 line-clamp-2">{p.description}</p>

                {/* PRICE & STATS */}
                <div className="flex items-center justify-between border-t border-white/5 pt-4">
                  <div>
                    <p className="text-lg text-amber-500 font-black">${(parseFloat(p.price_xmr) * xmrRate).toFixed(2)}</p>
                    <p className="text-[9px] text-gray-600">{parseFloat(p.price_xmr).toFixed(4)} XMR</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] text-gray-500">{p.sales || 0} sold</p>
                    <p className="text-[9px] text-green-600">{((p.sales || 0) * parseFloat(p.price_xmr)).toFixed(4)} XMR earned</p>
                  </div>
                </div>

                {/* PERFORMANCE BAR */}
                <div className="mt-3">
                  <div className="flex justify-between text-[9px] text-gray-600 mb-1">
                    <span>Performance</span>
                    <span>{p.sales || 0} sales</span>
                  </div>
                  <div className="h-1 bg-black rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-purple-600 to-amber-500 rounded-full transition-all"
                      style={{ width: `${Math.min(100, ((p.sales || 0) / 100) * 100)}%` }}
                    />
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================
// MAIN APP
// ============================================================

// ============================================================
// CATEGORY SELECT FIELD (for vendor product form)
// ============================================================
function CategorySelectField({ value, onChange }) {
  const [categories, setCategories] = React.useState([]);
  
  React.useEffect(() => {
    fetch(silkGenesisApiUrl('/api/categories/flat'))
      .then(r => r.json())
      .then(data => setCategories(data.categories || []))
      .catch(() => {});
  }, []);
  
  const parents = categories.filter(c => !c.parent_id);
  const getChildren = (pid) => categories.filter(c => c.parent_id === pid);
  
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value ? parseInt(e.target.value) : null)}
      style={{
        width: '100%',
        background: '#111827',
        border: '1px solid #374151',
        borderRadius: '8px',
        padding: '10px 12px',
        color: '#e2e8f0',
        fontSize: '13px',
        fontFamily: 'monospace',
        outline: 'none'
      }}
    >
      <option value="">- Select category -</option>
      {parents.map(p => (
        <React.Fragment key={p.id}>
          <option value={p.id}>{p.icon} {p.name}</option>
          {getChildren(p.id).map(c => (
            <option key={c.id} value={c.id}>　{c.icon} {c.name}</option>
          ))}
        </React.Fragment>
      ))}
    </select>
  );
}

function App() {
  const [user, setUser] = useState(null);
  const [sessionToken, setSessionToken] = useState(null);
  const [activeTab, setActiveTab] = useState('home');
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [balance, setBalance] = useState(0);
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [allUsers, setAllUsers] = useState([]);
  const [sellerRequests, setSellerRequests] = useState([]);
  const [disputes, setDisputes] = useState([]);
  const [xmrRate, setXmrRate] = useState(352.0);
  const [btcPrice, setBtcPrice] = useState(74000.00);
  const [xmrChange, setXmrChange] = useState(0);
  const [btcChange, setBtcChange] = useState(0);
  const [topVendors, setTopVendors] = useState([]);
  const [founderStats, setFounderStats] = useState({ claimed: 0, limit: 20 });
  const [topProducts, setTopProducts] = useState([]);
  const [showDepositModal, setShowDepositModal] = useState(false);
  const [showPGPKeyModal, setShowPGPKeyModal] = useState(false);
  const [newUserPGPData, setNewUserPGPData] = useState(null);
  const [showPGPModal, setShowPGPModal] = useState(false);
  const [orders, setOrders] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');

  // Navigation states
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [selectedVendor, setSelectedVendor] = useState(null);
  const [showGeneralChat, setShowGeneralChat] = useState(false);
  const [chatVendor, setChatVendor] = useState('');
  const [showOrderChat, setShowOrderChat] = useState(false);
  const [selectedOrderId, setSelectedOrderId] = useState('');
  const pgpSetupRequired = !!user && (user.role === 'buyer' || user.role === 'vendor') && !user.pgp_setup_completed;
  const authFailureHandledRef = React.useRef(false);

  // Wrapper for fetch that automatically adds session token
  useEffect(() => {
    try {
      const q = new URLSearchParams(window.location.search);
      const r = q.get('ref');
      if (r) sessionStorage.setItem('silk_pending_ref', r.trim());
      if (window.location.hash.replace(/^#/, '') === 'affiliation') {
        setActiveTab('affiliation');
      }
    } catch {
      /* ignore */
    }
  }, []);

  const authenticatedFetch = useCallback(async (url, options = {}) => {
    let token = sessionToken;
    if (!token) {
      try {
        const saved = localStorage.getItem('silkGenesis_session');
        if (saved) {
          const data = JSON.parse(saved);
          token = data.session_token;
        }
      } catch (e) {}
    }

    const headers = new Headers(options.headers || {});
    // Bearer for legacy clients/SDK; cookie auth is also sent via credentials:'include'.
    if (token) headers.set('Authorization', `Bearer ${token}`);
    // CSRF double-submit: copy the sg_csrf cookie value into the request header.
    const method = (options.method || 'GET').toUpperCase();
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      try {
        const m = (typeof document !== 'undefined' ? document.cookie : '')
          .split(/;\s*/)
          .map(s => s.split('='))
          .find(([k]) => decodeURIComponent(k || '') === 'sg_csrf');
        if (m && !headers.has('X-CSRF-Token')) headers.set('X-CSRF-Token', decodeURIComponent(m[1] || ''));
      } catch (e) { /* no-op */ }
    }

    const resolvedUrl =
      typeof url === 'string' && url.startsWith('/') && !url.startsWith('//')
        ? silkGenesisApiUrl(url)
        : url;
    const res = await fetch(resolvedUrl, {
      ...options,
      headers,
      credentials: options.credentials ?? 'include',
    });
    if (res.status === 401 && !authFailureHandledRef.current) {
      authFailureHandledRef.current = true;
      localStorage.removeItem('silkGenesis_session');
      setSessionToken(null);
      setUser(null);
      setActiveTab('home');
      alert('Session expired. Please login again.');
    }
    return res;
  }, [sessionToken]);

  // Keep homepage vendor/founder widgets fresh even if other dashboard calls fail.
  const refreshHomepagePanels = useCallback(async () => {
    try {
      const [tvRes, foundersRes] = await Promise.all([
        fetch(silkGenesisApiUrl('/api/top-vendors')),
        fetch(silkGenesisApiUrl('/api/founders/stats')),
      ]);

      if (tvRes.ok) {
        const d = await tvRes.json();
        setTopVendors(Array.isArray(d?.vendors) ? d.vendors : []);
      }
      if (foundersRes.ok) {
        const d = await foundersRes.json();
        setFounderStats({
          claimed: Number(d?.claimed || 0),
          limit: Number(d?.limit || 20),
        });
      }
    } catch (_) {
      // Non-blocking fallback: loadData() still handles these when available.
    }
  }, []);

  useEffect(() => {
    refreshHomepagePanels();
  }, [refreshHomepagePanels]);

  // Vendor panel states
  const [newTitle, setNewTitle] = useState('');
  const [newPriceUsd, setNewPriceUsd] = useState('');
  const [newCat, setNewCat] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newImage, setNewImage] = useState(null);

  // Admin states
  const [adminNewUser, setAdminNewUser] = useState('');
  const [adminNewPass, setAdminNewPass] = useState('');
  const [adminNewRole, setAdminNewRole] = useState('buyer');

  // VENDOR LEVEL & REFERRAL
  const [vendorLevel, setVendorLevel] = useState(null);
  const [referralInfo, setReferralInfo] = useState(null);
  const [referralCodeInput, setReferralCodeInput] = useState('');

  // DISPUTE STATE
  const [showDisputeModal, setShowDisputeModal] = useState(false);
  const [disputeOrderId, setDisputeOrderId] = useState('');
  const [disputeReason, setDisputeReason] = useState('');
  // PIN STATE
  const [showPinModal, setShowPinModal] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [pinAction, setPinAction] = useState(null);
  const [showSetPinModal, setShowSetPinModal] = useState(false);
  const [newPin, setNewPin] = useState('');
  const [hasPin, setHasPin] = useState(false);
  // ADMIN DISPUTES
  const [adminDisputes, setAdminDisputes] = useState([]);
  const [selectedDispute, setSelectedDispute] = useState(null);
  const [disputeChat, setDisputeChat] = useState([]);

  // ===== DISPUTE FUNCTIONS =====
  const openDisputeModal = (orderId) => {
    setDisputeOrderId(orderId);
    setDisputeReason('');
    setShowDisputeModal(true);
  };

  const submitDispute = async () => {
    if (!disputeReason.trim()) { alert('Please provide a reason'); return; }
    try {
      const res = await authenticatedFetch(`/api/orders/${disputeOrderId}/dispute`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ reason: disputeReason })
      });
      const data = await res.json();
      if (data.status === 'success') {
        alert('Dispute opened! Admin has been notified.');
        setShowDisputeModal(false);
        loadData();
      } else {
        alert(data.detail || 'Error opening dispute');
      }
    } catch(e) { alert('Connection error'); }
  };

  const releaseFunds = async (orderId) => {
    if (!window.confirm('Release funds to vendor? This cannot be undone.')) return;
    try {
      const res = await authenticatedFetch(`/api/orders/${orderId}/complete`, { method: 'POST' });
      const data = await res.json();
      if (data.status === 'success') {
        alert('Funds released to vendor!');
        loadData();
        if (user) setUser({...user, balance: user.balance});
      }
    } catch(e) { alert('Connection error'); }
  };

  // ===== PIN FUNCTIONS =====
  const requirePin = (action) => {
    if (!hasPin) { action(); return; }
    setPinAction(() => action);
    setPinInput('');
    setShowPinModal(true);
  };

  const verifyAndExecute = async () => {
    try {
      const res = await authenticatedFetch('/api/wallet/verify-pin', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ username: user.username, pin: pinInput })
      });
      const data = await res.json();
      if (data.status === 'success') {
        setShowPinModal(false);
        if (pinAction) pinAction();
      } else {
        alert('Invalid PIN!');
        setPinInput('');
      }
    } catch(e) { alert('Connection error'); }
  };

  const saveNewPin = async () => {
    if (newPin.length !== 6 || !/^\d+$/.test(newPin)) {
      alert('PIN must be exactly 6 digits'); return;
    }
    try {
      const res = await authenticatedFetch('/api/wallet/set-pin', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ username: user.username, pin: newPin })
      });
      const data = await res.json();
      if (data.status === 'success') {
        alert('PIN set successfully!');
        setHasPin(true);
        setShowSetPinModal(false);
        setNewPin('');
      } else {
        alert(data.detail || 'Error setting PIN');
      }
    } catch(e) { alert('Connection error'); }
  };

  // ===== ADMIN DISPUTES =====
  const loadAdminDisputes = async () => {
    try {
      const res = await authenticatedFetch('/api/admin/disputes');
      const data = await res.json();
      setAdminDisputes(Array.isArray(data) ? data : []);
    } catch(e) {}
  };

  const loadDisputeChat = async (disputeId) => {
    try {
      const res = await authenticatedFetch(`/api/admin/dispute/${disputeId}/chat`);
      const data = await res.json();
      setSelectedDispute(data.dispute);
      setDisputeChat(data.messages || []);
    } catch(e) {}
  };

  const resolveDispute = async (disputeId, winner) => {
    if (!window.confirm(`Resolve in favor of ${winner}?`)) return;
    try {
      const res = await authenticatedFetch('/api/admin/resolve-dispute', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ id: disputeId, winner })
      });
      const data = await res.json();
      if (data.status === 'success') {
        alert('Dispute resolved: ' + data.resolution);
        setSelectedDispute(null);
        loadAdminDisputes();
      }
    } catch(e) { alert('Connection error'); }
  };

    const loadData = async (userOverride = null) => {
    const activeUser = userOverride || user;
    try {
      const calls = [
        authenticatedFetch('/api/listings'),
        authenticatedFetch('/api/categories'),
        authenticatedFetch('/api/top-vendors'),
        authenticatedFetch('/api/founders/stats'),
        authenticatedFetch('/api/top-products'),
        authenticatedFetch('/api/crypto-prices')
      ];
      const isAdmin = activeUser?.role === 'admin';
      if (isAdmin) {
        calls.push(authenticatedFetch('/api/admin/users'));
        calls.push(authenticatedFetch('/api/admin/seller-requests'));
        calls.push(authenticatedFetch('/api/admin/disputes'));
      }
      if (activeUser) {
        calls.push(authenticatedFetch(`/api/orders/${activeUser.username}`));
        calls.push(authenticatedFetch(`/api/wallet/${activeUser.username}`));
      }
      const results = await Promise.all(calls);
      const [pRes, cRes, tvRes, foundersRes, tpRes, priceRes, ...restRes] = results;
      let uRes = null;
      let reqRes = null;
      let disRes = null;
      let ordersRes = null;
      let walletRes = null;
      let cursor = 0;
      if (activeUser?.role === 'admin') {
        uRes = restRes[cursor++];
        reqRes = restRes[cursor++];
        disRes = restRes[cursor++];
      }
      if (activeUser) {
        ordersRes = restRes[cursor++];
        walletRes = restRes[cursor++];
      }

      if (pRes.ok) { const d = await pRes.json(); setProducts(d.items || []); setXmrRate(d.rate || 352.0); }
      if (cRes.ok) { const d = await cRes.json(); setCategories(Array.isArray(d) ? d : []); }
      if (uRes.ok) setAllUsers(await uRes.json() || []);
      if (reqRes.ok) setSellerRequests(await reqRes.json() || []);
      if (disRes.ok) setDisputes(await disRes.json() || []);
      if (tvRes.ok) { const d = await tvRes.json(); setTopVendors(d.vendors || []); }
      if (foundersRes.ok) {
        const d = await foundersRes.json();
        setFounderStats({
          claimed: Number(d.claimed || 0),
          limit: Number(d.limit || 20),
        });
      }
      if (tpRes.ok) { const d = await tpRes.json(); setTopProducts(d.items || []); }
      if (priceRes.ok) {
        const d = await priceRes.json();
        setXmrRate(d.xmr.usd); setXmrChange(d.xmr.change_24h);
        setBtcPrice(d.btc.usd); setBtcChange(d.btc.change_24h);
      }
      if (ordersRes && ordersRes.ok) { const d = await ordersRes.json(); setOrders(d.orders || []); }
      if (walletRes && walletRes.ok) {
        const d = await walletRes.json();
        setBalance(d.balance);
        setUser(prev => ({ ...prev, balance: d.balance }));
      }
    } catch (err) { console.error("Backend Offline"); }
  };

  useEffect(() => {
    try {
      const saved = localStorage.getItem('silkGenesis_session');
      if (saved) {
        const data = JSON.parse(saved);
        if (data && data.user) {
          setUser(data.user);
          setSessionToken(data.session_token);
          setBalance(data.user.balance || 0);
          loadData(data.user);
        } else {
          // Corrupted session - remove it
          localStorage.removeItem('silkGenesis_session');
        }
      }
    } catch(e) {
      // Invalid JSON - remove session
      localStorage.removeItem('silkGenesis_session');
    }
  }, []);

  useEffect(() => {
    if (user) {
      const interval = setInterval(loadData, 10000);
      return () => clearInterval(interval);
    }
  }, [user]);

  // Defense in depth: never allow non-admin to stay on admin tabs.
  useEffect(() => {
    if (!user) return;
    const adminTabs = new Set(['admin_panel', 'admin_categories']);
    if (adminTabs.has(activeTab) && user.role !== 'admin') {
      setActiveTab('home');
    }
  }, [activeTab, user]);

  useEffect(() => {
    if (!user) return;
    if (user.role !== 'buyer' && activeTab === 'become_vendor') {
      setActiveTab('home');
    }
  }, [activeTab, user]);

  const handleAction = async (url, body) => {
    try {
      const res = await authenticatedFetch(`${url}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        if (url === '/api/user/update-avatar' && user?.username) {
          setUser(prev => {
            if (!prev) return prev;
            const next = { ...prev, avatar: data?.avatar ?? body?.avatar ?? null };
            try {
              const raw = localStorage.getItem('silkGenesis_session');
              if (raw) {
                const session = JSON.parse(raw);
                localStorage.setItem(
                  'silkGenesis_session',
                  JSON.stringify({ ...session, user: next })
                );
              }
            } catch {}
            return next;
          });
        }
        await loadData();
        return true;
      } else {
        const err = await res.json();
        alert(`ERROR: ${err.detail}`);
        return false;
      }
    } catch (e) { alert("SERVER ERROR"); return false; }
  };

  const handleDeposit = async (amount) => {
    const res = await authenticatedFetch('/api/wallet/deposit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: user.username, amount })
    });
    if (res.ok) {
      const data = await res.json();
      setBalance(data.new_balance);
      setUser(prev => ({ ...prev, balance: data.new_balance }));
      const session = JSON.parse(localStorage.getItem('silkGenesis_session'));
      session.user.balance = data.new_balance;
      localStorage.setItem('silkGenesis_session', JSON.stringify(session));
      alert(`DEPOSIT CONFIRMED: ${amount} XMR`);
      await loadData();
    }
  };

  const handleWithdraw = async (address, amount) => {
    if (amount > balance) return alert("INSUFFICIENT FUNDS");
    const res = await authenticatedFetch('/api/wallet/withdraw', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: user.username, address, amount })
    });
    if (res.ok) { const data = await res.json(); setBalance(data.new_balance); alert("TRANSFER BROADCASTED"); }
  };

  const deleteAccount = async () => {
    if (window.confirm("PERMANENT PURGE? Irreversible identity deletion.")) {
      await handleAction('/api/user/delete-account', { username: user.username });
      localStorage.removeItem('silkGenesis_session');
      setUser(null);
    }
  };

  const handleAddProduct = async (e) => {
    e.preventDefault();
    if (!newCat) { alert("Please select a category"); return; }
    if (!newImage) { alert("⚠️ Please upload a product image (required)"); return; }
    const xmrValue = parseFloat(newPriceUsd) / xmrRate;
    const ok = await handleAction('/api/listings', {
      title: newTitle, price_xmr: xmrValue, category: newCat,
      description: newDesc, vendor: user.username, image: newImage
    });
    if (ok) { alert("TRANSMISSION SUCCESS"); setNewTitle(''); setNewPriceUsd(''); setNewDesc(''); setNewImage(null); setActiveTab('home'); }
  };

  const handleLogin = async (usernameOrUser, passwordOrToken, tokenArg, totpCodeOpt = '') => {
    // Si le premier argument est un objet user (venant de LoginPage ou AntiPhishingLogin)
    if (usernameOrUser && typeof usernameOrUser === 'object' && usernameOrUser.username) {
      const userObj = usernameOrUser;
      const token = passwordOrToken; // session_token passed by LoginPage
      
      localStorage.setItem('silkGenesis_session', JSON.stringify({
        user: userObj, 
        status: 'success', 
        session_token: token
      }));
      
      setUser(userObj);
      setSessionToken(token);
      authFailureHandledRef.current = false;
      setBalance(userObj.balance || 0);
      loadData(userObj);
      return 'success';
    }
    // Sinon login classique (username, password, token [, totp_code])
    const username = usernameOrUser;
    const password = passwordOrToken;
    const totp_code = typeof totpCodeOpt === 'string' ? totpCodeOpt.trim() : '';
    try {
      const payload = { username, password };
      if (totp_code) {
        payload.totp_code = totp_code;
      } else {
        try {
          const { mineProofOfWork } = await import('./silkApi');
          payload.pow_solution = await mineProofOfWork('login');
        } catch {
          alert('Proof-of-Work failed. Try again.');
          return 'fail';
        }
      }
      const res = await fetch(silkGenesisApiUrl('/api/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (res.status === 429) {
        alert(data.message || data.detail || 'Too many attempts');
        return 'fail';
      }
      if (res.ok && data.status === '2fa_required') {
        return '2fa_required';
      }
      if (res.ok && data.status === '2fa_setup_required') {
        alert('2FA setup is mandatory for this role. Complete setup now.');
        return '2fa_setup_required';
      }
      if (res.status === 401 && data.detail === 'INVALID_2FA_CODE') {
        return 'invalid_2fa';
      }
      if (res.ok && data.status === 'success' && data.user) {
        if (data.anti_phishing_phrase) {
          window.alert(
            `Login successful.\n\nYour anti-phishing phrase:\n\n"${data.anti_phishing_phrase}"\n\nIf this does not match what you expect, log out immediately.`
          );
        }
        localStorage.setItem('silkGenesis_session', JSON.stringify(data));
        setUser(data.user);
        setSessionToken(data.session_token);
        authFailureHandledRef.current = false;
        setBalance(data.user.balance || 0);
        loadData(data.user);
        return 'success';
      }
      alert(data.detail || data.message || 'Access Denied');
      return 'fail';
    } catch (e) {
      alert('SERVER ERROR: Cannot connect to backend');
      return 'fail';
    }
  };

  const handleRegister = async (username, password /* legacy token arg ignored */) => {
    let referral_code = null;
    try {
      const pending = sessionStorage.getItem('silk_pending_ref');
      if (pending) referral_code = pending.trim().toUpperCase();
    } catch {
      /* ignore */
    }

    // 1) Mine PoW
    let pow_solution;
    try {
      const { mineProofOfWork } = await import('./silkApi');
      pow_solution = await mineProofOfWork('register');
    } catch {
      alert('Proof-of-Work failed. Try again.');
      return false;
    }

    // 2) Generate the PGP keypair LOCALLY (the server never sees the private key).
    let pgpKeys;
    try {
      const { generatePgpKeyPair, savePgpKeysLocal } = await import('./pgpClient');
      pgpKeys = await generatePgpKeyPair(username, password);
      savePgpKeysLocal(pgpKeys);
    } catch (e) {
      alert('PGP keypair generation failed in the browser: ' + (e?.message || e));
      return false;
    }

    const body = {
      username,
      password,
      pow_solution,
      pgp_public_key: pgpKeys.publicKey,
    };
    if (referral_code) body.referral_code = referral_code;

    const res = await fetch(silkGenesisApiUrl('/api/register'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body)
    });
    if (res.ok) {
      try {
        sessionStorage.removeItem('silk_pending_ref');
      } catch {
        /* ignore */
      }
      const data = await res.json();
      // Le client expose la cle privee armored (chiffree par passphrase) pour
      // que l'utilisateur la sauvegarde — le serveur ne l'a jamais vue.
      setNewUserPGPData({
        ...data,
        pgp_public_key: pgpKeys.publicKey,
        pgp_private_key_encrypted: pgpKeys.privateKey,
        pgp_fingerprint: pgpKeys.fingerprint,
        pgp_warning: data.pgp_warning,
      });
      setShowPGPKeyModal(true);
      return true;
    }
    else { const d = await res.json(); alert(d.detail); return false; }
  };

  const handleBuyProduct = async (listingId, escrowMode = 'auto') => {
    if (!window.confirm("INITIATE ESCROW TRANSACTION?")) return;
    try {
      const res = await authenticatedFetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ listing_id: listingId, buyer: user.username, escrow_mode: escrowMode })
      });
      const data = await res.json();
      if (res.ok && data?.order_id) {
        const modeLabel = (data.escrow_mode || escrowMode || 'standard').toUpperCase();
        alert(`✅ ESCROW ACTIVATED (${modeLabel})!\n${data.message}\nOrder ID: ${data.order_id}`);
        await loadData();
        setActiveTab('orders');
        return;
      }
      if (data?.detail === 'INSUFFICIENT_FUNDS') {
        alert("❌ Not enough XMR to buy this item.");
        return;
      }
      if (data?.detail === 'PGP_REQUIRED_FOR_ORDER') {
        alert("🔐 PGP required: buyer and vendor must both have a PGP public key before placing an order.");
        return;
      }
      if (data?.detail === 'SESSION_TOKEN_REQUIRED' || data?.detail === 'INVALID_SESSION') {
        alert("⏳ Session expired. Please log in again.");
        return;
      }
      alert(`ERROR: ${data?.detail || 'ORDER_CREATION_FAILED'}`);
    } catch (e) {
      alert("SERVER ERROR");
    }
  };

  const handleMarkShipped = async (orderId) => {
    const res = await authenticatedFetch(`/api/orders/${orderId}/mark-shipped`, { method: 'POST' });
    if (res.ok) { alert("📦 MARKED AS SHIPPED"); await loadData(); }
  };

  const handleCompleteOrder = async (orderId) => {
    const res = await authenticatedFetch(`/api/orders/${orderId}/complete`, { method: 'POST' });
    if (res.ok) { alert("✅ FUNDS RELEASED! Transferred to vendor."); await loadData(); }
  };

  const handleSubmitReview = async (orderId, vendor, rating, comment) => {
    try {
      const res = await fetch('/api/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_id: orderId, buyer: user.username, vendor, rating, comment })
      });
      if (res.ok) { alert("✅ REVIEW SUBMITTED!"); await loadData(); return true; }
      else { const err = await res.json(); alert(`ERROR: ${err.detail}`); return false; }
    } catch (e) { alert("SERVER ERROR"); return false; }
  };

  const handleAddCategory = async (name, parent, icon) => {
    const res = await fetch('/api/admin/add-category', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, parent: parent || null, icon })
    });
    if (res.ok) { await loadData(); return true; }
    else { const err = await res.json(); alert(`ERROR: ${err.detail}`); return false; }
  };

  const handleDeleteCategory = async (name) => {
    if (!window.confirm(`Delete category "${name}"?`)) return;
    await handleAction('/api/admin/delete-category', { name });
  };

  const handleUpgradeVendor = async () => {
    const cost = (400 / xmrRate).toFixed(4);
    if (balance < cost) {
      alert(`❌ INSUFFICIENT FUNDS\n\nRequired: ${cost} XMR ($400)\nYour balance: ${balance.toFixed(4)} XMR\n\nPlease deposit more XMR first.`);
      return;
    }
    if (!window.confirm(`VENDOR UPGRADE\n\nCost: ${cost} XMR ($400)\nYour balance: ${balance.toFixed(4)} XMR\n\nYour request will be sent to admin for approval.\n\nProceed?`)) return;
    const res = await fetch('/api/upgrade-vendor', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: user.username })
    });
    if (res.ok) {
      const data = await res.json();
      setBalance(data.new_balance);
      setUser(prev => ({ ...prev, balance: data.new_balance }));
      await loadData();
      alert(`✅ REQUEST SUBMITTED!\n\n${cost} XMR deducted.\nNew balance: ${data.new_balance.toFixed(4)} XMR\n\nAwaiting admin approval...`);
    } else {
      const err = await res.json();
      if (err.detail === 'INSUFFICIENT_FUNDS') alert(`❌ INSUFFICIENT FUNDS`);
      else if (err.detail === 'REQUEST_ALREADY_PENDING') alert(`⚠️ REQUEST ALREADY PENDING`);
      else alert(`ERROR: ${err.detail}`);
    }
  };

  // useMemo: evite recalcul du filtrage a chaque render
  const filteredProducts = useMemo(() => {
    let filtered = products;
    if (selectedCategory !== "All") {
      const childCats = categories.filter(c => c.parent === selectedCategory).map(c => c.name);
      filtered = filtered.filter(p => p.category === selectedCategory || childCats.includes(p.category));
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(p =>
        p.title.toLowerCase().includes(q) ||
        p.vendor.toLowerCase().includes(q) ||
        (p.description || '').toLowerCase().includes(q) ||
        (p.category || '').toLowerCase().includes(q)
      );
    }
    return filtered;
  }, [products, selectedCategory, searchQuery, categories]);

  const trendingProducts = useMemo(
    () => [...products].sort((a, b) => (b.sales || 0) - (a.sales || 0)).slice(0, 6),
    [products]
  );

  const freshDrops = useMemo(() => {
    const getTime = (p) => {
      const t = Date.parse(p?.created_at || '');
      return Number.isNaN(t) ? 0 : t;
    };
    return [...products].sort((a, b) => getTime(b) - getTime(a)).slice(0, 6);
  }, [products]);

  const staffCurated = useMemo(() => {
    const getTime = (p) => {
      const t = Date.parse(p?.created_at || '');
      return Number.isNaN(t) ? 0 : t;
    };
    return [...products]
      .sort((a, b) => {
        const scoreA = ((a.sales || 0) * 3) + (getTime(a) / 1e12);
        const scoreB = ((b.sales || 0) * 3) + (getTime(b) / 1e12);
        return scoreB - scoreA;
      })
      .slice(0, 4);
  }, [products]);

  const spotlightVendors = useMemo(() => topVendors.slice(0, 3), [topVendors]);

  const [showAdmin2FAModal, setShowAdmin2FAModal] = useState(false);
  const [admin2FAPendingTab, setAdmin2FAPendingTab] = useState('admin_panel');
  const [admin2FACode, setAdmin2FACode] = useState('');
  const [admin2FALoading, setAdmin2FALoading] = useState(false);

  const tryOpenAdminTab = useCallback(async (tab) => {
    if (user?.role !== 'admin') return;
    const localUntil = Number(localStorage.getItem('silkGenesis_admin_step_up_until') || 0);
    if (localUntil > Date.now()) {
      setActiveTab(tab);
      return;
    }
    let token = sessionToken;
    if (!token) {
      try {
        const raw = localStorage.getItem('silkGenesis_session');
        if (raw) token = JSON.parse(raw).session_token || '';
      } catch {}
    }
    if (!token) {
      alert('Session expired. Please log in again.');
      return;
    }
    try {
      const r = await authenticatedFetch('/api/health');
      const d = await r.json().catch(() => ({}));
      const meta = d && typeof d.admin_step_up === 'object' ? d.admin_step_up : null;
      if (r.status === 401) {
        alert('Session expired. Please log in again.');
        return;
      }
      if (!r.ok) {
        if (r.status === 404) {
          alert(
            'API not found (404). Ensure the backend is running on port 5000 (uvicorn market_server:app) and the frontend uses the dev proxy (npm start) or set REACT_APP_API_BASE to the API origin (e.g. http://127.0.0.1:5000).'
          );
        } else {
          alert(typeof d.detail === 'string' ? d.detail : 'Could not reach the API.');
        }
        return;
      }
      if (meta && meta.step_up_valid) {
        setActiveTab(tab);
        return;
      }
      const totpOn = meta ? !!meta.totp_enabled : !!user?.totp_enabled;
      if (!totpOn) {
        alert('Enable 2FA first: Identity tab → Two-factor authentication (2FA).');
        setActiveTab('profile');
        return;
      }
      if (meta && meta.totp_enabled) {
        setUser(prev => (prev ? { ...prev, totp_enabled: true } : prev));
      }
      setAdmin2FAPendingTab(tab);
      setAdmin2FACode('');
      setShowAdmin2FAModal(true);
    } catch {
      if (!user?.totp_enabled) {
        alert('Network error');
        return;
      }
      setAdmin2FAPendingTab(tab);
      setAdmin2FACode('');
      setShowAdmin2FAModal(true);
    }
  }, [user, sessionToken, authenticatedFetch]);

  const submitAdmin2FA = async () => {
    const raw = String(admin2FACode || '').trim();
    if (raw.length < 6) {
      alert('Enter the 6-digit code from your authenticator app (or a backup code).');
      return;
    }
    setAdmin2FALoading(true);
    try {
      const safe = raw.replace(/\s/g, '');
      const jsonHeaders = { 'Content-Type': 'application/json' };
      const verifyOpts = {
        method: 'POST',
        headers: jsonHeaders,
        body: JSON.stringify({ username: user?.username, code: safe }),
      };
      let r = await authenticatedFetch('/api/2fa/verify', verifyOpts);
      if (r.status === 404) {
        const body = JSON.stringify({ totp_code: safe });
        const postOpts = { method: 'POST', headers: jsonHeaders, body };
        r = await authenticatedFetch('/api/health/admin-step-up', postOpts);
        if (r.status === 404) {
          r = await authenticatedFetch('/api/auth/admin-panel-unlock', postOpts);
        }
        if (r.status === 404) {
          r = await authenticatedFetch('/api/session/admin-panel-unlock', postOpts);
        }
        if (r.status === 404) {
          r = await authenticatedFetch('/api/admin/panel-unlock', postOpts);
        }
      }
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        const msg =
          typeof d.detail === 'string'
            ? d.detail
            : typeof d.message === 'string'
              ? d.message
              : 'Invalid code';
        alert(msg);
        return;
      }
      localStorage.setItem('silkGenesis_admin_step_up_until', String(Date.now() + (4 * 3600 * 1000)));
      setShowAdmin2FAModal(false);
      setAdmin2FACode('');
      setActiveTab(admin2FAPendingTab);
    } catch {
      alert('Network error');
    } finally {
      setAdmin2FALoading(false);
    }
  };

  if (!user) return <LoginPage onLogin={handleLogin} onRegister={handleRegister}/>;

  const currentCatObj = categories.find(c => c.name === selectedCategory);

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-gray-300 font-sans uppercase italic font-black">
      {showPGPKeyModal && newUserPGPData && (
        <PGPPrivateKeyModal
          isOpen={showPGPKeyModal}
          onClose={() => { setShowPGPKeyModal(false); setNewUserPGPData(null); }}
          pgpData={newUserPGPData}
        />
      )}

      {showAdmin2FAModal && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.88)' }}
        >
          <div className="bg-[#0d0d0d] border border-amber-800/50 rounded-2xl p-6 max-w-md w-full shadow-2xl">
            <h3 className="text-amber-500 text-sm font-black tracking-widest uppercase not-italic mb-1 flex items-center gap-2">
              <Lock size={18} /> Admin 2FA verification
            </h3>
            <p className="text-gray-500 text-[11px] normal-case not-italic font-medium leading-relaxed mb-4">
              Enter the 6-digit code from your authenticator app (or a backup code) to open the admin panel. Stays unlocked for about 4 hours after a successful check.
            </p>
            <input
              type="text"
              value={admin2FACode}
              onChange={e => setAdmin2FACode(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && submitAdmin2FA()}
              placeholder="000000"
              className="w-full bg-black border border-amber-900/30 rounded-xl px-4 py-3 text-center text-2xl tracking-[0.4em] text-amber-500 font-mono not-italic outline-none focus:border-amber-600"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
            />
            <div className="flex gap-2 mt-4">
              <button
                type="button"
                onClick={() => { setShowAdmin2FAModal(false); setAdmin2FACode(''); }}
                className="flex-1 py-2.5 rounded-xl border border-white/10 text-gray-400 text-xs font-bold uppercase not-italic hover:bg-white/5"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submitAdmin2FA}
                disabled={admin2FALoading}
                className="flex-1 py-2.5 rounded-xl bg-amber-600 text-black text-xs font-bold uppercase not-italic hover:bg-amber-500 disabled:opacity-50"
              >
                {admin2FALoading ? '…' : 'Verify'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* HEADER */}
      <header className="sticky top-0 z-50 bg-[#111111]/95 border-b border-amber-900/40 shadow-2xl backdrop-blur-md">
        <AlphaBanner slotsUsed={founderStats.claimed || 0} />
        <div className="max-w-[1500px] mx-auto flex justify-between items-center px-6 py-4">
          <div className="w-[260px] pl-3">
            <img src={Logo} alt="SilkGenesis" className="h-10 cursor-pointer hover:scale-105 transition-all" onClick={() => { setActiveTab('home'); setSelectedCategory('All'); }}/>
          </div>

          {/* SEARCH BAR */}
          <div className="flex-1 max-w-md mx-8">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-600"/>
              <input
                type="text"
                placeholder="Search listings..."
                value={searchQuery}
                onChange={(e) => { const v = e.target.value; setActiveTab('home'); clearTimeout(window._searchTimer); window._searchTimer = setTimeout(() => setSearchQuery(v), 200); }}
                className="w-full bg-black/60 border border-white/10 pl-9 pr-4 py-2.5 rounded-xl text-[11px] text-gray-300 outline-none focus:border-amber-900/50 placeholder:text-gray-700 font-normal not-italic"
              />
            </div>
          </div>

          {/* CRYPTO PRICES */}
          <div className="flex items-center gap-4 text-[10px] font-mono">
            <div className="flex items-center gap-2 bg-black/40 px-3 py-2 rounded-lg border border-amber-900/20">
              <span className="text-gray-500">XMR:</span>
              <span className="text-amber-500 font-black">${xmrRate.toFixed(2)}</span>
              <span className={`flex items-center gap-1 ${xmrChange >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                {xmrChange >= 0 ? <TrendingUp size={10}/> : <TrendingDown size={10}/>}
                {Math.abs(xmrChange).toFixed(1)}%
              </span>
            </div>
            <div className="flex items-center gap-2 bg-black/40 px-3 py-2 rounded-lg border border-orange-900/20">
              <span className="text-gray-500">BTC:</span>
              <span className="text-orange-500 font-black">${btcPrice.toLocaleString()}</span>
              <span className={`flex items-center gap-1 ${btcChange >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                {btcChange >= 0 ? <TrendingUp size={10}/> : <TrendingDown size={10}/>}
                {Math.abs(btcChange).toFixed(1)}%
              </span>
            </div>
          </div>

          <div className="flex items-center gap-4 font-mono text-amber-500">
            <button onClick={() => setShowDepositModal(true)}
              className="bg-green-900/20 border border-green-600 px-3 py-2 rounded-xl text-[10px] hover:bg-green-600 hover:text-black transition-all flex items-center gap-2 font-black">
              <ArrowDownCircle size={12}/> DEPOSIT
            </button>
            <div className="text-right border-r border-amber-900/20 pr-4">
              <p className="text-[9px] text-gray-600 normal-case not-italic">
                ${(((Number(balance) || 0) * (Number(xmrRate) || 0))).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
              <p className="text-base tracking-tighter">
                {(Number(balance) || 0).toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 4 })} XMR
              </p>
            </div>
            <div className={`px-3 py-1 rounded border shadow-lg text-[10px] ${user.role === 'admin' ? 'border-red-600 text-red-600' : user.role === 'vendor' ? 'border-purple-500 text-purple-500' : 'border-blue-500 text-blue-500'}`}>
              {user.role === 'admin' ? 'ADMIN' : user.role === 'vendor' ? 'VENDOR' : 'BUYER'}
            </div>
            {user?.founder_vendor_badge && (
              <FounderVendorBadge />
            )}
            <button onClick={() => { localStorage.removeItem('silkGenesis_session'); setUser(null); }}
              className="bg-amber-900/10 border border-amber-600 px-3 py-1.5 rounded hover:bg-amber-600 transition-all font-black text-[10px]">
              Logout
            </button>
          </div>
        </div>
      </header>

      {/* DEPOSIT MODAL */}
      <PGPModal isOpen={showPGPModal} onClose={() => setShowPGPModal(false)} user={user}/>
      <DepositModal isOpen={showDepositModal} onClose={() => setShowDepositModal(false)} user={user} onDeposit={handleDeposit}/>

      {/* MAIN LAYOUT */}
      <div className="max-w-[1500px] mx-auto grid grid-cols-[260px_1fr] gap-6 p-6 font-mono">

        {/* ===== LEFT SIDEBAR ===== */}
        <aside className="space-y-4">
          {/* NAVIGATION */}
          <div className="border border-white/5 bg-white/[0.02] rounded-xl p-3 space-y-1 text-xs">
            <div onClick={() => { setActiveTab('home'); setSelectedCategory('All'); setSearchQuery(''); }}
              className={`p-2.5 rounded-lg cursor-pointer flex items-center transition-all ${activeTab === 'home' ? 'text-amber-500 bg-amber-900/10 border-l-4 border-amber-600' : 'hover:bg-white/5 text-gray-400'}`}>
              <Home className="mr-3" size={15}/> Market
            </div>
            {user.role === 'buyer' && (
              <div
                onClick={() => setActiveTab('become_vendor')}
                className={`p-2.5 rounded-lg cursor-pointer flex items-center border border-amber-900/20 transition-all ${activeTab === 'become_vendor' ? 'text-amber-500 bg-amber-900/15 border-l-4 border-amber-600' : 'hover:bg-amber-900/5 text-gray-400'}`}
              >
                <Rocket className="mr-3" size={15} /> Become vendor
              </div>
            )}
            <div onClick={() => setActiveTab('orders')}
              className={`p-2.5 rounded-lg cursor-pointer flex items-center transition-all ${activeTab === 'orders' ? 'text-amber-500 bg-amber-900/10 border-l-4 border-amber-600' : 'hover:bg-white/5 text-gray-400'}`}>
              <Shield className="mr-3" size={15}/> Orders
              {orders.filter(o => (o.buyer === user.username || o.vendor === user.username) && o.status !== 'completed').length > 0 && (
                <span className="ml-auto bg-amber-600 text-black text-[9px] px-1.5 py-0.5 rounded-full font-black">
                  {orders.filter(o => (o.buyer === user.username || o.vendor === user.username) && o.status !== 'completed').length}
                </span>
              )}
            </div>
            <div onClick={() => {
              if (pgpSetupRequired) {
                alert('Complete mandatory PGP setup in Identity before using Messages.');
                setActiveTab('profile');
                return;
              }
              setActiveTab('messages');
            }}
              className={`p-2.5 rounded-lg cursor-pointer flex items-center transition-all ${activeTab === 'messages' ? 'text-amber-500 bg-amber-900/10 border-l-4 border-amber-600' : 'hover:bg-white/5 text-gray-400'}`}>
              <MessageSquare className="mr-3" size={15}/> Messages
            </div>
            <div
              onClick={() => {
                setActiveTab('affiliation');
                try {
                  window.history.replaceState(
                    null,
                    '',
                    `${window.location.pathname}${window.location.search}#affiliation`
                  );
                } catch {
                  /* ignore */
                }
              }}
              className={`p-2.5 rounded-lg cursor-pointer flex items-center border border-purple-900/20 transition-all ${activeTab === 'affiliation' ? 'text-purple-400 bg-purple-900/15 border-l-4 border-purple-500' : 'hover:bg-purple-900/5 text-gray-400'}`}
            >
              <Share2 className="mr-3" size={15} /> Affiliation
            </div>
            {user.role === 'admin' && (
              <div onClick={() => tryOpenAdminTab('admin_panel')}
                className={`p-2.5 rounded-lg cursor-pointer flex items-center border border-red-900/20 transition-all ${activeTab === 'admin_panel' ? 'bg-red-900/20 text-red-500 border-l-4 border-red-600' : 'hover:bg-red-900/5 text-gray-400'}`}>
                <Terminal className="mr-3" size={15}/> Control
              </div>
            )}
            {user.role === 'vendor' && (
              <>
                <div onClick={() => setActiveTab('vendor_panel')}
                  className={`p-2.5 rounded-lg cursor-pointer flex items-center border border-purple-900/20 transition-all ${activeTab === 'vendor_panel' ? 'bg-purple-900/20 text-purple-500 border-l-4 border-purple-600' : 'hover:bg-purple-900/5 text-gray-400'}`}>
                  <PlusCircle className="mr-3" size={15}/> New Listing
                </div>
                <div onClick={() => setActiveTab('my_listings')}
                  className={`p-2.5 rounded-lg cursor-pointer flex items-center border border-purple-900/20 transition-all ${activeTab === 'my_listings' ? 'bg-purple-900/20 text-purple-500 border-l-4 border-purple-600' : 'hover:bg-purple-900/5 text-gray-400'}`}>
                  <Package className="mr-3" size={15}/> My Listings
                </div>
                <div onClick={() => setActiveTab('vendor_dashboard')}
                  className={`p-2.5 rounded-lg cursor-pointer flex items-center border border-amber-900/20 transition-all ${activeTab === 'vendor_dashboard' ? 'bg-amber-900/20 text-amber-500 border-l-4 border-amber-600' : 'hover:bg-amber-900/5 text-gray-400'}`}>
                  <DollarSign className="mr-3" size={15}/> Earnings
                </div>
              </>
            )}
            <div onClick={() => setActiveTab('profile')}
              className={`p-2.5 rounded-lg cursor-pointer flex items-center transition-all ${activeTab === 'profile' ? 'text-amber-500 bg-amber-900/10 border-l-4 border-amber-600' : 'hover:bg-white/5 text-gray-400'}`}>
              <Lock className="mr-3" size={15}/> Security
            </div>
            <div onClick={() => setActiveTab('wallet')}
              className={`p-2.5 rounded-lg cursor-pointer flex items-center transition-all ${activeTab === 'wallet' ? 'text-amber-500 bg-amber-900/10 border-l-4 border-amber-600' : 'hover:bg-white/5 text-gray-400'}`}>
              <Wallet className="mr-3" size={15}/> Wallet
            </div>
            <div onClick={() => setActiveTab('about')}
              className={`p-2.5 rounded-lg cursor-pointer flex items-center transition-all ${activeTab === 'about' ? 'text-amber-500 bg-amber-900/10 border-l-4 border-amber-600' : 'hover:bg-white/5 text-gray-400'}`}>
              <Globe className="mr-3" size={15}/> About / Canary
            </div>
          </div>

          {/* BROWSER / CATEGORIES */}
          <div className="border border-white/5 bg-white/[0.02] rounded-xl p-3">
            <h3 className="text-[9px] text-gray-600 mb-3 tracking-[0.3em] border-b border-white/5 pb-2 uppercase flex items-center gap-2">
              <Filter size={10}/> Browser
            </h3>
            <CategorySidebar
              categories={categories}
              selectedCategory={selectedCategory}
              onSelectCategory={(cat) => { setSelectedCategory(cat); setActiveTab('home'); setSearchQuery(''); }}
              products={products}
            />
          </div>

          {/* MARKET STATS */}
          <div className="border border-white/5 bg-white/[0.02] rounded-xl p-4 space-y-3">
            <h3 className="text-[9px] text-gray-600 tracking-[0.3em] uppercase">Market Stats</h3>
            <div className="space-y-2">
              <div className="flex justify-between text-[10px]">
                <span className="text-gray-600">Total Listings</span>
                <span className="text-amber-500 font-black">{products.length}</span>
              </div>
              <div className="flex justify-between text-[10px]">
                <span className="text-gray-600">Categories</span>
                <span className="text-amber-500 font-black">{categories.length}</span>
              </div>
              <div className="flex justify-between text-[10px]">
                <span className="text-gray-600">Active Vendors</span>
                <span className="text-amber-500 font-black">{topVendors.length}</span>
              </div>
              <div className="flex justify-between text-[10px]">
                <span className="text-gray-600">Your Orders</span>
                <span className="text-amber-500 font-black">{orders.filter(o => o.buyer === user.username).length}</span>
              </div>
            </div>
          </div>
        </aside>

        {/* ===== MAIN CONTENT ===== */}
        <main>

          {/* ABOUT PAGE */}
          {activeTab === 'about' && (
            <AboutPage onNavigate={(tab) => setActiveTab(tab === 'market' ? 'home' : tab)} />
          )}

          {/* BECOME VENDOR (buyer only) */}
          {activeTab === 'become_vendor' && user?.role === 'buyer' && (
            <BecomeVendorPage
              xmrRate={xmrRate}
              balance={balance}
              onUpgrade={handleUpgradeVendor}
            />
          )}

          {activeTab === 'affiliation' && user && (
            <AffiliateProgramPage user={user} sessionToken={sessionToken} authenticatedFetch={authenticatedFetch} />
          )}

          {/* CANARY PAGE */}
          {activeTab === 'canary' && (
            <CanaryPage onNavigate={(tab) => setActiveTab(tab === 'market' ? 'home' : tab)} />
          )}

          {/* HOME / MARKET */}
          {activeTab === 'home' && (
            <div className="space-y-8">
              {/* CATEGORY HEADER */}
              {selectedCategory !== 'All' && (
                <div className="flex items-center gap-4 pb-4 border-b border-white/5">
                  <span className="text-3xl">{currentCatObj?.icon || '📦'}</span>
                  <div>
                    <h1 className="text-2xl font-black text-white">{selectedCategory}</h1>
                    <p className="text-[10px] text-gray-600">
                      {filteredProducts.length} listing{filteredProducts.length !== 1 ? 's' : ''} found
                      {currentCatObj?.parent && <span className="ml-2 text-amber-900">in {currentCatObj.parent}</span>}
                    </p>
                  </div>
                  <button onClick={() => { setSelectedCategory('All'); setSearchQuery(''); }}
                    className="ml-auto text-[10px] text-gray-600 hover:text-amber-500 border border-white/10 px-3 py-1.5 rounded-lg hover:border-amber-900/40 transition-all">
                    ✕ Clear Filter
                  </button>
                </div>
              )}

              {/* SEARCH RESULTS HEADER */}
              {searchQuery && (
                <div className="flex items-center gap-4 pb-4 border-b border-white/5">
                  <Search size={20} className="text-amber-500"/>
                  <div>
                    <h1 className="text-xl font-black text-white">Search: "{searchQuery}"</h1>
                    <p className="text-[10px] text-gray-600">{filteredProducts.length} result{filteredProducts.length !== 1 ? 's' : ''} found</p>
                  </div>
                  <button onClick={() => setSearchQuery('')}
                    className="ml-auto text-[10px] text-gray-600 hover:text-amber-500 border border-white/10 px-3 py-1.5 rounded-lg hover:border-amber-900/40 transition-all">
                    ✕ Clear Search
                  </button>
                </div>
              )}

              {/* TOP VENDORS - Only show on All/no search */}
              {selectedCategory === 'All' && !searchQuery && (
                <div className="bg-gradient-to-r from-amber-900/10 to-transparent border border-amber-900/20 rounded-3xl p-8">
                  <h2 className="text-amber-500 text-2xl font-black mb-2 flex items-center gap-3">
                    <Star size={24} className="fill-amber-500"/> Top Vendors
                  </h2>
                  <p className="text-[10px] text-amber-300/85 mb-6">
                    Founder slots claimed: {founderStats.claimed}/{founderStats.limit}
                  </p>
                  <div className="grid grid-cols-4 gap-4">
                    {topVendors.map(vendor => (
                      <div key={vendor.username}
                        onClick={() => { setSelectedVendor(vendor.username); setActiveTab('vendor-profile'); }}
                        className="bg-black/60 border border-white/5 p-4 rounded-xl hover:border-amber-900/40 transition-all group cursor-pointer">
                        <div className="w-16 h-16 bg-gradient-to-br from-amber-900/20 to-purple-900/20 rounded-full mx-auto mb-3 flex items-center justify-center text-2xl font-black text-amber-500">
                          {vendor.username[0]}
                        </div>
                        <h3 className="text-center text-white text-sm truncate group-hover:text-amber-500">{vendor.username}</h3>
                        {vendor.founder_vendor_badge && (
                          <div className="mt-2 flex justify-center">
                            <FounderVendorBadge compact />
                          </div>
                        )}
                        <div className="flex items-center justify-center gap-1 mt-2 text-[10px] text-amber-600">
                          <Star size={12} className="fill-amber-600"/> {vendor.rating}
                        </div>
                        <p className="text-center text-[9px] text-gray-600 mt-1">{vendor.sales} sales</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

{/* {/* TOP PRODUCTS - Only show on All/no search */}
{selectedCategory === 'All' && !searchQuery && (
  <div className="mb-10">
    <h2 className="text-white text-2xl font-black mb-6 flex items-center gap-3">
      <Star size={24} className="text-amber-500"/> Staff Curated
    </h2>
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
      {staffCurated.map(p => (
        <div key={`curated-${p.id}`}
          onClick={() => { setSelectedProduct(p); setActiveTab('product-detail'); }}
          className="bg-[#0a0a0a] border border-white/5 rounded-xl overflow-hidden hover:border-amber-500/40 transition-all cursor-pointer group shadow-lg">
          <div className="h-40 bg-black overflow-hidden flex items-center justify-center border-b border-white/5">
            {p.image ? (
              <img loading="lazy" src={p.image} className="w-full h-full object-cover group-hover:scale-105 transition-all" alt=""/>
            ) : (
              <Package size={24} className="text-gray-800"/>
            )}
          </div>
          <div className="p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[8px] bg-amber-900/20 text-amber-500 border border-amber-700/40 px-2 py-1 rounded uppercase font-black tracking-widest">
                Editor's Choice
              </span>
              <span className="text-[9px] text-gray-500">{p.sales || 0} sold</span>
            </div>
            <h4 className="text-white text-sm truncate group-hover:text-amber-500">{p.title}</h4>
            <p className="text-[10px] text-gray-600 mt-1 truncate">by <span className="text-gray-400">{p.vendor}</span></p>
            <div className="mt-3 flex justify-between items-center">
              <span className="text-amber-500 font-black">${(parseFloat(p.price_xmr) * xmrRate).toFixed(2)}</span>
              <span className="text-[9px] text-amber-700 group-hover:text-amber-500 transition-all uppercase tracking-wider font-bold">View</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  </div>
)}
{/* TRENDING + FRESH + SPOTLIGHT - homepage combo */}
{selectedCategory === 'All' && !searchQuery && (
  <>
    <div className="mb-10">
      <h2 className="text-white text-2xl font-black mb-6 flex items-center gap-3">
        <TrendingUp size={24} className="text-green-500"/> Trending This Week
      </h2>
      {trendingProducts.length === 0 ? (
        <div className="bg-[#111] border border-white/5 p-10 rounded-2xl text-center text-gray-600 text-sm">No trending products yet.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {trendingProducts.map(p => (
            <div key={`trend-${p.id}`}
              onClick={() => { setSelectedProduct(p); setActiveTab('product-detail'); }}
              className="bg-[#0a0a0a] border border-white/5 p-4 rounded-xl hover:border-green-500/40 transition-all cursor-pointer group">
              <div className="h-40 bg-black rounded-lg mb-4 overflow-hidden flex items-center justify-center border border-white/5">
                {p.image ? <img loading="lazy" src={p.image} className="w-full h-full object-cover group-hover:scale-105 transition-all" alt=""/> : <Package size={24} className="text-gray-800"/>}
              </div>
              <p className="text-[9px] text-gray-600 mb-1">{p.category}</p>
              <h4 className="text-white text-sm truncate group-hover:text-amber-500">{p.title}</h4>
              <div className="flex justify-between items-center mt-3">
                <span className="text-amber-500 font-black">${(parseFloat(p.price_xmr) * xmrRate).toFixed(2)}</span>
                <span className="text-[10px] text-green-500">{p.sales || 0} sold</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>

    <div className="mb-10">
      <h2 className="text-white text-2xl font-black mb-6 flex items-center gap-3">
        <Zap size={24} className="text-cyan-500"/> Fresh Drops
      </h2>
      {freshDrops.length === 0 ? (
        <div className="bg-[#111] border border-white/5 p-10 rounded-2xl text-center text-gray-600 text-sm">No fresh drops yet.</div>
      ) : (
        <div className="flex flex-col gap-3">
          {freshDrops.map(p => (
            <div key={`fresh-${p.id}`}
              onClick={() => { setSelectedProduct(p); setActiveTab('product-detail'); }}
              className="bg-[#0a0a0a] border border-white/5 p-3 rounded-xl hover:border-cyan-500/40 transition-all cursor-pointer group flex items-center">
              <div className="w-16 h-16 bg-black rounded-lg overflow-hidden flex-shrink-0 flex items-center justify-center border border-white/5">
                {p.image ? <img loading="lazy" src={p.image} className="w-full h-full object-cover group-hover:scale-110 transition-all" alt=""/> : <Package size={20} className="text-gray-800"/>}
              </div>
              <div className="flex-1 ml-4 overflow-hidden">
                <p className="text-[8px] text-cyan-500 uppercase tracking-widest">New listing</p>
                <h4 className="text-white text-sm truncate group-hover:text-amber-500">{p.title}</h4>
                <p className="text-[10px] text-gray-600">by <span className="text-gray-400">{p.vendor}</span></p>
              </div>
              <div className="text-amber-500 font-black text-sm">${(parseFloat(p.price_xmr) * xmrRate).toFixed(2)}</div>
            </div>
          ))}
        </div>
      )}
    </div>

    <div className="mb-10">
      <h2 className="text-white text-2xl font-black mb-6 flex items-center gap-3">
        <ShieldCheck size={24} className="text-purple-500"/> Trusted Vendors Spotlight
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {spotlightVendors.map(vendor => (
          <div key={`spot-${vendor.username}`}
            onClick={() => { setSelectedVendor(vendor.username); setActiveTab('vendor-profile'); }}
            className="bg-[#0a0a0a] border border-white/5 p-5 rounded-xl hover:border-purple-500/40 transition-all cursor-pointer">
            <div className="w-14 h-14 rounded-full bg-gradient-to-br from-amber-900/20 to-purple-900/30 flex items-center justify-center text-amber-500 text-2xl font-black mb-3">
              {vendor.username[0]}
            </div>
            <h4 className="text-white text-sm truncate">{vendor.username}</h4>
            <div className="text-[10px] text-gray-500 mt-1">{vendor.sales || 0} sales • rating {vendor.rating || 0}</div>
            <button className="mt-4 w-full bg-purple-900/20 border border-purple-700/40 text-purple-300 py-2 rounded-lg text-[10px] font-black uppercase">View Store</button>
          </div>
        ))}
      </div>
    </div>
  </>
)}

{/* ALL / FILTERED PRODUCTS */}
{!(selectedCategory === 'All' && !searchQuery) && (
<div>
  <h2 className="text-white text-2xl font-black mb-6">
    {`${filteredProducts.length} Result${filteredProducts.length !== 1 ? 's' : ''}`}
  </h2>
  {filteredProducts.length === 0 ? (
    <div className="bg-[#111] border border-white/5 p-20 rounded-3xl text-center">
      <Package size={64} className="mx-auto mb-4 opacity-10 text-white"/>
      <p className="text-gray-600 text-sm italic">No listings found in this sector</p>
    </div>
  ) : (
    <div className="flex flex-col gap-3">
      {filteredProducts.map(p => (
        <div key={p.id}
          onClick={() => { setSelectedProduct(p); setActiveTab('product-detail'); }}
          className="bg-[#0a0a0a] border border-white/5 p-3 rounded-xl hover:border-amber-500/40 transition-all cursor-pointer group flex items-center shadow-lg">
          
          <div className="w-20 h-20 bg-black rounded-lg overflow-hidden flex-shrink-0 flex items-center justify-center border border-white/5">
            {p.image ? (
              <img loading="lazy" src={p.image} className="w-full h-full object-cover group-hover:scale-110 transition-all" alt=""/>
            ) : (
              <Package size={24} className="text-gray-800"/>
            )}
          </div>

          <div className="flex-1 ml-4 overflow-hidden">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-[8px] bg-zinc-900 text-zinc-500 border border-zinc-800 px-1.5 py-0.5 rounded uppercase font-bold">
                {p.category}
              </span>
              {p.is_founder && (
                <span className="text-[8px] bg-orange-500/10 text-orange-500 border border-orange-500/30 px-1.5 py-0.5 rounded uppercase font-black">
                  Founder
                </span>
              )}
            </div>
            <h4 className="text-base text-white group-hover:text-amber-500 transition-colors truncate font-medium">
              {p.title}
            </h4>
            <p className="text-[10px] text-gray-600 mt-0.5">
              by <span className="text-gray-400 font-mono italic">{p.vendor}</span>
            </p>
          </div>

          <div className="text-right ml-4 pr-2">
            <p className="text-xl text-amber-500 font-black tracking-tighter leading-none">
              ${(parseFloat(p.price_xmr) * xmrRate).toFixed(2)}
            </p>
            <div className="text-[9px] text-zinc-700 group-hover:text-amber-500 font-bold mt-1 transition-all">
              Details ->
            </div>
          </div>
        </div>
      ))}
    </div>
  )}
</div>
)}
            </div>
          )}

          {/* ORDERS */}
          {activeTab === 'orders' && (
            <OrdersPage
              user={user} orders={orders} products={products}
              xmrRate={xmrRate}
              onMarkShipped={handleMarkShipped}
              onComplete={handleCompleteOrder}
              onSubmitReview={handleSubmitReview}
              onReleaseFunds={releaseFunds}
              onOpenDispute={openDisputeModal}
              onOpenChat={(orderId) => { setSelectedOrderId(orderId); setShowOrderChat(true); }}
            />
          )}

          {/* PRODUCT DETAIL */}
          {activeTab === 'product-detail' && selectedProduct && (
            <ProductDetailPage
              product={selectedProduct} user={user}
              xmrRate={xmrRate}
              onBack={() => setActiveTab('home')}
              onBuy={(escrowMode) => { handleBuyProduct(selectedProduct.id, escrowMode); }}
              onContactVendor={() => { setShowGeneralChat(true); setChatVendor(selectedProduct.vendor); }}
              onViewVendor={() => { setSelectedVendor(selectedProduct.vendor); setActiveTab('vendor-profile'); }}
            />
          )}

          {/* VENDOR PROFILE */}
          {activeTab === 'vendor-profile' && selectedVendor && (
            <VendorProfilePage
              vendorName={selectedVendor} products={products}
              onBack={() => setActiveTab('home')}
              onViewProduct={(product) => { setSelectedProduct(product); setActiveTab('product-detail'); }}
              currentUser={user}
              authenticatedFetch={authenticatedFetch}
              onBadgeUpdated={loadData}
            />
          )}

          {/* MESSAGES */}
          {activeTab === 'messages' && (
            <MessagesInbox
              user={user}
              onOpenChat={(vendor) => { setShowGeneralChat(true); setChatVendor(vendor); }}
            />
          )}

          {/* PROFILE */}
          {activeTab === 'profile' && (
            <div className="space-y-6">
              <ProfilePage
                user={user}
                onUpdateAvatar={(img) => handleAction('/api/user/update-avatar', { username: user.username, avatar: img })}
                onUpgrade={handleUpgradeVendor}
                onDelete={deleteAccount}
              />
              <TwoFactorIdentityPanel
                username={user?.username}
                sessionToken={sessionToken}
                onEnabled={() => setUser(prev => (prev ? { ...prev, totp_enabled: true } : prev))}
                onDisabled={() => setUser(prev => (prev ? { ...prev, totp_enabled: false } : prev))}
              />
              {/* SECURITY SETTINGS */}
              <PGPKeySection
                user={user}
                currentToken={sessionToken}
                onSessionExpired={() => {
                  localStorage.removeItem('silkGenesis_session');
                  setUser(null);
                  setSessionToken(null);
                  authFailureHandledRef.current = false;
                  setActiveTab('home');
                  alert('Session expired. Please login again.');
                }}
                onSetupComplete={() => setUser(prev => ({ ...prev, pgp_setup_completed: true }))}
              />
              <AntiPhishingPhraseManager currentUser={user} sessionToken={sessionToken} />
              <SessionSecurityCenter currentUser={user} />

              {/* VENDOR LEVEL CARD */}
              {user?.role === 'vendor' && (
                <VendorLevelCard username={user.username} />
              )}

            </div>
          )}

          {activeTab === 'wallet' && (
            <WalletPage
              user={user}
              onWithdraw={handleWithdraw}
              authenticatedFetch={authenticatedFetch}
              balance={balance}
              xmrRate={xmrRate}
            />
          )}

          {/* ADMIN PANEL */}
          {activeTab === 'admin_panel' && user?.role === 'admin' && (
            <AdminDashboard user={user} sessionToken={sessionToken} />
          )}

          {/* ADMIN CATEGORIES */}
          {activeTab === 'admin_categories' && user?.role === 'admin' && (
            <AdminCategories user={user} sessionToken={sessionToken} />
          )}

          {/* RELEASE FUNDS */}
          {activeTab === 'release_funds' && (
            (() => {
              const releasableOrder = orders.find(
                o => o.buyer === user.username && ['pending', 'escrow', 'shipped'].includes(o.status)
              );
              if (!releasableOrder) {
                return (
                  <div className="bg-[#111] p-8 border border-white/10 rounded-2xl text-center">
                    <h3 className="text-white text-lg font-black mb-2">No releasable order</h3>
                    <p className="text-gray-500 text-sm">You do not have any order in escrow/shipped state right now.</p>
                  </div>
                );
              }
              return (
                <ReleaseFunds
                  order={releasableOrder}
                  user={user}
                  onReleased={async () => {
                    await loadData();
                    setActiveTab('orders');
                  }}
                  onDispute={(orderId) => {
                    openDisputeModal(orderId);
                    setActiveTab('orders');
                  }}
                />
              );
            })()
          )}

          {/* MY LISTINGS TAB */}
          {activeTab === 'my_listings' && user?.role === 'vendor' && (
            <MyListingsPage
              user={user}
              products={products}
              onDeleteListing={async (listingId) => {
                if (!window.confirm('Delete this listing? This cannot be undone.')) return;
                try {
                  const res = await fetch(`/api/listings/${listingId}?vendor=${user.username}`, { method: 'DELETE' });
                  if (res.ok) { alert('Listing deleted!'); await loadData(); }
                  else { const err = await res.json(); alert('Error: ' + err.detail); }
                } catch(e) { alert('Connection error'); }
              }}
              onNewListing={() => setActiveTab('vendor_panel')}
              xmrRate={xmrRate}
            />
          )}


          {/* VENDOR DASHBOARD - EARNINGS & COMMISSIONS */}
          {activeTab === 'vendor_dashboard' && user?.role === 'vendor' && (
            <VendorDashboard username={user.username} authenticatedFetch={authenticatedFetch} />
          )}

          {/* VENDOR PANEL */}
          {activeTab === 'vendor_panel' && user?.role === 'vendor' && (
            <div className="bg-[#111] p-10 border border-purple-900/20 rounded-3xl shadow-2xl">
              <h2 className="text-2xl text-purple-500 mb-8 border-b border-purple-900/10 pb-4 tracking-tighter flex items-center gap-3">
                <PlusCircle size={24}/> Publish New Listing
              </h2>
              <form onSubmit={handleAddProduct} className="space-y-6">
                <div className="grid grid-cols-2 gap-5">
                  <div>
                    <label className="text-[9px] text-gray-500 uppercase block mb-2">Product Title *</label>
                    <input type="text" placeholder="e.g. Premium MDMA Crystal 1g" value={newTitle} onChange={e => setNewTitle(e.target.value)} required
                      className="w-full bg-black border border-white/10 p-4 rounded-xl outline-none text-white text-sm"/>
                  </div>
                  <div>
                    <label className="text-[9px] text-gray-500 uppercase block mb-2">Price in USD ($) *</label>
                    <input type="number" placeholder="e.g. 75" value={newPriceUsd} onChange={e => setNewPriceUsd(e.target.value)} required
                      className="w-full bg-black border border-white/10 p-4 rounded-xl outline-none text-amber-500 text-sm"/>
                    {newPriceUsd && <p className="text-[9px] text-gray-600 mt-1">≈ {(parseFloat(newPriceUsd) / xmrRate).toFixed(4)} XMR</p>}
                  </div>
                </div>

                {/* CATEGORY SELECTOR */}
                <div>
                  <label className="text-[9px] text-gray-500 uppercase block mb-2">Category *</label>
                  <div className="grid grid-cols-2 gap-4">
                    {/* Parent category */}
                    <div>
                      <label className="text-[9px] text-gray-600 block mb-1">Section</label>
                      <select
                        value={categories.find(c => c.name === newCat)?.parent || (categories.find(c => c.name === newCat && !c.parent) ? newCat : '')}
                        onChange={e => {
                          const parentName = e.target.value;
                          const children = categories.filter(c => c.parent === parentName);
                          if (children.length > 0) setNewCat(children[0].name);
                          else setNewCat(parentName);
                        }}
                        className="w-full bg-black border border-white/10 p-4 rounded-xl text-white outline-none text-sm"
                      >
                        <option value="">- Select Section -</option>
                        {categories.filter(c => !c.parent).map(c => (
                          <option key={c.name} value={c.name}>{c.icon} {c.name}</option>
                        ))}
                      </select>
                    </div>
                    {/* Sub category */}
                    <div>
                      <label className="text-[9px] text-gray-600 block mb-1">Subsection</label>
                      <select
                        value={newCat}
                        onChange={e => setNewCat(e.target.value)}
                        className="w-full bg-black border border-white/10 p-4 rounded-xl text-white outline-none text-sm"
                      >
                        <option value="">- Select Subsection -</option>
                        {(() => {
                          const selectedParent = categories.find(c => c.name === newCat)?.parent ||
                            (categories.find(c => c.name === newCat && !c.parent) ? newCat : null);
                          const parentCat = categories.find(c => !c.parent && (c.name === selectedParent || c.name === newCat));
                          if (!parentCat) return null;
                          const children = categories.filter(c => c.parent === parentCat.name);
                          if (children.length === 0) return <option value={parentCat.name}>{parentCat.icon} {parentCat.name} (General)</option>;
                          return children.map(c => <option key={c.name} value={c.name}>{c.icon} {c.name}</option>);
                        })()}
                      </select>
                    </div>
                  </div>
                  {newCat && (
                    <div className="mt-2 flex items-center gap-2">
                      <Tag size={12} className="text-amber-600"/>
                      <span className="text-[10px] text-amber-600">Selected: {newCat}</span>
                    </div>
                  )}
                </div>

                {/* IMAGE UPLOAD */}
                <div>
                  <label className="text-[9px] text-gray-500 uppercase block mb-2">Product Image * (Required)</label>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className={`flex flex-col items-center justify-center h-40 border-2 border-dashed rounded-xl cursor-pointer transition-all ${newImage ? 'border-purple-500/50 bg-purple-900/10' : 'border-white/10 hover:border-purple-500/30 hover:bg-purple-900/5'}`}>
                        <input type="file" accept="image/*" className="hidden" onChange={e => {
                          const file = e.target.files[0];
                          if (file) {
                            if (file.size > 5 * 1024 * 1024) { alert('Image too large! Max 5MB'); return; }
                            const reader = new FileReader();
                            reader.onloadend = () => setNewImage(reader.result);
                            reader.readAsDataURL(file);
                          }
                        }}/>
                        {newImage ? (
                          <div className="text-center">
                            <CheckCircle size={32} className="text-purple-500 mx-auto mb-2"/>
                            <p className="text-[10px] text-purple-400">Image loaded ✓</p>
                            <p className="text-[9px] text-gray-600 mt-1">Click to change</p>
                          </div>
                        ) : (
                          <div className="text-center">
                            <Camera size={32} className="text-gray-600 mx-auto mb-2"/>
                            <p className="text-[10px] text-gray-500">Click to upload image</p>
                            <p className="text-[9px] text-gray-700 mt-1">JPG, PNG, GIF - Max 5MB</p>
                          </div>
                        )}
                      </label>
                      {!newImage && <p className="text-[9px] text-red-500 mt-1">⚠️ Image is required</p>}
                    </div>
                    {/* PREVIEW */}
                    <div className="h-40 bg-black rounded-xl border border-white/5 overflow-hidden flex items-center justify-center">
                      {newImage ? (
                        <div className="relative w-full h-full group">
                          <img loading="lazy" src={newImage} alt="Preview" className="w-full h-full object-cover"/>
                          <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-all flex items-center justify-center">
                            <button type="button" onClick={() => setNewImage(null)} className="text-red-400 text-[10px] border border-red-500/40 px-3 py-1.5 rounded-lg hover:bg-red-900/20">
                              ✕ Remove
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="text-center">
                          <Package size={32} className="text-gray-800 mx-auto mb-2"/>
                          <p className="text-[9px] text-gray-700">Preview</p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div>
                  <label className="text-[9px] text-gray-500 uppercase block mb-2">Description *</label>
                  <textarea value={newDesc} onChange={e => setNewDesc(e.target.value)} required placeholder="Describe your product in detail..."
                    className="w-full bg-black border border-white/10 p-4 rounded-xl h-40 outline-none text-white text-sm font-normal not-italic"/>
                </div>

                <div className="bg-amber-900/10 border border-amber-900/20 p-4 rounded-xl">
                  <p className="text-[9px] text-amber-600 uppercase mb-1">⚠️ Vendor Notice:</p>
                  <p className="text-[10px] text-gray-500">Funds from sales will be held in escrow until the buyer confirms receipt. Ensure you ship promptly after receiving payment.</p>
                </div>

                <button type="submit" className="w-full py-5 bg-purple-600 text-black font-black uppercase text-[12px] hover:bg-purple-400 transition-all rounded-xl shadow-xl">
                  📡 Broadcast Listing
                </button>
              </form>
            </div>
          )}

        </main>
      </div>

      {/* CHAT MODALS */}
      <GeneralChatModal
        isOpen={showGeneralChat}
        onClose={() => setShowGeneralChat(false)}
        buyer={user?.username}
        vendor={chatVendor}
        currentUser={user?.username}
        currentToken={sessionToken}
        authFetch={authenticatedFetch}
      />
      <OrderChatModal
        isOpen={showOrderChat}
        onClose={() => setShowOrderChat(false)}
        orderId={selectedOrderId}
        currentUser={user?.username}
        currentToken={sessionToken}
        authFetch={authenticatedFetch}
      />

      {/* ===== DISPUTE MODAL ===== */}
      {showDisputeModal && (
        <div style={{position:'fixed',top:0,left:0,right:0,bottom:0,background:'rgba(0,0,0,0.8)',zIndex:9999,display:'flex',alignItems:'center',justifyContent:'center'}}>
          <div style={{background:'#1a1a2e',border:'1px solid #e74c3c',borderRadius:12,padding:32,width:480,maxWidth:'90vw'}}>
            <h3 style={{color:'#e74c3c',marginBottom:16}}>⚠️ Open Dispute</h3>
            <p style={{color:'#aaa',marginBottom:16,fontSize:13}}>Order: {disputeOrderId}</p>
            <textarea
              value={disputeReason}
              onChange={e => setDisputeReason(e.target.value)}
              placeholder="Describe the problem (e.g. item not received, wrong item, etc.)"
              style={{width:'100%',height:120,background:'#0d0d1a',border:'1px solid #333',borderRadius:8,color:'#fff',padding:12,fontSize:14,resize:'none',boxSizing:'border-box'}}
            />
            <div style={{display:'flex',gap:12,marginTop:16}}>
              <button onClick={submitDispute} style={{flex:1,padding:'12px',background:'#e74c3c',color:'#fff',border:'none',borderRadius:8,cursor:'pointer',fontWeight:'bold'}}>
                Open Dispute
              </button>
              <button onClick={() => setShowDisputeModal(false)} style={{flex:1,padding:'12px',background:'#333',color:'#fff',border:'none',borderRadius:8,cursor:'pointer'}}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== PIN VERIFICATION MODAL ===== */}
      {showPinModal && (
        <div style={{position:'fixed',top:0,left:0,right:0,bottom:0,background:'rgba(0,0,0,0.85)',zIndex:9999,display:'flex',alignItems:'center',justifyContent:'center'}}>
          <div style={{background:'#1a1a2e',border:'1px solid #f39c12',borderRadius:12,padding:32,width:360,maxWidth:'90vw',textAlign:'center'}}>
            <div style={{fontSize:48,marginBottom:16}}>🔐</div>
            <h3 style={{color:'#f39c12',marginBottom:8}}>Enter Withdrawal PIN</h3>
            <p style={{color:'#aaa',fontSize:13,marginBottom:20}}>Enter your 6-digit security PIN to confirm this withdrawal</p>
            <input
              type="password"
              maxLength={6}
              value={pinInput}
              onChange={e => setPinInput(e.target.value.replace(/\D/g,''))}
              onKeyDown={e => e.key === 'Enter' && verifyAndExecute()}
              placeholder="••••••"
              style={{width:'100%',padding:'14px',background:'#0d0d1a',border:'2px solid #f39c12',borderRadius:8,color:'#fff',fontSize:24,textAlign:'center',letterSpacing:8,boxSizing:'border-box'}}
              autoFocus
            />
            <div style={{display:'flex',gap:12,marginTop:20}}>
              <button onClick={verifyAndExecute} style={{flex:1,padding:'12px',background:'#f39c12',color:'#000',border:'none',borderRadius:8,cursor:'pointer',fontWeight:'bold'}}>
                Confirm
              </button>
              <button onClick={() => setShowPinModal(false)} style={{flex:1,padding:'12px',background:'#333',color:'#fff',border:'none',borderRadius:8,cursor:'pointer'}}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== SET PIN MODAL ===== */}
      {showSetPinModal && (
        <div style={{position:'fixed',top:0,left:0,right:0,bottom:0,background:'rgba(0,0,0,0.85)',zIndex:9999,display:'flex',alignItems:'center',justifyContent:'center'}}>
          <div style={{background:'#1a1a2e',border:'1px solid #27ae60',borderRadius:12,padding:32,width:360,maxWidth:'90vw',textAlign:'center'}}>
            <div style={{fontSize:48,marginBottom:16}}>🔒</div>
            <h3 style={{color:'#27ae60',marginBottom:8}}>{hasPin ? 'Change PIN' : 'Set Withdrawal PIN'}</h3>
            <p style={{color:'#aaa',fontSize:13,marginBottom:20}}>Set a 6-digit PIN to protect your withdrawals</p>
            <input
              type="password"
              maxLength={6}
              value={newPin}
              onChange={e => setNewPin(e.target.value.replace(/\D/g,''))}
              placeholder="••••••"
              style={{width:'100%',padding:'14px',background:'#0d0d1a',border:'2px solid #27ae60',borderRadius:8,color:'#fff',fontSize:24,textAlign:'center',letterSpacing:8,boxSizing:'border-box'}}
              autoFocus
            />
            <div style={{display:'flex',gap:12,marginTop:20}}>
              <button onClick={saveNewPin} style={{flex:1,padding:'12px',background:'#27ae60',color:'#fff',border:'none',borderRadius:8,cursor:'pointer',fontWeight:'bold'}}>
                Save PIN
              </button>
              <button onClick={() => setShowSetPinModal(false)} style={{flex:1,padding:'12px',background:'#333',color:'#fff',border:'none',borderRadius:8,cursor:'pointer'}}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;



