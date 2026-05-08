import React, { useState, useEffect } from 'react';

function authJsonHeaders(token) {
  const h = { 'Content-Type': 'application/json' };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

// ============================================================
// 2FA TOTP SETUP COMPONENT
// ============================================================
export function TwoFactorSetup({ user, token, password, onClose, onEnabled }) {
  const [step, setStep] = useState(1); // 1=intro, 2=qr, 3=verify, 4=backup
  const [qrCode, setQrCode] = useState('');
  const [secret, setSecret] = useState('');
  const [code, setCode] = useState('');
  const [backupCodes, setBackupCodes] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const initSetup = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/2fa/setup', {
        method: 'POST',
        headers: authJsonHeaders(token),
        body: JSON.stringify({ username: user, token, password })
      });
      const data = await res.json();
      if (!res.ok) {
        setError(typeof data.detail === 'string' ? data.detail : 'Error generating 2FA');
        return;
      }
      if (data.qr_code) {
        setQrCode(data.qr_code);
        setSecret(data.secret);
        setStep(2);
      } else {
        setError(data.detail || 'Error generating 2FA');
      }
    } catch (e) {
      setError('Connection error');
    }
    setLoading(false);
  };

  const verifyAndEnable = async () => {
    if (code.length !== 6) { setError('Enter 6-digit code'); return; }
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/2fa/enable', {
        method: 'POST',
        headers: authJsonHeaders(token),
        body: JSON.stringify({ username: user, token, password, code, secret })
      });
      const data = await res.json();
      if (!res.ok) {
        setError(typeof data.detail === 'string' ? data.detail : (data.detail?.[0]?.msg) || 'Invalid code');
        return;
      }
      if (data.success) {
        setBackupCodes(data.backup_codes || []);
        setStep(4);
        if (onEnabled) onEnabled();
      } else {
        setError(data.detail || 'Invalid code');
      }
    } catch (e) {
      setError('Connection error');
    }
    setLoading(false);
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999
    }}>
      <div style={{
        background: '#0d1117', border: '1px solid #30363d',
        borderRadius: 12, padding: 32, maxWidth: 480, width: '90%'
      }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <h2 style={{ color: '#58a6ff', margin: 0, fontSize: 20 }}>🔐 Two-Factor Authentication</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: 20 }}>✕</button>
        </div>

        {/* Step 1: Intro */}
        {step === 1 && (
          <div>
            <p style={{ color: '#8b949e', lineHeight: 1.6 }}>
              2FA adds an extra layer of security. You'll need an authenticator app like:
            </p>
            <ul style={{ color: '#c9d1d9', marginBottom: 24 }}>
              <li>🛡️ Aegis Authenticator (recommended)</li>
              <li>📱 Google Authenticator</li>
              <li>🔑 Authy</li>
            </ul>
            <button onClick={initSetup} disabled={loading} style={{
              width: '100%', padding: '12px', background: '#238636',
              color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 16
            }}>
              {loading ? '⏳ Generating...' : '🚀 Setup 2FA'}
            </button>
          </div>
        )}

        {/* Step 2: QR Code */}
        {step === 2 && (
          <div>
            <p style={{ color: '#8b949e', marginBottom: 16 }}>
              Scan this QR code with your authenticator app:
            </p>
            {qrCode && (
              <div style={{ textAlign: 'center', marginBottom: 16 }}>
                <img src={`data:image/png;base64,${qrCode}`} alt="2FA QR Code"
                  style={{ width: 200, height: 200, border: '4px solid #fff', borderRadius: 8 }} />
              </div>
            )}
            <div style={{ background: '#161b22', padding: 12, borderRadius: 8, marginBottom: 16 }}>
              <p style={{ color: '#8b949e', fontSize: 12, margin: '0 0 4px' }}>Manual entry key:</p>
              <code style={{ color: '#58a6ff', fontSize: 14, wordBreak: 'break-all' }}>{secret}</code>
            </div>
            <button onClick={() => setStep(3)} style={{
              width: '100%', padding: '12px', background: '#1f6feb',
              color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 16
            }}>
              ✅ I've scanned it → Verify
            </button>
          </div>
        )}

        {/* Step 3: Verify */}
        {step === 3 && (
          <div>
            <p style={{ color: '#8b949e', marginBottom: 16 }}>
              Enter the 6-digit code from your authenticator app:
            </p>
            <input
              type="text"
              maxLength={6}
              value={code}
              onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
              placeholder="000000"
              style={{
                width: '100%', padding: '16px', fontSize: 28, textAlign: 'center',
                background: '#161b22', border: '1px solid #30363d', borderRadius: 8,
                color: '#c9d1d9', letterSpacing: 8, marginBottom: 16, boxSizing: 'border-box'
              }}
              autoFocus
              onKeyDown={e => e.key === 'Enter' && verifyAndEnable()}
            />
            {error && <p style={{ color: '#f85149', marginBottom: 12 }}>❌ {error}</p>}
            <button onClick={verifyAndEnable} disabled={loading || code.length !== 6} style={{
              width: '100%', padding: '12px', background: code.length === 6 ? '#238636' : '#21262d',
              color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 16
            }}>
              {loading ? '⏳ Verifying...' : '🔐 Enable 2FA'}
            </button>
          </div>
        )}

        {/* Step 4: Backup codes */}
        {step === 4 && (
          <div>
            <div style={{ textAlign: 'center', marginBottom: 16 }}>
              <div style={{ fontSize: 48 }}>✅</div>
              <h3 style={{ color: '#3fb950', margin: '8px 0' }}>2FA Enabled!</h3>
            </div>
            <div style={{ background: '#161b22', border: '1px solid #f85149', borderRadius: 8, padding: 16, marginBottom: 16 }}>
              <p style={{ color: '#f85149', fontWeight: 'bold', margin: '0 0 8px' }}>⚠️ Save these backup codes NOW!</p>
              <p style={{ color: '#8b949e', fontSize: 12, margin: '0 0 12px' }}>Each code can only be used once if you lose your authenticator.</p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                {backupCodes.map((c, i) => (
                  <code key={i} style={{ background: '#0d1117', padding: '6px 10px', borderRadius: 4, color: '#58a6ff', fontSize: 14 }}>{c}</code>
                ))}
              </div>
            </div>
            <button onClick={onClose} style={{
              width: '100%', padding: '12px', background: '#238636',
              color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 16
            }}>
              ✅ Done - I saved my backup codes
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// 2FA VERIFY COMPONENT (pendant le login)
// ============================================================
export function TwoFactorVerify({ username, onVerified, onCancel }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [useBackup, setUseBackup] = useState(false);

  const verify = async () => {
    if (!useBackup && code.length !== 6) { setError('Enter 6-digit code'); return; }
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/2fa/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, code, use_backup: useBackup })
      });
      const data = await res.json();
      if (data.success) {
        onVerified(data);
      } else {
        setError(data.detail || 'Invalid code');
        setCode('');
      }
    } catch (e) {
      setError('Connection error');
    }
    setLoading(false);
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.9)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999
    }}>
      <div style={{
        background: '#0d1117', border: '1px solid #30363d',
        borderRadius: 12, padding: 32, maxWidth: 400, width: '90%', textAlign: 'center'
      }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>🔐</div>
        <h2 style={{ color: '#58a6ff', margin: '0 0 8px' }}>Two-Factor Authentication</h2>
        <p style={{ color: '#8b949e', marginBottom: 24 }}>
          {useBackup ? 'Enter a backup code:' : 'Enter the 6-digit code from your authenticator app:'}
        </p>

        <input
          type="text"
          maxLength={useBackup ? 8 : 6}
          value={code}
          onChange={e => setCode(e.target.value.replace(/\s/g, '').toUpperCase())}
          placeholder={useBackup ? 'XXXXXXXX' : '000000'}
          style={{
            width: '100%', padding: '16px', fontSize: 24, textAlign: 'center',
            background: '#161b22', border: '1px solid #30363d', borderRadius: 8,
            color: '#c9d1d9', letterSpacing: useBackup ? 4 : 8, marginBottom: 16,
            boxSizing: 'border-box'
          }}
          autoFocus
          onKeyDown={e => e.key === 'Enter' && verify()}
        />

        {error && <p style={{ color: '#f85149', marginBottom: 12 }}>❌ {error}</p>}

        <button onClick={verify} disabled={loading} style={{
          width: '100%', padding: '12px', background: '#238636',
          color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 16, marginBottom: 12
        }}>
          {loading ? '⏳ Verifying...' : '✅ Verify'}
        </button>

        <button onClick={() => { setUseBackup(!useBackup); setCode(''); setError(''); }} style={{
          background: 'none', border: 'none', color: '#58a6ff', cursor: 'pointer', fontSize: 14, marginBottom: 8
        }}>
          {useBackup ? '← Use authenticator app' : '🔑 Use backup code'}
        </button>

        <br />
        <button onClick={onCancel} style={{
          background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer', fontSize: 14
        }}>
          Cancel
        </button>
      </div>
    </div>
  );
}
