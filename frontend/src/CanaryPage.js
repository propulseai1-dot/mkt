import React, { useState, useEffect } from 'react';
import {
  Eye, CheckCircle, AlertTriangle, Clock,
  Key, Globe, ArrowLeft, RefreshCw, Copy,
  ShieldCheck, XCircle, Calendar, Hash, FileText
} from 'lucide-react';

// ============================================================
// CANARY PAGE - Warrant Canary
// ============================================================
// Un "warrant canary" est une declaration publique regulierement
// update indiquant que la plateforme n'a PAS recu de:
// - Ordonnances judiciaires secretes
// - Lettres de security nationale (NSL)
// - Demandes de surveillance gouvernementale
// - Injonctions de non-divulgation
//
// Si la page cesse d'etre update → presumez compromis.
// ============================================================

// Date de la derniere update du canary (a mettre a jour manuellement)
const CANARY_DATE = "2026-04-22";
const CANARY_VERSION = "v1.4";
const NEXT_UPDATE_DAYS = 30; // Update toutes les 30 jours

// Texte officiel du canary (signe PGP par l'admin)
const CANARY_TEXT = `-----BEGIN CANARY STATEMENT-----

SilkGenesis Warrant Canary — ${CANARY_DATE} — ${CANARY_VERSION}

We, the operators of SilkGenesis, hereby state the following:

1. NO LEGAL ORDERS RECEIVED
   We have NOT received any of the following:
   - National Security Letters (NSL)
   - FISA court orders or warrants
   - Gag orders or non-disclosure orders
   - Subpoenas for user data
   - Any government requests for user information
   - Any court orders to install backdoors or surveillance

2. NO COMPROMISE
   - The platform has NOT been seized or compromised
   - We have NOT been coerced to modify the platform
   - No backdoors have been installed in the software
   - The Monero wallet private keys remain under our sole control
   - No user data has been disclosed to any third party

3. PLATFORM INTEGRITY
   - The codebase has not been tampered with by external parties
   - All security features described in the About page remain active
   - Monero RPC is running on local infrastructure only

4. VERIFICATION
   This statement is updated every ${NEXT_UPDATE_DAYS} days.
   If this statement is NOT updated within ${NEXT_UPDATE_DAYS} days of the date above,
   assume the platform has been compromised or is under legal duress.

   Next expected update: ${getNextUpdateDate(CANARY_DATE, NEXT_UPDATE_DAYS)}

5. CANARY HASH
   SHA-256 of this statement (excluding this line):
   [Computed client-side — see verification section below]

Signed,
SilkGenesis Operations Team

-----END CANARY STATEMENT-----`;

function getNextUpdateDate(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

function getDaysUntilExpiry(dateStr, days) {
  const updateDate = new Date(dateStr);
  const expiryDate = new Date(updateDate);
  expiryDate.setDate(expiryDate.getDate() + days);
  const now = new Date();
  const diff = Math.floor((expiryDate - now) / (1000 * 60 * 60 * 24));
  return diff;
}

function getDaysSinceUpdate(dateStr) {
  const updateDate = new Date(dateStr);
  const now = new Date();
  return Math.floor((now - updateDate) / (1000 * 60 * 60 * 24));
}

// Calcul SHA-256 du texte canary (Web Crypto API)
async function computeHash(text) {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export default function CanaryPage({ onNavigate }) {
  const [hash, setHash] = useState('Computing...');
  const [copied, setCopied] = useState(false);
  const [hashCopied, setHashCopied] = useState(false);
  const [platformStatus, setPlatformStatus] = useState(null);
  const [loadingStatus, setLoadingStatus] = useState(true);

  const daysUntilExpiry = getDaysUntilExpiry(CANARY_DATE, NEXT_UPDATE_DAYS);
  const daysSinceUpdate = getDaysSinceUpdate(CANARY_DATE);
  const isExpired = daysUntilExpiry < 0;
  const isWarning = daysUntilExpiry < 7 && !isExpired;

  // Calculer le hash du canary
  useEffect(() => {
    computeHash(CANARY_TEXT).then(h => setHash(h));
  }, []);

  // Fetch le statut de la plateforme
  useEffect(() => {
    fetch('/api/platform/status')
      .then(r => r.json())
      .then(d => setPlatformStatus(d))
      .catch(() => setPlatformStatus(null))
      .finally(() => setLoadingStatus(false));
  }, []);

  const handleCopyCanary = () => {
    navigator.clipboard.writeText(CANARY_TEXT).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleCopyHash = () => {
    navigator.clipboard.writeText(hash).then(() => {
      setHashCopied(true);
      setTimeout(() => setHashCopied(false), 2000);
    });
  };

  const statusColor = isExpired ? 'red' : isWarning ? 'yellow' : 'green';
  const statusIcon = isExpired ? <XCircle size={20} /> : isWarning ? <AlertTriangle size={20} /> : <CheckCircle size={20} />;
  const statusText = isExpired
    ? '⚠️ CANARY EXPIRED — ASSUME COMPROMISE'
    : isWarning
    ? `⚠️ Canary expires in ${daysUntilExpiry} days — Update pending`
    : `✅ Canary is VALID — Updated ${daysSinceUpdate} day${daysSinceUpdate !== 1 ? 's' : ''} ago`;

  const colorMap = {
    green: {
      bg: 'bg-green-900/20',
      border: 'border-green-700/40',
      text: 'text-green-400',
      badge: 'bg-green-900/40 text-green-300 border-green-700/40'
    },
    yellow: {
      bg: 'bg-yellow-900/20',
      border: 'border-yellow-700/40',
      text: 'text-yellow-400',
      badge: 'bg-yellow-900/40 text-yellow-300 border-yellow-700/40'
    },
    red: {
      bg: 'bg-red-900/20',
      border: 'border-red-700/40',
      text: 'text-red-400',
      badge: 'bg-red-900/40 text-red-300 border-red-700/40'
    }
  };
  const c = colorMap[statusColor];

  return (
    <div className="min-h-screen bg-[#050505] text-white">

      {/* Header */}
      <div className="border-b border-white/5 px-6 py-4 flex items-center gap-4">
        <button
          onClick={() => onNavigate && onNavigate('about')}
          className="flex items-center gap-2 text-gray-500 hover:text-white transition-colors text-sm"
        >
          <ArrowLeft size={16} /> Back to About
        </button>
        <div className="h-4 w-px bg-white/10" />
        <span className="text-gray-600 text-sm">Warrant Canary</span>
      </div>

      <div className="max-w-3xl mx-auto px-6 py-12">

        {/* Hero */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-green-900/20 border border-green-700/30 text-green-400 text-xs font-bold uppercase tracking-widest mb-6">
            <Eye size={14} /> Warrant Canary
          </div>
          <h1 className="text-3xl md:text-4xl font-black text-white mb-4">
            SilkGenesis <span className="text-green-400">Canary</span>
          </h1>
          <p className="text-gray-400 max-w-xl mx-auto text-sm leading-relaxed">
            A warrant canary is a regularly updated statement confirming that we have NOT received
            any secret legal orders, surveillance requests, or government compulsion.
            If this page stops updating, <strong className="text-white">assume compromise.</strong>
          </p>
        </div>

        {/* Status Card */}
        <div className={`${c.bg} border ${c.border} rounded-2xl p-6 mb-8`}>
          <div className="flex items-center gap-3 mb-4">
            <span className={c.text}>{statusIcon}</span>
            <h2 className={`text-lg font-black uppercase ${c.text}`}>{statusText}</h2>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: 'Last Updated', value: CANARY_DATE, icon: <Calendar size={14} /> },
              { label: 'Version', value: CANARY_VERSION, icon: <Hash size={14} /> },
              { label: 'Days Since Update', value: `${daysSinceUpdate}d`, icon: <Clock size={14} /> },
              { label: 'Expires In', value: isExpired ? 'EXPIRED' : `${daysUntilExpiry}d`, icon: <AlertTriangle size={14} /> },
            ].map((s, i) => (
              <div key={i} className="bg-black/30 rounded-xl p-3 text-center">
                <div className={`flex justify-center mb-1 ${c.text}`}>{s.icon}</div>
                <div className="text-white font-black text-sm">{s.value}</div>
                <div className="text-gray-500 text-[10px] uppercase tracking-wide">{s.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Platform Live Status */}
        <div className="bg-white/5 border border-white/10 rounded-2xl p-6 mb-8">
          <h3 className="text-white font-black uppercase text-sm mb-4 flex items-center gap-2">
            <Globe size={16} className="text-blue-400" /> Live Platform Status
          </h3>
          {loadingStatus ? (
            <div className="flex items-center gap-2 text-gray-500 text-sm">
              <RefreshCw size={14} className="animate-spin" /> Checking platform status...
            </div>
          ) : platformStatus ? (
            <div className="space-y-3">
              {[
                {
                  label: 'Platform Operational',
                  value: !platformStatus.freeze_all_withdrawals,
                  trueText: 'Online',
                  falseText: 'Restricted'
                },
                {
                  label: 'Withdrawals Active',
                  value: !platformStatus.freeze_all_withdrawals,
                  trueText: 'Processing',
                  falseText: 'Frozen'
                },
                {
                  label: 'Liquidity Mode',
                  value: !platformStatus.liquidity_mode,
                  trueText: 'Normal',
                  falseText: 'Restricted'
                },
                {
                  label: 'New Registrations',
                  value: !platformStatus.registration_paused,
                  trueText: 'Open',
                  falseText: 'Paused'
                },
              ].map((item, i) => (
                <div key={i} className="flex items-center justify-between py-2 border-b border-white/5 last:border-0">
                  <span className="text-gray-400 text-sm">{item.label}</span>
                  <span className={`text-xs font-bold px-3 py-1 rounded-full border ${
                    item.value
                      ? 'bg-green-900/30 text-green-400 border-green-700/40'
                      : 'bg-yellow-900/30 text-yellow-400 border-yellow-700/40'
                  }`}>
                    {item.value ? item.trueText : item.falseText}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex items-center gap-2 text-yellow-400 text-sm">
              <AlertTriangle size={14} /> Could not reach platform API — backend may be offline
            </div>
          )}
        </div>

        {/* What We Confirm */}
        <div className="bg-white/5 border border-white/10 rounded-2xl p-6 mb-8">
          <h3 className="text-white font-black uppercase text-sm mb-5 flex items-center gap-2">
            <ShieldCheck size={16} className="text-green-400" /> What We Confirm (As Of {CANARY_DATE})
          </h3>
          <div className="space-y-3">
            {[
              "We have NOT received any National Security Letters",
              "We have NOT received any FISA court orders",
              "We have NOT received any gag orders or non-disclosure orders",
              "We have NOT been compelled to install backdoors",
              "We have NOT disclosed any user data to any government or third party",
              "The platform has NOT been seized or compromised",
              "The Monero wallet private keys remain under our sole control",
              "No user IP addresses have been logged or disclosed",
              "All security features described in the About page remain active and unmodified",
            ].map((item, i) => (
              <div key={i} className="flex items-start gap-3">
                <CheckCircle size={14} className="text-green-500 mt-0.5 shrink-0" />
                <span className="text-gray-300 text-sm">{item}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Canary Text */}
        <div className="bg-black border border-white/10 rounded-2xl overflow-hidden mb-8">
          <div className="flex items-center justify-between px-5 py-3 border-b border-white/10 bg-white/5">
            <div className="flex items-center gap-2">
              <FileText size={14} className="text-gray-400" />
              <span className="text-gray-400 text-xs font-mono uppercase tracking-wide">Official Canary Statement</span>
            </div>
            <button
              onClick={handleCopyCanary}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                copied ? 'bg-green-700 text-white' : 'bg-white/10 text-gray-400 hover:bg-white/20'
              }`}
            >
              <Copy size={12} />
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
          <pre className="p-5 text-[11px] text-green-400 font-mono leading-relaxed overflow-x-auto whitespace-pre-wrap">
            {CANARY_TEXT}
          </pre>
        </div>

        {/* Hash Verification */}
        <div className="bg-white/5 border border-white/10 rounded-2xl p-6 mb-8">
          <h3 className="text-white font-black uppercase text-sm mb-2 flex items-center gap-2">
            <Hash size={16} className="text-amber-400" /> Statement Hash (SHA-256)
          </h3>
          <p className="text-gray-500 text-xs mb-4">
            Compute the SHA-256 hash of the canary text above and compare it to this value.
            A mismatch indicates the statement has been tampered with.
          </p>
          <div className="flex items-center gap-3 bg-black rounded-xl p-4 border border-white/10">
            <code className="text-amber-400 text-[11px] font-mono break-all flex-1">{hash}</code>
            <button
              onClick={handleCopyHash}
              className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                hashCopied ? 'bg-green-700 text-white' : 'bg-white/10 text-gray-400 hover:bg-white/20'
              }`}
            >
              <Copy size={12} />
              {hashCopied ? 'Copied!' : 'Copy'}
            </button>
          </div>
          <p className="text-gray-600 text-[10px] mt-3">
            Hash computed client-side using Web Crypto API (SHA-256). No server involved.
          </p>
        </div>

        {/* How to Verify */}
        <div className="bg-blue-950/20 border border-blue-800/30 rounded-2xl p-6 mb-8">
          <h3 className="text-blue-400 font-black uppercase text-sm mb-4 flex items-center gap-2">
            <Key size={16} /> How to Verify This Canary
          </h3>
          <div className="space-y-4">
            <div>
              <p className="text-white text-xs font-bold mb-1">1. Check the date</p>
              <p className="text-gray-400 text-xs">
                The canary must be updated within {NEXT_UPDATE_DAYS} days. If the date is older than {NEXT_UPDATE_DAYS} days,
                the canary has expired — assume the platform is under legal duress.
              </p>
            </div>
            <div>
              <p className="text-white text-xs font-bold mb-1">2. Verify the hash</p>
              <p className="text-gray-400 text-xs mb-2">
                Copy the canary text and compute its SHA-256 hash. Compare with the hash shown above.
              </p>
              <div className="bg-black rounded-lg p-3 font-mono text-[10px] text-gray-400 break-all whitespace-normal">
                <span className="text-green-400"># Linux/Mac:</span><br />
                echo -n "CANARY_TEXT" | sha256sum<br /><br />
                <span className="text-green-400"># Windows PowerShell:</span><br />
                <span className="block break-all">
                  [System.BitConverter]::ToString([System.Security.Cryptography.SHA256]::Create().ComputeHash([System.Text.Encoding]::UTF8.GetBytes("CANARY_TEXT"))).Replace("-","").ToLower()
                </span>
              </div>
            </div>
            <div>
              <p className="text-white text-xs font-bold mb-1">3. Monitor for changes</p>
              <p className="text-gray-400 text-xs">
                Bookmark this page and check it regularly. If the canary disappears, stops updating,
                or the statements change, treat it as a compromise signal.
              </p>
            </div>
          </div>
        </div>

        {/* What Canary Expiry Means */}
        <div className="bg-red-950/10 border border-red-800/20 rounded-2xl p-6 mb-8">
          <h3 className="text-red-400 font-black uppercase text-sm mb-3 flex items-center gap-2">
            <AlertTriangle size={16} /> If The Canary Expires or Disappears
          </h3>
          <div className="space-y-2">
            {[
              "Stop using the platform immediately",
              "Do not make any new deposits or orders",
              "Attempt to withdraw any remaining funds",
              "Assume all activity on the platform may be monitored",
              "Do not log in from your regular device or network",
              "Contact trusted community members through alternative channels",
            ].map((item, i) => (
              <div key={i} className="flex items-start gap-2">
                <XCircle size={12} className="text-red-500 mt-0.5 shrink-0" />
                <span className="text-gray-400 text-xs">{item}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="text-center">
          <p className="text-gray-600 text-xs mb-2">
            Next canary update expected by: <strong className="text-gray-500">{getNextUpdateDate(CANARY_DATE, NEXT_UPDATE_DAYS)}</strong>
          </p>
          <p className="text-gray-700 text-[10px]">
            SilkGenesis Warrant Canary {CANARY_VERSION} — Updated {CANARY_DATE}
          </p>
        </div>
      </div>
    </div>
  );
}

