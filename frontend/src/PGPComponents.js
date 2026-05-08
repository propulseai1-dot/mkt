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
            <p className="text-[10px] text-red-700 uppercase tracking-widest">This is shown ONCE — Never again</p>
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
          {confirmed ? '✓ I Have Saved My Key — Enter Market' : 'Check the box above to continue'}
        </button>
      </div>
    </div>
  );
}

// ============================================================
// PGP KEY SECTION - In user profile
// ============================================================
function PGPKeySection({ user }) {
  const [pgpData, setPgpData] = React.useState(null);
  const [showPrivateKey, setShowPrivateKey] = React.useState(false);
  const [privateKeyData, setPrivateKeyData] = React.useState(null);
  const [password, setPassword] = React.useState('');
  const [newPubKey, setNewPubKey] = React.useState('');
  const [validating, setValidating] = React.useState(false);
  const [saveStatus, setSaveStatus] = React.useState('');
  const [copiedPub, setCopiedPub] = React.useState(false);
  const [copiedFp, setCopiedFp] = React.useState(false);

  React.useEffect(() => { loadPGPData(); }, [user.username]);

  const loadPGPData = async () => {
    try {
      const res = await fetch('/api/pgp/' + user.username);
      if (res.ok) setPgpData(await res.json());
    } catch(e) {}
  };

  const fetchPrivateKey = async () => {
    if (!password) { alert('Enter your password to retrieve your private key'); return; }
    try {
      const res = await fetch('/api/pgp/' + user.username + '/private?password=' + encodeURIComponent(password));
      const data = await res.json();
      if (res.ok && data.pgp_private_key_encrypted) {
        setPrivateKeyData(data);
        setShowPrivateKey(true);
        setPassword('');
      } else {
        alert(data.detail || 'Error retrieving private key');
      }
    } catch(e) { alert('Connection error'); }
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
      
      const sessionData = JSON.parse(localStorage.getItem('silkGenesis_session') || '{}');
      const token = sessionData.session_token;
      
      const res = await fetch('/api/pgp/set', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
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

  const hasPGP = pgpData && pgpData.has_pgp;

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

      {hasPGP && pgpData && (
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
        setDecryptError('OpenPGP.js not loaded. Copy the message and decrypt with GPG:\ngpg --decrypt');
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
