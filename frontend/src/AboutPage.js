import React from 'react';
import { Eye, ArrowRight } from 'lucide-react';

const SECTION_DATA = [
  {
    title: 'Authentication',
    items: [
      'Argon2id password hashing',
      'TOTP Two-Factor Authentication',
      'Custom anti-bot protection',
      'Automatic 30-minute session timeout',
      'Brute-force protection + rate limiting',
      'Cryptographically secure session tokens',
    ],
  },
  {
    title: 'Communication Security',
    items: [
      'Mandatory PGP encryption for all orders and messages',
      'PGP key validation on upload',
      'Private keys stored encrypted at rest',
    ],
  },
  {
    title: 'Financial Security (XMR)',
    items: [
      'Monero only - Ring signatures, stealth addresses, RingCT',
      'Unique subaddress generated for every user and every order',
      '10-confirmations required for deposits',
      '2-of-3 multisig escrow available on large orders',
      'Withdrawals processed automatically after internal review',
    ],
  },
  {
    title: 'Infrastructure',
    items: [
      'Tor Hidden Service only (.onion)',
      'No analytics, no tracking, no third-party services',
      'Monero RPC bound to localhost only',
      'Strict security headers enforced',
    ],
  },
  {
    title: 'Platform Rules',
    items: [
      'Vendor bond required',
      '14-day auto-finalize policy',
      'Dispute system available with escrow protection',
      'All critical actions are logged internally for security purposes',
    ],
  },
  {
    title: 'Technology',
    items: [
      'Backend: Python + FastAPI',
      'Frontend: React',
      'Database: SQLite with WAL',
      'Wallet: Monero RPC',
      'Network: Tor + Nginx',
    ],
  },
];

export default function AboutPage({ onNavigate }) {
  return (
    <div className="min-h-screen bg-[#050505] text-white">
      <div className="relative overflow-hidden border-b border-white/5">
        <div className="absolute inset-0 bg-gradient-to-br from-amber-950/20 via-black to-black pointer-events-none" />
        <div className="relative max-w-4xl mx-auto px-6 py-14">
          <h1 className="text-3xl md:text-4xl font-black text-white mb-4">
            SilkGenesis - Monero-only marketplace.
          </h1>
          <p className="text-gray-300 text-base mb-3">
            Privacy-first. No logs. No bullshit.
          </p>
          <div className="bg-white/5 border border-white/10 rounded-xl p-4 text-sm">
            <p className="text-amber-400 font-bold uppercase tracking-wide mb-1">Marketplace Fee</p>
            <p className="text-gray-200">
              Progressive fee based on vendor volume: <strong>8%</strong> down to <strong>2%</strong>.
            </p>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-10 space-y-6">
        <h2 className="text-xl font-black uppercase text-amber-400">Security Features</h2>

        {SECTION_DATA.map((section, i) => (
          <div key={i} className="bg-white/5 border border-white/10 rounded-2xl p-6">
            <h3 className="text-white text-sm font-black uppercase tracking-wide mb-4">{section.title}</h3>
            <ul className="space-y-2">
              {section.items.map((item, idx) => (
                <li key={idx} className="text-gray-300 text-sm flex items-start gap-2">
                  <span className="text-amber-500 mt-[2px]">-</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}

        <div className="bg-gradient-to-r from-green-950/30 to-transparent border border-green-800/30 rounded-2xl p-6 flex items-center justify-between">
          <div>
            <h3 className="text-green-400 font-black uppercase text-sm mb-1 flex items-center gap-2">
              <Eye size={16} /> Warrant Canary
            </h3>
            <p className="text-gray-400 text-xs">
              Check the latest canary update.
            </p>
          </div>
          <button
            onClick={() => onNavigate && onNavigate('canary')}
            className="shrink-0 ml-4 flex items-center gap-2 px-4 py-2 bg-green-900/30 border border-green-700/40 text-green-400 rounded-xl text-sm font-bold hover:bg-green-900/50 transition-colors"
          >
            View Canary <ArrowRight size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
