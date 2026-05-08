import React, { useState, useEffect, useRef } from 'react';

// ============================================================
// E2EE PGP CHAT - Messages encrypteds de bout en bout
// Auto-destructibles avec TTL configurable
// ============================================================

const TTL_OPTIONS = [
  { label: '1 hour', seconds: 3600 },
  { label: '6 hours', seconds: 21600 },
  { label: '24 hours', seconds: 86400 },
  { label: '7 days', seconds: 604800 },
  { label: 'No expiry', seconds: 0 },
];

export function E2EEChat({ user, orderId, vendor, buyer, token }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [ttl, setTtl] = useState(86400); // 24h default
  const [loading, setLoading] = useState(false);
  const [pgpStatus, setPgpStatus] = useState(null);
  const [error, setError] = useState('');
  const [showTtl, setShowTtl] = useState(false);
  const messagesEndRef = useRef(null);
  const pollRef = useRef(null);

  const isOrderChat = !!orderId;
  const chatEndpoint = isOrderChat ? `/api/chat/order/${orderId}` : `/api/chat/general/${buyer}/${vendor}`;
  const sendEndpoint = isOrderChat ? '/api/chat/order' : '/api/chat/general';

  useEffect(() => {
    fetchMessages();
    // Poll toutes les 10 secondes
    pollRef.current = setInterval(fetchMessages, 10000);
    return () => clearInterval(pollRef.current);
  }, [orderId, vendor, buyer]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const fetchMessages = async () => {
    try {
      const headers = {};
      const sessionData = JSON.parse(localStorage.getItem('silkGenesis_session') || '{}');
      const activeToken = token || sessionData.session_token;
      
      if (activeToken) {
        headers['Authorization'] = `Bearer ${activeToken}`;
      }

      const res = await fetch(chatEndpoint, { headers });
      const data = await res.json();
      const msgs = data.messages || [];
      
      // Filtrer les messages expires (TTL)
      const now = Date.now();
      const valid = msgs.filter(m => {
        if (!m.expires_at) return true;
        return new Date(m.expires_at).getTime() > now;
      });
      
      setMessages(valid);
    } catch (e) {
      console.error('Chat fetch error:', e);
    }
  };

  const sendMessage = async () => {
    if (!input.trim()) return;
    setLoading(true);
    setError('');

    try {
      const body = isOrderChat
        ? { order_id: orderId, sender: user, message: input, ttl_seconds: ttl }
        : { buyer, vendor, sender: user, message: input, ttl_seconds: ttl };

      const headers = { 'Content-Type': 'application/json' };
      const sessionData = JSON.parse(localStorage.getItem('silkGenesis_session') || '{}');
      const activeToken = token || sessionData.session_token;
      
      if (activeToken) {
        headers['Authorization'] = `Bearer ${activeToken}`;
      }

      const res = await fetch(sendEndpoint, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(body)
      });
      const data = await res.json();

      if (data.status === 'success') {
        setInput('');
        setPgpStatus(data.encrypted ? 'encrypted' : 'unencrypted');
        await fetchMessages();
      } else {
        setError(data.detail || 'Send failed');
      }
    } catch (e) {
      setError('Connection error');
    }
    setLoading(false);
  };

  const formatTime = (ts) => {
    if (!ts) return '';
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const getExpiryLabel = (expires_at) => {
    if (!expires_at) return null;
    const remaining = new Date(expires_at).getTime() - Date.now();
    if (remaining <= 0) return '⏰ Expired';
    const hours = Math.floor(remaining / 3600000);
    const mins = Math.floor((remaining % 3600000) / 60000);
    if (hours > 24) return `⏳ ${Math.floor(hours/24)}d remaining`;
    if (hours > 0) return `⏳ ${hours}h ${mins}m remaining`;
    return `⏳ ${mins}m remaining`;
  };

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      background: '#0d1117', border: '1px solid #30363d', borderRadius: 12, overflow: 'hidden'
    }}>
      {/* Header */}
      <div style={{
        padding: '12px 16px', background: '#161b22',
        borderBottom: '1px solid #30363d', display: 'flex',
        justifyContent: 'space-between', alignItems: 'center'
      }}>
        <div>
          <span style={{ color: '#c9d1d9', fontWeight: 'bold' }}>
            {isOrderChat ? `🔒 Order Chat #${orderId?.slice(-8)}` : `💬 Chat with ${vendor === user ? buyer : vendor}`}
          </span>
          <span style={{
            marginLeft: 8, fontSize: 11, padding: '2px 6px',
            background: '#0d2818', color: '#3fb950', borderRadius: 4
          }}>
            🔐 PGP E2EE
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {pgpStatus && (
            <span style={{
              fontSize: 11, padding: '2px 6px', borderRadius: 4,
              background: pgpStatus === 'encrypted' ? '#0d2818' : '#2d1b00',
              color: pgpStatus === 'encrypted' ? '#3fb950' : '#d29922'
            }}>
              {pgpStatus === 'encrypted' ? '🔐 Encrypted' : '⚠️ Unencrypted'}
            </span>
          )}
        </div>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {messages.length === 0 && (
          <div style={{ textAlign: 'center', color: '#8b949e', padding: 32 }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>🔐</div>
            <p>No messages yet. Messages are end-to-end encrypted with PGP.</p>
            <p style={{ fontSize: 12 }}>Auto-destructible messages supported.</p>
          </div>
        )}

        {messages.map((msg, i) => {
          const isMe = msg.sender === user;
          const isSystem = msg.is_system || msg.sender === 'SYSTEM';
          const expiry = getExpiryLabel(msg.expires_at);

          if (isSystem) {
            return (
              <div key={i} style={{ textAlign: 'center' }}>
                <span style={{
                  background: '#161b22', color: '#8b949e', fontSize: 12,
                  padding: '4px 12px', borderRadius: 12, display: 'inline-block'
                }}>
                  {msg.message}
                </span>
              </div>
            );
          }

          return (
            <div key={i} style={{
              display: 'flex', flexDirection: 'column',
              alignItems: isMe ? 'flex-end' : 'flex-start'
            }}>
              <div style={{
                maxWidth: '75%', padding: '8px 12px',
                background: isMe ? '#1f6feb' : '#161b22',
                borderRadius: isMe ? '12px 12px 4px 12px' : '12px 12px 12px 4px',
                border: `1px solid ${isMe ? '#388bfd' : '#30363d'}`
              }}>
                {!isMe && (
                  <div style={{ color: '#58a6ff', fontSize: 11, marginBottom: 4, fontWeight: 'bold' }}>
                    {msg.sender}
                  </div>
                )}
                <div style={{ color: '#c9d1d9', fontSize: 14, wordBreak: 'break-word' }}>
                  {msg.encrypted ? (
                    <span style={{ fontFamily: 'monospace', fontSize: 12, color: '#8b949e' }}>
                      🔐 {msg.message.length > 100 ? msg.message.slice(0, 100) + '...' : msg.message}
                    </span>
                  ) : msg.message}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4, gap: 8 }}>
                  <span style={{ color: '#8b949e', fontSize: 10 }}>{formatTime(msg.timestamp)}</span>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {msg.encrypted && <span style={{ fontSize: 10, color: '#3fb950' }}>🔐</span>}
                    {expiry && <span style={{ fontSize: 10, color: '#d29922' }}>{expiry}</span>}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* TTL Selector */}
      {showTtl && (
        <div style={{
          padding: '8px 16px', background: '#161b22',
          borderTop: '1px solid #30363d', display: 'flex', gap: 8, flexWrap: 'wrap'
        }}>
          <span style={{ color: '#8b949e', fontSize: 12, alignSelf: 'center' }}>⏳ Auto-delete:</span>
          {TTL_OPTIONS.map(opt => (
            <button key={opt.seconds} onClick={() => { setTtl(opt.seconds); setShowTtl(false); }} style={{
              padding: '3px 8px', fontSize: 11,
              background: ttl === opt.seconds ? '#1f6feb' : '#21262d',
              color: '#c9d1d9', border: '1px solid #30363d', borderRadius: 4, cursor: 'pointer'
            }}>
              {opt.label}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <div style={{ padding: '12px 16px', background: '#161b22', borderTop: '1px solid #30363d' }}>
        {error && <p style={{ color: '#f85149', fontSize: 12, margin: '0 0 8px' }}>❌ {error}</p>}
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <button onClick={() => setShowTtl(!showTtl)} title="Set message expiry" style={{
            padding: '8px', background: showTtl ? '#1f6feb' : '#21262d',
            border: '1px solid #30363d', borderRadius: 8, cursor: 'pointer',
            color: '#8b949e', fontSize: 16, flexShrink: 0
          }}>
            ⏳
          </button>
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
            placeholder="Type a message... (PGP encrypted if recipient has key)"
            rows={2}
            style={{
              flex: 1, padding: '8px 12px', background: '#0d1117',
              border: '1px solid #30363d', borderRadius: 8, color: '#c9d1d9',
              fontSize: 14, resize: 'none', outline: 'none', fontFamily: 'inherit'
            }}
          />
          <button onClick={sendMessage} disabled={loading || !input.trim()} style={{
            padding: '8px 16px', background: input.trim() ? '#238636' : '#21262d',
            color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer',
            fontSize: 14, flexShrink: 0, alignSelf: 'stretch'
          }}>
            {loading ? '⏳' : '📤 Send'}
          </button>
        </div>
        <div style={{ marginTop: 6, display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ color: '#8b949e', fontSize: 11 }}>
            🔐 E2EE • ⏳ {TTL_OPTIONS.find(o => o.seconds === ttl)?.label || 'No expiry'}
          </span>
          <span style={{ color: '#8b949e', fontSize: 11 }}>Enter to send • Shift+Enter for newline</span>
        </div>
      </div>
    </div>
  );
}

