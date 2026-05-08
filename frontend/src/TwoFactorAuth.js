import React, { useState, useEffect } from 'react';

// ============================================================
// 2FA TOTP Component - Google Authenticator compatible
// ============================================================

export function TwoFactorSetup({ username, password, onSuccess, onCancel }) {
  const [step, setStep] = useState('init'); // init | setup | verify | done
  const [secret, setSecret] = useState('');
  const [uri, setUri] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const startSetup = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/2fa/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Setup failed');
      setSecret(data.secret);
      setUri(data.uri);
      setStep('setup');
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const verifySetup = async () => {
    if (code.length !== 6) { setError('Enter 6-digit code'); return; }
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/2fa/verify-setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, code })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Verification failed');
      setStep('done');
      setTimeout(() => onSuccess && onSuccess(), 2000);
    } catch (e) {
      setError(e.message);
      setCode('');
    } finally {
      setLoading(false);
    }
  };

  // Format secret in groups of 4 for readability
  const formatSecret = (s) => s ? s.match(/.{1,4}/g)?.join(' ') || s : '';

  if (step === 'done') {
    return (
      <div style={styles.container}>
        <div style={styles.successBox}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>✅</div>
          <h3 style={{ color: '#00ff88', margin: '0 0 8px' }}>2FA Activated!</h3>
          <p style={{ color: '#aaa', margin: 0 }}>Your account is now protected with two-factor authentication.</p>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      <h2 style={styles.title}>🔐 Enable Two-Factor Authentication</h2>
      <p style={styles.subtitle}>Protect your account with Google Authenticator or Authy</p>

      {step === 'init' && (
        <div style={styles.card}>
          <div style={styles.infoBox}>
            <h4 style={{ color: '#00ff88', margin: '0 0 12px' }}>What is 2FA?</h4>
            <p style={{ color: '#ccc', margin: '0 0 8px', fontSize: 14 }}>
              Two-factor authentication adds a second layer of security. After entering your password,
              you'll need to enter a 6-digit code from your authenticator app.
            </p>
            <p style={{ color: '#aaa', margin: 0, fontSize: 13 }}>
              📱 Works with: Google Authenticator, Authy, FreeOTP, and any TOTP app.
            </p>
          </div>
          <button
            onClick={startSetup}
            disabled={loading}
            style={styles.primaryBtn}
          >
            {loading ? 'Setting up...' : '🚀 Start 2FA Setup'}
          </button>
          {onCancel && (
            <button onClick={onCancel} style={styles.cancelBtn}>Cancel</button>
          )}
        </div>
      )}

      {step === 'setup' && (
        <div style={styles.card}>
          <h3 style={{ color: '#fff', margin: '0 0 16px' }}>Step 1: Add to Authenticator App</h3>

          {/* QR Code placeholder - show URI */}
          <div style={styles.qrBox}>
            <div style={{ fontSize: 13, color: '#888', marginBottom: 8 }}>
              📷 Scan this URI with your authenticator app:
            </div>
            <div style={styles.uriBox}>
              <code style={{ fontSize: 10, wordBreak: 'break-all', color: '#00ff88' }}>{uri}</code>
            </div>
            <button
              onClick={() => navigator.clipboard?.writeText(uri)}
              style={styles.copyBtn}
            >
              📋 Copy URI
            </button>
          </div>

          <div style={styles.divider}>— OR enter manually —</div>

          <div style={styles.secretBox}>
            <div style={{ color: '#888', fontSize: 12, marginBottom: 6 }}>Secret Key:</div>
            <div style={styles.secretKey}>{formatSecret(secret)}</div>
            <button
              onClick={() => navigator.clipboard?.writeText(secret)}
              style={styles.copyBtn}
            >
              📋 Copy Secret
            </button>
          </div>

          <div style={styles.instructions}>
            <strong style={{ color: '#ffaa00' }}>Instructions:</strong>
            <ol style={{ color: '#ccc', fontSize: 13, paddingLeft: 20, margin: '8px 0 0' }}>
              <li>Open Google Authenticator or Authy</li>
              <li>Tap "+" → "Scan QR code" or "Enter setup key"</li>
              <li>Enter the secret key above manually</li>
              <li>A 6-digit code will appear — enter it below</li>
            </ol>
          </div>

          <button onClick={() => setStep('verify')} style={styles.primaryBtn}>
            ✅ I've added it → Verify Code
          </button>
        </div>
      )}

      {step === 'verify' && (
        <div style={styles.card}>
          <h3 style={{ color: '#fff', margin: '0 0 16px' }}>Step 2: Verify Your Code</h3>
          <p style={{ color: '#aaa', fontSize: 14, margin: '0 0 20px' }}>
            Enter the 6-digit code from your authenticator app to confirm setup.
          </p>

          <div style={styles.codeInputWrapper}>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              value={code}
              onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              onKeyDown={e => e.key === 'Enter' && verifySetup()}
              placeholder="000000"
              style={styles.codeInput}
              autoFocus
            />
          </div>

          {error && <div style={styles.errorBox}>❌ {error}</div>}

          <button
            onClick={verifySetup}
            disabled={loading || code.length !== 6}
            style={{ ...styles.primaryBtn, opacity: code.length !== 6 ? 0.5 : 1 }}
          >
            {loading ? 'Verifying...' : '🔐 Activate 2FA'}
          </button>
          <button onClick={() => setStep('setup')} style={styles.cancelBtn}>← Back</button>
        </div>
      )}

      {error && step !== 'verify' && <div style={styles.errorBox}>❌ {error}</div>}
    </div>
  );
}

// ============================================================
// 2FA Login Prompt - shown after password login if 2FA enabled
// ============================================================

export function TwoFactorLogin({ username, onSuccess, onCancel }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const verify = async () => {
    if (code.length !== 6) { setError('Enter 6-digit code'); return; }
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/2fa/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, code })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Invalid code');
      onSuccess && onSuccess();
    } catch (e) {
      setError(e.message);
      setCode('');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.loginContainer}>
      <div style={styles.loginCard}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>🔐</div>
        <h2 style={{ color: '#fff', margin: '0 0 8px' }}>Two-Factor Authentication</h2>
        <p style={{ color: '#888', margin: '0 0 24px', fontSize: 14 }}>
          Enter the 6-digit code from your authenticator app
        </p>

        <div style={styles.codeInputWrapper}>
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={6}
            value={code}
            onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            onKeyDown={e => e.key === 'Enter' && verify()}
            placeholder="000000"
            style={styles.codeInput}
            autoFocus
          />
        </div>

        {error && <div style={styles.errorBox}>❌ {error}</div>}

        <button
          onClick={verify}
          disabled={loading || code.length !== 6}
          style={{ ...styles.primaryBtn, opacity: code.length !== 6 ? 0.5 : 1, marginTop: 16 }}
        >
          {loading ? 'Verifying...' : '✅ Verify'}
        </button>

        {onCancel && (
          <button onClick={onCancel} style={styles.cancelBtn}>← Back to Login</button>
        )}

        <p style={{ color: '#555', fontSize: 12, marginTop: 16 }}>
          Lost access? Contact support with your account details.
        </p>
      </div>
    </div>
  );
}

// ============================================================
// 2FA Status Widget - for Settings page
// ============================================================

export function TwoFactorStatus({ username, password }) {
  const [status, setStatus] = useState(null);
  const [showSetup, setShowSetup] = useState(false);
  const [showDisable, setShowDisable] = useState(false);
  const [disableCode, setDisableCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    if (username) fetchStatus();
  }, [username]);

  const fetchStatus = async () => {
    try {
      const res = await fetch(`/api/2fa/status/${username}`);
      if (res.ok) setStatus(await res.json());
    } catch {}
  };

  const disable2FA = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/2fa/disable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, code: disableCode })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Failed');
      setSuccess('2FA disabled successfully');
      setShowDisable(false);
      fetchStatus();
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  if (!status) return <div style={{ color: '#555', fontSize: 13 }}>Loading 2FA status...</div>;

  if (showSetup) {
    return (
      <TwoFactorSetup
        username={username}
        password={password}
        onSuccess={() => { setShowSetup(false); fetchStatus(); setSuccess('2FA enabled!'); }}
        onCancel={() => setShowSetup(false)}
      />
    );
  }

  return (
    <div style={styles.statusContainer}>
      <div style={styles.statusHeader}>
        <span style={{ fontSize: 20 }}>{status.totp_enabled ? '🔐' : '🔓'}</span>
        <div>
          <div style={{ color: '#fff', fontWeight: 600 }}>Two-Factor Authentication</div>
          <div style={{ color: status.totp_enabled ? '#00ff88' : '#ff4444', fontSize: 13 }}>
            {status.totp_enabled ? '✅ Enabled' : '❌ Disabled'}
          </div>
        </div>
      </div>

      {success && <div style={styles.successMsg}>✅ {success}</div>}
      {error && <div style={styles.errorBox}>❌ {error}</div>}

      {!status.totp_enabled ? (
        <button onClick={() => setShowSetup(true)} style={styles.primaryBtn}>
          🚀 Enable 2FA
        </button>
      ) : (
        <>
          {!showDisable ? (
            <button onClick={() => setShowDisable(true)} style={styles.dangerBtn}>
              🗑️ Disable 2FA
            </button>
          ) : (
            <div style={styles.disableForm}>
              <p style={{ color: '#ffaa00', fontSize: 13, margin: '0 0 12px' }}>
                ⚠️ Enter your current 2FA code to disable:
              </p>
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={disableCode}
                onChange={e => setDisableCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="000000"
                style={styles.codeInput}
              />
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button onClick={disable2FA} disabled={loading} style={styles.dangerBtn}>
                  {loading ? 'Disabling...' : 'Confirm Disable'}
                </button>
                <button onClick={() => setShowDisable(false)} style={styles.cancelBtn}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ============================================================
// Styles
// ============================================================

const styles = {
  container: {
    maxWidth: 480,
    margin: '0 auto',
    padding: 20,
  },
  loginContainer: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    background: '#0a0a0a',
  },
  loginCard: {
    background: '#111',
    border: '1px solid #222',
    borderRadius: 12,
    padding: 40,
    textAlign: 'center',
    maxWidth: 360,
    width: '100%',
  },
  title: {
    color: '#fff',
    margin: '0 0 8px',
    fontSize: 22,
  },
  subtitle: {
    color: '#888',
    margin: '0 0 24px',
    fontSize: 14,
  },
  card: {
    background: '#111',
    border: '1px solid #222',
    borderRadius: 12,
    padding: 24,
  },
  infoBox: {
    background: '#0d1a0d',
    border: '1px solid #1a3a1a',
    borderRadius: 8,
    padding: 16,
    marginBottom: 20,
  },
  qrBox: {
    background: '#0a0a0a',
    border: '1px solid #222',
    borderRadius: 8,
    padding: 16,
    marginBottom: 16,
    textAlign: 'center',
  },
  uriBox: {
    background: '#000',
    border: '1px solid #333',
    borderRadius: 6,
    padding: 12,
    marginBottom: 8,
    textAlign: 'left',
    maxHeight: 80,
    overflow: 'auto',
  },
  secretBox: {
    background: '#0a0a0a',
    border: '1px solid #222',
    borderRadius: 8,
    padding: 16,
    marginBottom: 16,
    textAlign: 'center',
  },
  secretKey: {
    fontFamily: 'monospace',
    fontSize: 18,
    color: '#00ff88',
    letterSpacing: 4,
    marginBottom: 8,
    wordBreak: 'break-all',
  },
  divider: {
    color: '#444',
    textAlign: 'center',
    margin: '12px 0',
    fontSize: 13,
  },
  instructions: {
    background: '#1a1500',
    border: '1px solid #3a3000',
    borderRadius: 8,
    padding: 16,
    marginBottom: 20,
  },
  codeInputWrapper: {
    display: 'flex',
    justifyContent: 'center',
    marginBottom: 16,
  },
  codeInput: {
    background: '#0a0a0a',
    border: '2px solid #333',
    borderRadius: 8,
    color: '#00ff88',
    fontSize: 32,
    fontFamily: 'monospace',
    letterSpacing: 12,
    padding: '12px 20px',
    textAlign: 'center',
    width: 200,
    outline: 'none',
  },
  primaryBtn: {
    background: 'linear-gradient(135deg, #00ff88, #00cc66)',
    border: 'none',
    borderRadius: 8,
    color: '#000',
    cursor: 'pointer',
    fontSize: 15,
    fontWeight: 700,
    padding: '12px 24px',
    width: '100%',
    marginBottom: 8,
    transition: 'opacity 0.2s',
  },
  cancelBtn: {
    background: 'transparent',
    border: '1px solid #333',
    borderRadius: 8,
    color: '#888',
    cursor: 'pointer',
    fontSize: 14,
    padding: '10px 20px',
    width: '100%',
    marginBottom: 8,
  },
  dangerBtn: {
    background: 'linear-gradient(135deg, #ff4444, #cc0000)',
    border: 'none',
    borderRadius: 8,
    color: '#fff',
    cursor: 'pointer',
    fontSize: 14,
    fontWeight: 600,
    padding: '10px 20px',
    width: '100%',
    marginBottom: 8,
  },
  copyBtn: {
    background: '#1a1a1a',
    border: '1px solid #333',
    borderRadius: 6,
    color: '#aaa',
    cursor: 'pointer',
    fontSize: 12,
    padding: '6px 12px',
  },
  errorBox: {
    background: '#1a0000',
    border: '1px solid #440000',
    borderRadius: 8,
    color: '#ff6666',
    fontSize: 14,
    padding: '10px 16px',
    marginBottom: 12,
  },
  successBox: {
    background: '#0d1a0d',
    border: '1px solid #1a4a1a',
    borderRadius: 12,
    padding: 32,
    textAlign: 'center',
  },
  successMsg: {
    background: '#0d1a0d',
    border: '1px solid #1a4a1a',
    borderRadius: 8,
    color: '#00ff88',
    fontSize: 14,
    padding: '10px 16px',
    marginBottom: 12,
  },
  statusContainer: {
    background: '#111',
    border: '1px solid #222',
    borderRadius: 12,
    padding: 20,
  },
  statusHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16,
  },
  disableForm: {
    background: '#1a0000',
    border: '1px solid #440000',
    borderRadius: 8,
    padding: 16,
  },
};

export default TwoFactorSetup;
