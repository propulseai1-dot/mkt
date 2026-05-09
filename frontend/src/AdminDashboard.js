import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Users, Package, ShoppingCart, AlertTriangle, TrendingUp,
  Shield, Activity, RefreshCw, CheckCircle, XCircle, Clock,
  DollarSign, Zap, Bell, Eye, Trash2, UserCheck, UserX,
  BarChart2, Lock, Unlock, Terminal, AlertOctagon, Database, Image
} from 'lucide-react';
import AdminCategories from './AdminCategories';
import LiquidityDashboard from './LiquidityDashboard';
import { silkApiUrl } from './silkApi';

// ============================================================
// ADMIN DASHBOARD - Real-time monitoring & control panel
// ============================================================

function StatCard({ icon: Icon, label, value, sub, color = '#9b59b6', trend }) {
  return (
    <div style={{
      background: '#0d0d1a', border: `1px solid ${color}22`,
      borderRadius: 10, padding: '16px 20px',
      borderLeft: `3px solid ${color}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <Icon size={18} style={{ color }} />
        {trend !== undefined && (
          <span style={{ fontSize: 10, color: trend >= 0 ? '#27ae60' : '#e74c3c' }}>
            {trend >= 0 ? '▲' : '▼'} {Math.abs(trend)}%
          </span>
        )}
      </div>
      <div style={{ fontSize: 24, fontWeight: 800, color: '#fff', lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: 11, color: '#555', marginTop: 4 }}>{label}</div>
      {sub && <div style={{ fontSize: 10, color: color, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

function Badge({ status }) {
  const colors = {
    active: '#27ae60', pending: '#f39c12', banned: '#e74c3c',
    escrow: '#9b59b6', shipped: '#3498db', completed: '#27ae60',
    dispute: '#e74c3c', cancelled: '#555', open: '#e74c3c',
    resolved: '#27ae60', vendor: '#f39c12', buyer: '#3498db', admin: '#9b59b6'
  };
  const color = colors[status] || '#555';
  return (
    <span style={{
      fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5,
      color, background: `${color}22`, padding: '2px 6px', borderRadius: 4
    }}>
      {status}
    </span>
  );
}

export default function AdminDashboard({ user, sessionToken: sessionTokenProp }) {
  const [tab, setTab] = useState('overview');
  const [stats, setStats] = useState(null);
  const [users, setUsers] = useState([]);
  const [orders, setOrders] = useState([]);
  const [disputes, setDisputes] = useState([]);
  const [sellerReqs, setSellerReqs] = useState([]);
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState(null);
  const [dmsStatus, setDmsStatus] = useState(null);
  const [dmsRemainingSec, setDmsRemainingSec] = useState(null);
  const [canaryInfo, setCanaryInfo] = useState(null);
  const [canaryUpdating, setCanaryUpdating] = useState(false);
  const [bannerForm, setBannerForm] = useState({ message: '', type: 'info', color: 'amber', active: true });
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [createUserForm, setCreateUserForm] = useState({ username: '', password: '', role: 'buyer' });
  const [cryptoPriceForm, setCryptoPriceForm] = useState({
    enabled: false,
    xmr_usd: '165',
    btc_usd: '74000',
  });
  const [cryptoPriceMeta, setCryptoPriceMeta] = useState(null);
  const [cryptoPricesSaving, setCryptoPricesSaving] = useState(false);
  const [dmsToggleSaving, setDmsToggleSaving] = useState(false);
  const listingImageInputRef = useRef(null);
  const [listingImageTargetId, setListingImageTargetId] = useState(null);
  const sessionToken = sessionTokenProp || (() => {
    try {
      const raw = localStorage.getItem('silkGenesis_session');
      if (!raw) return '';
      const parsed = JSON.parse(raw);
      return parsed.session_token || '';
    } catch {
      return '';
    }
  })();

  const showMsg = (text, type = 'success') => {
    setMsg({ text, type });
    setTimeout(() => setMsg(null), 4000);
  };

  const prepareListingImageDataUrl = (file) => new Promise((resolve, reject) => {
    // Keep payload small to avoid proxy/gateway timeouts on admin image updates.
    const maxSide = 1400;
    const quality = 0.82;
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Unable to read image file'));
    reader.onload = () => {
      const img = new window.Image();
      img.onerror = () => reject(new Error('Invalid image format'));
      img.onload = () => {
        const ratio = Math.min(1, maxSide / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * ratio));
        const h = Math.max(1, Math.round(img.height * ratio));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Canvas not available'));
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        if (!dataUrl || dataUrl.length > 1_600_000) {
          reject(new Error('Image too large after compression. Try a smaller file.'));
          return;
        }
        resolve(dataUrl);
      };
      img.src = String(reader.result || '');
    };
    reader.readAsDataURL(file);
  });

  const adminFetch = useCallback((path, options = {}) => {
    const rel = path.startsWith('/api') ? path : `/api${path.startsWith('/') ? path : `/${path}`}`;
    const headers = {
      ...(options.headers || {}),
      ...(sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
    };
    return fetch(silkApiUrl(rel), { ...options, headers });
  }, [sessionToken]);

  const formatDuration = (seconds) => {
    if (seconds == null || Number.isNaN(seconds)) return 'Unknown';
    const sec = Math.max(0, Math.floor(seconds));
    const days = Math.floor(sec / 86400);
    const hrs = Math.floor((sec % 86400) / 3600);
    const mins = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return days > 0
      ? `${days}d ${String(hrs).padStart(2, '0')}h ${String(mins).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`
      : `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [healthR, usersR, disputesR, reqsR, listingsR, canaryR, dmsR] = await Promise.all([
        fetch(silkApiUrl('/api/health')).then(r => r.json()).catch(() => ({})),
        adminFetch('/admin/users').then(r => r.json()).catch(() => []),
        adminFetch('/admin/disputes').then(r => r.json()).catch(() => []),
        adminFetch('/admin/seller-requests').then(r => r.json()).catch(() => []),
        fetch(silkApiUrl('/api/listings')).then(r => r.json()).catch(() => ({ items: [] })),
        fetch(silkApiUrl('/api/canary')).then(r => r.json()).catch(() => null),
        adminFetch(`/admin/dms/status?username=${encodeURIComponent(user?.username || '')}`).then(r => r.json()).catch(() => null),
      ]);
      setStats(healthR);
      setUsers(Array.isArray(usersR) ? usersR : []);
      setDisputes(Array.isArray(disputesR) ? disputesR : []);
      setSellerReqs(Array.isArray(reqsR) ? reqsR : []);
      setListings(listingsR.items || []);
      setCanaryInfo(canaryR && typeof canaryR === 'object' ? canaryR : null);
      setDmsStatus(dmsR && typeof dmsR === 'object' ? dmsR : null);
      if (dmsR && typeof dmsR.hours_remaining === 'number') {
        setDmsRemainingSec(Math.max(0, Math.floor(dmsR.hours_remaining * 3600)));
      }
    } catch (e) {}
    setLoading(false);
  }, [adminFetch, user?.username]);

  useEffect(() => {
    if (dmsRemainingSec == null) return undefined;
    const t = setInterval(() => {
      setDmsRemainingSec(prev => (prev == null ? prev : Math.max(0, prev - 1)));
    }, 1000);
    return () => clearInterval(t);
  }, [dmsRemainingSec]);

  useEffect(() => {
    loadAll();
    let interval;
    if (autoRefresh) {
      interval = setInterval(loadAll, 15000); // Refresh every 15s
    }
    return () => clearInterval(interval);
  }, [loadAll, autoRefresh]);

  // Actions
  const approveVendor = async (username) => {
    await adminFetch('/admin/approve-seller', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username })
    });
    showMsg(`${username} approved as vendor`);
    loadAll();
  };

  const resolveDispute = async (id, winner) => {
    await adminFetch('/admin/resolve-dispute', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, winner })
    });
    showMsg(`Dispute resolved for ${winner}`);
    loadAll();
  };

  const createUser = async () => {
    const username = createUserForm.username.trim().toLowerCase();
    const password = createUserForm.password;
    const role = createUserForm.role;
    if (username.length < 3) {
      showMsg('Username must be at least 3 characters', 'error');
      return;
    }
    if (password.length < 6) {
      showMsg('Password must be at least 6 characters', 'error');
      return;
    }
    if (!['buyer', 'vendor'].includes(role)) {
      showMsg('Role must be buyer or vendor', 'error');
      return;
    }
    try {
      const r = await adminFetch('/admin/create-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, role })
      });
      const d = await r.json();
      if (!r.ok || d?.detail) {
        showMsg(d?.detail || d?.error || 'Failed to create user', 'error');
        return;
      }
      showMsg(`User "${username}" created as ${role}`);
      setCreateUserForm({ username: '', password: '', role: 'buyer' });
      loadAll();
    } catch {
      showMsg('Connection error while creating user', 'error');
    }
  };

  const setBanner = async () => {
    await adminFetch('/admin/set-banner', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bannerForm)
    });
    showMsg('Banner updated!');
  };

  const updateCanary = async () => {
    setCanaryUpdating(true);
    try {
      const r = await adminFetch('/admin/canary/update', { method: 'POST' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        showMsg(d.detail || 'Failed to update warrant canary', 'error');
        return;
      }
      showMsg(`Warrant canary date set to today (${d.last_updated || ''}). Published at /api/canary.`);
      loadAll();
    } catch {
      showMsg('Network error (canary)', 'error');
    } finally {
      setCanaryUpdating(false);
    }
  };

  const setDmsEnabled = async (enabled) => {
    if (enabled) {
      const ok = window.confirm(
        'Enable the Dead Man Switch?\n\nIf you miss a check-in before the deadline, the configured action '
          + '(shutdown / wipe / alert) may run automatically.'
      );
      if (!ok) return;
    } else {
      const ok = window.confirm('Disable the Dead Man Switch? The timer state stays saved but nothing will trigger.');
      if (!ok) return;
    }
    setDmsToggleSaving(true);
    try {
      const r = await adminFetch('/admin/dms/configure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: user?.username,
          enabled,
          interval_hours: dmsStatus?.interval_hours ?? 72,
          action: dmsStatus?.action ?? 'shutdown',
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        showMsg(d.detail || 'DMS configuration rejected', 'error');
        return;
      }
      showMsg(enabled ? 'Dead Man Switch enabled (saved to disk)' : 'Dead Man Switch disabled');
      await loadAll();
    } catch {
      showMsg('Network error (DMS)', 'error');
    } finally {
      setDmsToggleSaving(false);
    }
  };

  const loadCryptoPricesConfig = useCallback(async () => {
    try {
      const r = await adminFetch('/admin/crypto-prices-config');
      const d = await r.json();
      if (!r.ok) {
        if (d?.detail) showMsg(String(d.detail), 'error');
        return;
      }
      setCryptoPriceForm({
        enabled: !!d.enabled,
        xmr_usd: d.xmr_usd != null ? String(d.xmr_usd) : '165',
        btc_usd: d.btc_usd != null ? String(d.btc_usd) : '74000',
      });
      setCryptoPriceMeta({
        effective_source: d.effective_source,
        last_update: d.last_update,
      });
    } catch {
      showMsg('Could not load crypto price config', 'error');
    }
  }, [adminFetch]);

  useEffect(() => {
    if (tab !== 'prices') return undefined;
    loadCryptoPricesConfig();
    return undefined;
  }, [tab, loadCryptoPricesConfig]);

  const saveCryptoPrices = async () => {
    const xmr = parseFloat(String(cryptoPriceForm.xmr_usd).replace(',', '.'));
    const btc = parseFloat(String(cryptoPriceForm.btc_usd).replace(',', '.'));
    if (!(xmr > 0 && btc > 0 && Number.isFinite(xmr) && Number.isFinite(btc))) {
      showMsg('XMR and BTC / USD must be positive numbers', 'error');
      return;
    }
    setCryptoPricesSaving(true);
    try {
      const r = await adminFetch('/admin/crypto-prices-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: cryptoPriceForm.enabled,
          xmr_usd: xmr,
          btc_usd: btc,
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        showMsg(d.detail || d.error || 'Save failed', 'error');
        return;
      }
      showMsg(
        cryptoPriceForm.enabled
          ? 'Manual crypto prices saved and active'
          : 'Settings saved — automatic pricing when manual mode is off'
      );
      loadCryptoPricesConfig();
    } catch {
      showMsg('Network error', 'error');
    } finally {
      setCryptoPricesSaving(false);
    }
  };

  const tabs = [
    { id: 'overview', label: '📊 Overview', icon: BarChart2 },
    { id: 'disputes', label: `⚖️ Disputes${disputes.filter(d => d.status === 'open').length > 0 ? ` (${disputes.filter(d => d.status === 'open').length})` : ''}`, icon: AlertTriangle },
    { id: 'users', label: '👥 Users', icon: Users },
    { id: 'listings', label: `🛒 Listings (${listings.length})`, icon: Package },
    { id: 'orders', label: '📦 Orders', icon: ShoppingCart },
    { id: 'vendors', label: `🏪 Vendors${sellerReqs.length > 0 ? ` (${sellerReqs.length})` : ''}`, icon: UserCheck },
    { id: 'categories', label: '🗂️ Categories', icon: Package },
    { id: 'prices', label: '💲 Crypto prices', icon: DollarSign },
    { id: 'liquidity', label: '💧 Liquidity & Withdrawals', icon: DollarSign },
    { id: 'system', label: '⚙️ System', icon: Terminal },
  ];

  const s = {
    container: { display: 'flex', flexDirection: 'column', height: '100%', background: '#080810' },
    topBar: { display: 'flex', alignItems: 'center', gap: 12, padding: '12px 20px', borderBottom: '1px solid #1a1a2e', background: '#0d0d1a' },
    tabBar: { display: 'flex', gap: 2, padding: '8px 16px', borderBottom: '1px solid #1a1a2e', background: '#0a0a14', overflowX: 'auto' },
    tab: (active) => ({
      padding: '6px 14px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: active ? 700 : 400,
      background: active ? '#9b59b6' : 'transparent', color: active ? '#fff' : '#666', whiteSpace: 'nowrap', transition: 'all 0.15s'
    }),
    content: { flex: 1, overflowY: 'auto', padding: 20 },
    table: { width: '100%', borderCollapse: 'collapse', fontSize: 12 },
    th: { padding: '8px 12px', textAlign: 'left', color: '#555', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, borderBottom: '1px solid #1a1a2e' },
    td: { padding: '8px 12px', borderBottom: '1px solid #0d0d1a', color: '#ccc', verticalAlign: 'middle' },
    actionBtn: (color) => ({ padding: '4px 10px', background: `${color}22`, color, border: `1px solid ${color}44`, borderRadius: 4, cursor: 'pointer', fontSize: 11, fontWeight: 600 }),
    sectionTitle: { fontSize: 16, fontWeight: 700, color: '#9b59b6', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 },
    input: { padding: '8px 12px', background: '#0d0d1a', border: '1px solid #222', borderRadius: 6, color: '#fff', fontSize: 13, outline: 'none', width: '100%', boxSizing: 'border-box' },
  };

  return (
    <div style={s.container}>
      {/* Top Bar */}
      <div style={s.topBar}>
        <Shield size={16} style={{ color: '#9b59b6' }} />
        <span style={{ fontSize: 14, fontWeight: 700, color: '#9b59b6' }}>Admin Control Panel</span>
        <span style={{ fontSize: 11, color: '#555', marginLeft: 4 }}>— {user?.username}</span>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            style={{ background: autoRefresh ? 'rgba(39,174,96,0.15)' : 'rgba(85,85,85,0.15)', border: `1px solid ${autoRefresh ? '#27ae60' : '#333'}`, borderRadius: 6, padding: '4px 10px', cursor: 'pointer', color: autoRefresh ? '#27ae60' : '#555', fontSize: 11 }}
          >
            <Activity size={11} style={{ display: 'inline', marginRight: 4 }} />
            {autoRefresh ? 'Live' : 'Paused'}
          </button>
          <button onClick={loadAll} style={{ background: 'none', border: '1px solid #222', borderRadius: 6, padding: '4px 8px', cursor: 'pointer', color: '#555' }}>
            <RefreshCw size={12} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
          </button>
        </div>
      </div>

      {/* Message */}
      {msg && (
        <div style={{
          padding: '8px 20px', fontSize: 12,
          background: msg.type === 'error' ? 'rgba(231,76,60,0.15)' : 'rgba(39,174,96,0.15)',
          color: msg.type === 'error' ? '#e74c3c' : '#27ae60',
          borderBottom: `1px solid ${msg.type === 'error' ? '#e74c3c' : '#27ae60'}44`
        }}>
          {msg.text}
        </div>
      )}

      {/* Tab Bar */}
      <div style={s.tabBar}>
        {tabs.map(t => (
          <button key={t.id} style={s.tab(tab === t.id)} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={s.content}>

        {/* ===== OVERVIEW ===== */}
        {tab === 'overview' && (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12, marginBottom: 24 }}>
              <StatCard icon={Users} label="Total Users" value={stats?.users || users.length} color="#3498db" />
              <StatCard icon={Package} label="Listings" value={stats?.products || listings.length} color="#9b59b6" />
              <StatCard icon={ShoppingCart} label="Orders" value={stats?.orders || 0} color="#27ae60" />
              <StatCard icon={AlertTriangle} label="Open Disputes" value={disputes.filter(d => d.status === 'open').length} color="#e74c3c" />
              <StatCard icon={UserCheck} label="Vendor Requests" value={sellerReqs.length} color="#f39c12" />
              <StatCard icon={Database} label="DB Active" value={stats?.db_exists ? '✓' : '✗'} color={stats?.db_exists ? '#27ae60' : '#e74c3c'} />
            </div>

            {/* Recent Activity */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              {/* Pending Disputes */}
              <div style={{ background: '#0d0d1a', border: '1px solid #1a1a2e', borderRadius: 10, padding: 16 }}>
                <div style={s.sectionTitle}><AlertTriangle size={14} /> Open Disputes</div>
                {disputes.filter(d => d.status === 'open').length === 0 ? (
                  <div style={{ color: '#555', fontSize: 12, textAlign: 'center', padding: 20 }}>No open disputes ✓</div>
                ) : (
                  disputes.filter(d => d.status === 'open').slice(0, 5).map(d => (
                    <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid #111' }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 11, color: '#ccc' }}>{d.buyer} vs {d.vendor}</div>
                        <div style={{ fontSize: 10, color: '#555' }}>{d.amount_xmr?.toFixed(4)} XMR</div>
                      </div>
                      <button style={s.actionBtn('#27ae60')} onClick={() => resolveDispute(d.id, 'buyer')}>Buyer</button>
                      <button style={s.actionBtn('#f39c12')} onClick={() => resolveDispute(d.id, 'vendor')}>Vendor</button>
                    </div>
                  ))
                )}
              </div>

              {/* Vendor Requests */}
              <div style={{ background: '#0d0d1a', border: '1px solid #1a1a2e', borderRadius: 10, padding: 16 }}>
                <div style={s.sectionTitle}><UserCheck size={14} /> Vendor Requests</div>
                {sellerReqs.length === 0 ? (
                  <div style={{ color: '#555', fontSize: 12, textAlign: 'center', padding: 20 }}>No pending requests ✓</div>
                ) : (
                  sellerReqs.slice(0, 5).map((req, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid #111' }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 11, color: '#ccc' }}>{req.username}</div>
                        <div style={{ fontSize: 10, color: '#555' }}>Paid: {req.paid?.toFixed(4)} XMR</div>
                      </div>
                      <button style={s.actionBtn('#27ae60')} onClick={() => approveVendor(req.username)}>Approve</button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {/* ===== USERS ===== */}
        {tab === 'users' && (
          <div>
            <div style={s.sectionTitle}><Users size={14} /> User Management ({users.length})</div>
            <div style={{ background: '#0d0d1a', border: '1px solid #1a1a2e', borderRadius: 10, padding: 14, marginBottom: 12 }}>
              <div style={{ fontSize: 11, color: '#777', marginBottom: 8 }}>Create user (buyer or vendor only)</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1.2fr 0.8fr auto', gap: 8 }}>
                <input
                  style={s.input}
                  placeholder="username"
                  value={createUserForm.username}
                  onChange={e => setCreateUserForm(f => ({ ...f, username: e.target.value }))}
                />
                <input
                  style={s.input}
                  placeholder="password"
                  type="password"
                  value={createUserForm.password}
                  onChange={e => setCreateUserForm(f => ({ ...f, password: e.target.value }))}
                />
                <select
                  style={s.input}
                  value={createUserForm.role}
                  onChange={e => setCreateUserForm(f => ({ ...f, role: e.target.value }))}
                >
                  <option value="buyer">buyer</option>
                  <option value="vendor">vendor</option>
                </select>
                <button style={s.actionBtn('#27ae60')} onClick={createUser}>
                  + Create
                </button>
              </div>
            </div>
            <div style={{ background: '#0d0d1a', border: '1px solid #1a1a2e', borderRadius: 10, overflow: 'hidden' }}>
              <table style={s.table}>
                <thead>
                  <tr>
                    <th style={s.th}>Username</th>
                    <th style={s.th}>Role</th>
                    <th style={s.th}>Status</th>
                    <th style={s.th}>Balance (XMR)</th>
                    <th style={s.th}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map(u => (
                    <tr key={u.username} style={{ transition: 'background 0.1s' }}>
                      <td style={s.td}>
                        <span style={{ fontFamily: 'monospace', color: u.role === 'admin' ? '#9b59b6' : '#ccc' }}>
                          {u.username}
                        </span>
                      </td>
                      <td style={s.td}><Badge status={u.role} /></td>
                      <td style={s.td}><Badge status={u.status} /></td>
                      <td style={s.td}>
                        <span style={{ color: '#27ae60', fontFamily: 'monospace' }}>
                          {u.balance?.toFixed(6)}
                        </span>
                      </td>
                      <td style={s.td}>
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          {u.role !== 'admin' && (
                            <button
                              style={s.actionBtn('#f39c12')}
                              onClick={async () => {
                                await adminFetch('/admin/approve-seller', {
                                  method: 'POST', headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ username: u.username })
                                });
                                showMsg(`${u.username} → vendor`);
                                loadAll();
                              }}
                            >
                              → Vendor
                            </button>
                          )}
                          {u.role !== 'admin' && (
                            <button
                              style={s.actionBtn(u.status === 'banned' ? '#27ae60' : '#e67e22')}
                              onClick={async () => {
                                const endpoint = u.status === 'banned' ? 'unban-user' : 'ban-user';
                                const r = await adminFetch(`/admin/${endpoint}`, {
                                  method: 'POST', headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ username: u.username })
                                });
                                const d = await r.json();
                                showMsg(d.message || d.error);
                                loadAll();
                              }}
                            >
                              {u.status === 'banned' ? 'Unban' : 'Ban'}
                            </button>
                          )}
                          {u.role !== 'admin' && (
                            <button
                              style={s.actionBtn('#e74c3c')}
                              onClick={async () => {
                                if (!window.confirm(`Delete user "${u.username}"? This cannot be undone.`)) return;
                                const r = await adminFetch('/admin/delete-user', {
                                  method: 'POST', headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ username: u.username })
                                });
                                const d = await r.json();
                                showMsg(d.message || d.error);
                                loadAll();
                              }}
                            >
                              Delete
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {users.length === 0 && (
                    <tr>
                      <td style={{ ...s.td, color: '#777', textAlign: 'center' }} colSpan={5}>
                        No users loaded. Click refresh or re-login admin session.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ===== ORDERS ===== */}
        {tab === 'orders' && (
          <div>
            <div style={s.sectionTitle}><ShoppingCart size={14} /> Orders</div>
            <div style={{ color: '#555', fontSize: 12, textAlign: 'center', padding: 40 }}>
              <ShoppingCart size={32} style={{ color: '#222', marginBottom: 8 }} />
              <div>Order history loaded from backend</div>
              <div style={{ marginTop: 8, fontSize: 11 }}>Total: {stats?.orders || 0} orders</div>
            </div>
          </div>
        )}

        {/* ===== DISPUTES ===== */}
        {tab === 'disputes' && (
          <div>
            <div style={s.sectionTitle}><AlertTriangle size={14} /> Disputes ({disputes.length})</div>
            {disputes.length === 0 ? (
              <div style={{ color: '#555', fontSize: 12, textAlign: 'center', padding: 40 }}>No disputes ✓</div>
            ) : (
              <div style={{ background: '#0d0d1a', border: '1px solid #1a1a2e', borderRadius: 10, overflow: 'hidden' }}>
                <table style={s.table}>
                  <thead>
                    <tr>
                      <th style={s.th}>ID</th>
                      <th style={s.th}>Buyer</th>
                      <th style={s.th}>Vendor</th>
                      <th style={s.th}>Amount</th>
                      <th style={s.th}>Reason</th>
                      <th style={s.th}>Status</th>
                      <th style={s.th}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {disputes.map(d => (
                      <tr key={d.id}>
                        <td style={s.td}><span style={{ fontFamily: 'monospace', fontSize: 10 }}>#{d.id?.slice(-6)}</span></td>
                        <td style={s.td}>{d.buyer}</td>
                        <td style={s.td}>{d.vendor}</td>
                        <td style={s.td}><span style={{ color: '#27ae60' }}>{d.amount_xmr?.toFixed(4)} XMR</span></td>
                        <td style={s.td}><span style={{ color: '#888', fontSize: 11 }}>{d.reason?.slice(0, 40)}</span></td>
                        <td style={s.td}><Badge status={d.status} /></td>
                        <td style={s.td}>
                          {d.status === 'open' && (
                            <div style={{ display: 'flex', gap: 4 }}>
                              <button style={s.actionBtn('#3498db')} onClick={() => resolveDispute(d.id, 'buyer')}>→ Buyer</button>
                              <button style={s.actionBtn('#f39c12')} onClick={() => resolveDispute(d.id, 'vendor')}>→ Vendor</button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ===== VENDORS ===== */}
        {tab === 'vendors' && (
          <div>
            <div style={s.sectionTitle}><UserCheck size={14} /> Vendor Requests ({sellerReqs.length})</div>
            {sellerReqs.length === 0 ? (
              <div style={{ color: '#555', fontSize: 12, textAlign: 'center', padding: 40 }}>No pending vendor requests ✓</div>
            ) : (
              <div style={{ background: '#0d0d1a', border: '1px solid #1a1a2e', borderRadius: 10, overflow: 'hidden' }}>
                <table style={s.table}>
                  <thead>
                    <tr>
                      <th style={s.th}>Username</th>
                      <th style={s.th}>Paid (XMR)</th>
                      <th style={s.th}>Status</th>
                      <th style={s.th}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sellerReqs.map((req, i) => (
                      <tr key={i}>
                        <td style={s.td}>{req.username}</td>
                        <td style={s.td}><span style={{ color: '#27ae60' }}>{req.paid?.toFixed(4)}</span></td>
                        <td style={s.td}><Badge status={req.status || 'pending'} /></td>
                        <td style={s.td}>
                          <button style={s.actionBtn('#27ae60')} onClick={() => approveVendor(req.username)}>
                            ✓ Approve
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div style={{ marginTop: 24 }}>
              <div style={s.sectionTitle}><Users size={14} /> Active Vendors</div>
              <div style={{ background: '#0d0d1a', border: '1px solid #1a1a2e', borderRadius: 10, overflow: 'hidden' }}>
                <table style={s.table}>
                  <thead>
                    <tr>
                      <th style={s.th}>Username</th>
                      <th style={s.th}>Balance</th>
                      <th style={s.th}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.filter(u => u.role === 'vendor').map(u => (
                      <tr key={u.username}>
                        <td style={s.td}>{u.username}</td>
                        <td style={s.td}><span style={{ color: '#27ae60' }}>{u.balance?.toFixed(6)} XMR</span></td>
                        <td style={s.td}><Badge status={u.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ===== LISTINGS (admin delete) ===== */}
        {tab === 'listings' && (
          <div>
            <input
              ref={listingImageInputRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={async (e) => {
                const file = e.target.files && e.target.files[0];
                const lid = listingImageTargetId;
                e.target.value = '';
                setListingImageTargetId(null);
                if (!file || !lid) return;
                try {
                  const preparedImage = await prepareListingImageDataUrl(file);
                  // POST JSON (pas PUT sur l'URL) : evite 404 proxy CRA + URLs longues
                  let r = await adminFetch('/admin/listing-image', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ listing_id: lid, image: preparedImage }),
                  });
                  // Fallback for older backend builds that only expose PUT route.
                  if (r.status === 404) {
                    r = await adminFetch(`/admin/listing/${encodeURIComponent(lid)}/image`, {
                      method: 'PUT',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ image: preparedImage }),
                    });
                  }
                  const d = await r.json().catch(() => ({}));
                  if (!r.ok) {
                    const det = d.detail;
                    const detailStr = Array.isArray(det)
                      ? det.map((x) => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join(' ')
                      : (det || d.error || `HTTP ${r.status}`);
                    showMsg(detailStr || 'Image update failed', 'error');
                    return;
                  }
                  showMsg(d.message || 'Listing image updated');
                  loadAll();
                } catch (err) {
                  showMsg(String(err?.message || err || 'Image processing failed'), 'error');
                }
              }}
            />
            <div style={s.sectionTitle}><Package size={14} /> All Listings ({listings.length})</div>
            <div style={{ background: '#0d0d1a', border: '1px solid #1a1a2e', borderRadius: 10, overflow: 'hidden' }}>
              <table style={s.table}>
                <thead>
                  <tr>
                    <th style={s.th}>Photo</th>
                    <th style={s.th}>Title</th>
                    <th style={s.th}>Vendor</th>
                    <th style={s.th}>Category</th>
                    <th style={s.th}>Price (XMR)</th>
                    <th style={s.th}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {listings.map(l => (
                    <tr key={l.id}>
                      <td style={s.td}>
                        <div style={{
                          width: 44, height: 44, borderRadius: 8, overflow: 'hidden',
                          background: '#111', border: '1px solid #2a2a3e', display: 'flex',
                          alignItems: 'center', justifyContent: 'center',
                        }}>
                          {l.image ? (
                            <img src={l.image} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          ) : (
                            <Image size={18} color="#444" />
                          )}
                        </div>
                      </td>
                      <td style={s.td}><span style={{ color: '#ccc', fontSize: 11 }}>{l.title?.slice(0, 40)}</span></td>
                      <td style={s.td}><span style={{ color: '#f39c12', fontSize: 11 }}>{l.vendor}</span></td>
                      <td style={s.td}><span style={{ color: '#555', fontSize: 10 }}>{l.category}</span></td>
                      <td style={s.td}><span style={{ color: '#27ae60', fontFamily: 'monospace' }}>{l.price_xmr?.toFixed(4)}</span></td>
                      <td style={s.td}>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                          <button
                            type="button"
                            style={s.actionBtn('#3498db')}
                            onClick={() => {
                              setListingImageTargetId(l.id);
                              setTimeout(() => listingImageInputRef.current?.click(), 0);
                            }}
                          >
                            <Image size={12} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
                            Photo
                          </button>
                          <button
                            style={s.actionBtn('#e74c3c')}
                            onClick={async () => {
                              if (!window.confirm(`Delete listing "${l.title}"?`)) return;
                              const r = await adminFetch(`/admin/listing/${l.id}`, { method: 'DELETE' });
                              const d = await r.json();
                              showMsg(d.message || d.error);
                              loadAll();
                            }}
                          >
                            🗑 Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ===== CATEGORIES ===== */}
        {tab === 'categories' && (
          <AdminCategories user={user} sessionToken={sessionToken} />
        )}

        {/* ===== CRYPTO PRICES (manual admin) ===== */}
        {tab === 'prices' && (
          <div style={{ maxWidth: 560 }}>
            <div style={s.sectionTitle}>
              <TrendingUp size={14} /> Spot USD (XMR / BTC)
            </div>
            <p style={{ fontSize: 12, color: '#666', marginBottom: 16, lineHeight: 1.5 }}>
              When manual mode is on, these values override the price oracle and clearnet fallback for the public ticker,
              listing rate, and vendor upgrade ($400 USD in XMR).
            </p>
            <div style={{ background: '#0d0d1a', border: '1px solid #1a1a2e', borderRadius: 10, padding: 16 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={cryptoPriceForm.enabled}
                  onChange={e => setCryptoPriceForm(f => ({ ...f, enabled: e.target.checked }))}
                  style={{ width: 18, height: 18, accentColor: '#9b59b6' }}
                />
                <span style={{ fontSize: 13, color: '#ccc' }}>Use manual prices (skips oracle / clearnet for display)</span>
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
                <div>
                  <label style={{ fontSize: 11, color: '#555', display: 'block', marginBottom: 4 }}>XMR / USD</label>
                  <input
                    style={s.input}
                    type="text"
                    inputMode="decimal"
                    value={cryptoPriceForm.xmr_usd}
                    onChange={e => setCryptoPriceForm(f => ({ ...f, xmr_usd: e.target.value }))}
                    placeholder="165.00"
                  />
                </div>
                <div>
                  <label style={{ fontSize: 11, color: '#555', display: 'block', marginBottom: 4 }}>BTC / USD</label>
                  <input
                    style={s.input}
                    type="text"
                    inputMode="decimal"
                    value={cryptoPriceForm.btc_usd}
                    onChange={e => setCryptoPriceForm(f => ({ ...f, btc_usd: e.target.value }))}
                    placeholder="74000.00"
                  />
                </div>
              </div>
              {cryptoPriceMeta && (
                <div style={{ fontSize: 11, color: '#555', marginBottom: 12, fontFamily: 'monospace' }}>
                  Effective source:{' '}
                  <span style={{ color: '#9b59b6' }}>{cryptoPriceMeta.effective_source || '—'}</span>
                  {cryptoPriceMeta.last_update != null && (
                    <>
                      {' · '}
                      updated{' '}
                      {new Date(
                        typeof cryptoPriceMeta.last_update === 'number'
                          ? cryptoPriceMeta.last_update * 1000
                          : cryptoPriceMeta.last_update
                      ).toLocaleString()}
                    </>
                  )}
                </div>
              )}
              <button
                type="button"
                disabled={cryptoPricesSaving}
                onClick={saveCryptoPrices}
                style={{
                  padding: '10px 18px',
                  background: cryptoPricesSaving ? '#444' : '#9b59b6',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 6,
                  cursor: cryptoPricesSaving ? 'wait' : 'pointer',
                  fontSize: 13,
                  fontWeight: 600,
                }}
              >
                {cryptoPricesSaving ? 'Saving…' : 'Save prices'}
              </button>
            </div>
          </div>
        )}

        {/* ===== LIQUIDITY & WITHDRAWALS ===== */}
        {tab === 'liquidity' && (
          <LiquidityDashboard token={sessionToken} />
        )}

        {/* ===== SYSTEM ===== */}
        {tab === 'system' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Warrant Canary */}
            <div style={{ background: '#0d0d1a', border: '1px solid #3498db44', borderRadius: 10, padding: 16 }}>
              <div style={s.sectionTitle}><Shield size={14} /> Warrant Canary</div>
              <p style={{ fontSize: 11, color: '#666', marginBottom: 12, lineHeight: 1.5 }}>
                Updates the date inside the public statement served at{' '}
                <span style={{ fontFamily: 'monospace', color: '#3498db' }}>/api/canary</span>. The value is persisted on
                disk so it survives server restarts.
              </p>
              <div style={{ fontSize: 12, color: '#ccc', marginBottom: 12 }}>
                Last published date:{' '}
                <span style={{ fontFamily: 'monospace', color: '#9b59b6' }}>{canaryInfo?.last_updated || '—'}</span>
              </div>
              <button
                type="button"
                onClick={updateCanary}
                disabled={canaryUpdating}
                style={{
                  padding: '10px 18px',
                  background: canaryUpdating ? '#333' : '#3498db22',
                  color: '#3498db',
                  border: '1px solid #3498db55',
                  borderRadius: 6,
                  cursor: canaryUpdating ? 'default' : 'pointer',
                  fontSize: 12,
                  fontWeight: 700,
                }}
              >
                {canaryUpdating ? 'Updating…' : 'Set date to today'}
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              {/* System Banner */}
              <div style={{ background: '#0d0d1a', border: '1px solid #1a1a2e', borderRadius: 10, padding: 16 }}>
                <div style={s.sectionTitle}><Bell size={14} /> System Banner</div>
                <div style={{ marginBottom: 10 }}>
                  <label style={{ fontSize: 11, color: '#555', display: 'block', marginBottom: 4 }}>Message</label>
                  <input
                    style={s.input}
                    value={bannerForm.message}
                    onChange={e => setBannerForm(f => ({ ...f, message: e.target.value }))}
                    placeholder="Banner message..."
                  />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
                  <div>
                    <label style={{ fontSize: 11, color: '#555', display: 'block', marginBottom: 4 }}>Type</label>
                    <select style={s.input} value={bannerForm.type} onChange={e => setBannerForm(f => ({ ...f, type: e.target.value }))}>
                      <option value="info">Info</option>
                      <option value="promo">Promo</option>
                      <option value="warning">Warning</option>
                      <option value="maintenance">Maintenance</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: '#555', display: 'block', marginBottom: 4 }}>Color</label>
                    <select style={s.input} value={bannerForm.color} onChange={e => setBannerForm(f => ({ ...f, color: e.target.value }))}>
                      <option value="amber">Amber</option>
                      <option value="red">Red</option>
                      <option value="green">Green</option>
                      <option value="blue">Blue</option>
                    </select>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={setBanner} style={{ padding: '8px 16px', background: '#9b59b6', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                    Update Banner
                  </button>
                  <button onClick={() => { setBannerForm(f => ({ ...f, active: false })); setBanner(); }} style={{ padding: '8px 16px', background: '#333', color: '#aaa', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}>
                    Hide Banner
                  </button>
                </div>
              </div>

              {/* System Info */}
              <div style={{ background: '#0d0d1a', border: '1px solid #1a1a2e', borderRadius: 10, padding: 16 }}>
                <div style={s.sectionTitle}><Activity size={14} /> System Status</div>
                {stats && (
                  <div style={{ fontSize: 12 }}>
                    {[
                      ['Version', stats.version || '2.0'],
                      ['Users', stats.users],
                      ['Products', stats.products],
                      ['Orders', stats.orders],
                      ['Database', stats.db_exists ? '✓ Active' : '✗ Missing'],
                      ['Last Backup', stats.last_backup ? new Date(stats.last_backup).toLocaleDateString() : 'Never'],
                      ['Backup Count', stats.backup_count || 0],
                    ].map(([k, v]) => (
                      <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid #111' }}>
                        <span style={{ color: '#555' }}>{k}</span>
                        <span style={{ color: '#ccc', fontFamily: 'monospace' }}>{v}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Emergency Controls */}
              <div style={{ background: '#0d0d1a', border: '1px solid #e74c3c44', borderRadius: 10, padding: 16 }}>
                <div style={{ ...s.sectionTitle, color: '#e74c3c' }}><AlertOctagon size={14} /> Emergency Controls</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <button
                    onClick={() => {
                      if (window.confirm('⚠️ EMERGENCY SHUTDOWN: Stop the server immediately?')) {
                        adminFetch('/admin/emergency-shutdown', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: user?.username }) }).catch(() => {});
                        showMsg('Shutdown signal sent', 'error');
                      }
                    }}
                    style={{ padding: '10px 16px', background: 'rgba(231,76,60,0.15)', color: '#e74c3c', border: '1px solid #e74c3c44', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 600, textAlign: 'left' }}
                  >
                    🛑 Emergency Shutdown
                  </button>
                  <button
                    onClick={async () => {
                      const r = await adminFetch('/admin/backup', {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ username: user?.username, password: '' })
                      });
                      const d = await r.json();
                      showMsg(d.backup_file ? `Backup: ${d.backup_file}` : 'Backup triggered');
                    }}
                    style={{ padding: '10px 16px', background: 'rgba(39,174,96,0.1)', color: '#27ae60', border: '1px solid #27ae6044', borderRadius: 6, cursor: 'pointer', fontSize: 12, fontWeight: 600, textAlign: 'left' }}
                  >
                    💾 Manual Backup Now
                  </button>
                </div>
              </div>

              {/* Dead Man Switch */}
              <div style={{ background: '#0d0d1a', border: '1px solid #f39c1244', borderRadius: 10, padding: 16 }}>
                <div style={{ ...s.sectionTitle, color: '#f39c12' }}><Clock size={14} /> Dead Man Switch</div>
                <div style={{ fontSize: 12, color: '#888', marginBottom: 12, lineHeight: 1.5 }}>
                  When enabled, fires if no admin check-in before the deadline (security module; state persisted on disk).
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
                  <button
                    type="button"
                    disabled={dmsToggleSaving || dmsStatus?.enabled}
                    onClick={() => setDmsEnabled(true)}
                    style={{
                      flex: '1 1 140px',
                      padding: '10px 14px',
                      background: dmsStatus?.enabled ? '#222' : 'rgba(39,174,96,0.15)',
                      color: dmsStatus?.enabled ? '#555' : '#27ae60',
                      border: `1px solid ${dmsStatus?.enabled ? '#333' : '#27ae6044'}`,
                      borderRadius: 6,
                      cursor: dmsToggleSaving || dmsStatus?.enabled ? 'default' : 'pointer',
                      fontSize: 11,
                      fontWeight: 700,
                    }}
                  >
                    {dmsToggleSaving ? '…' : 'Enable DMS'}
                  </button>
                  <button
                    type="button"
                    disabled={dmsToggleSaving || !dmsStatus?.enabled}
                    onClick={() => setDmsEnabled(false)}
                    style={{
                      flex: '1 1 140px',
                      padding: '10px 14px',
                      background: !dmsStatus?.enabled ? '#222' : 'rgba(231,76,60,0.12)',
                      color: !dmsStatus?.enabled ? '#555' : '#e74c3c',
                      border: `1px solid ${!dmsStatus?.enabled ? '#333' : '#e74c3c44'}`,
                      borderRadius: 6,
                      cursor: dmsToggleSaving || !dmsStatus?.enabled ? 'default' : 'pointer',
                      fontSize: 11,
                      fontWeight: 700,
                    }}
                  >
                    Disable DMS
                  </button>
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    const r = await adminFetch('/admin/dms/checkin', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ username: user?.username }),
                    });
                    const d = await r.json();
                    if (typeof d?.next_required_in_hours === 'number') {
                      setDmsRemainingSec(Math.max(0, Math.floor(d.next_required_in_hours * 3600)));
                    }
                    showMsg(`Check-in recorded. Next deadline in ${d.next_required_in_hours}h.`);
                    loadAll();
                  }}
                  style={{
                    padding: '10px 16px',
                    background: 'rgba(243,156,18,0.15)',
                    color: '#f39c12',
                    border: '1px solid #f39c1244',
                    borderRadius: 6,
                    cursor: 'pointer',
                    fontSize: 12,
                    fontWeight: 600,
                    width: '100%',
                  }}
                >
                  ✓ Admin check-in (reset timer)
                </button>
                <div style={{ marginTop: 12, background: '#0a0a14', border: '1px solid #2a2a3e', borderRadius: 8, padding: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 6 }}>
                    <span style={{ color: '#666' }}>Status</span>
                    <span style={{ color: dmsStatus?.enabled ? '#27ae60' : '#777' }}>
                      {dmsStatus?.enabled ? 'ENABLED' : 'DISABLED'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 4 }}>
                    <span style={{ color: '#666' }}>Interval</span>
                    <span style={{ color: '#aaa', fontFamily: 'monospace' }}>
                      {dmsStatus?.interval_hours ?? 72} h
                    </span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 4 }}>
                    <span style={{ color: '#666' }}>Action</span>
                    <span style={{ color: '#f39c12', fontFamily: 'monospace' }}>{dmsStatus?.action || 'shutdown'}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
                    <span style={{ color: '#666' }}>Time left</span>
                    <span style={{ color: dmsRemainingSec === 0 ? '#e74c3c' : '#27ae60', fontFamily: 'monospace' }}>
                      {formatDuration(dmsRemainingSec)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
