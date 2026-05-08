/**
 * SILKGENESIS - Platform Status Banner
 * ======================================
 * Component affiche en haut de TOUTES les pages pour les users.
 * Displays de maniere transparente les modes de controle actifs.
 *
 * Usage :
 *   import PlatformStatusBanner from './PlatformStatusBanner';
 *   // Dans App.js ou le layout principal :
 *   <PlatformStatusBanner />
 *
 * Le composant poll /api/platform/status toutes les 60 secondes.
 * Aucune auth requise - endpoint public.
 */

import React, { useState, useEffect, useCallback } from 'react';

const POLL_INTERVAL_MS = 60_000; // 60 secondes

export default function PlatformStatusBanner() {
  const [status, setStatus] = useState(null);
  const [dismissed, setDismissed] = useState({});

  const fetchStatus = useCallback(async () => {
    try {
      const r = await fetch(`/api/platform/status`);
      if (r.ok) {
        const data = await r.json();
        setStatus(data);
      }
    } catch {
      // Silent - do not show an error if the API is unavailable
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  if (!status) return null;

  const banners = [];

  // ── 1. Emergency Freeze ──────────────────────────────────────────
  if (status.emergency_freeze?.active && !dismissed['freeze']) {
    banners.push(
      <Banner
        key="freeze"
        type="critical"
        icon="🔒"
        title="Withdrawals Temporarily Paused"
        message={status.emergency_freeze.user_message}
        onDismiss={() => setDismissed(d => ({ ...d, freeze: true }))}
        dismissable={false}  // Le freeze ne peut pas etre ignore
      />
    );
  }

  // ── 2. Liquidity Protection Mode ─────────────────────────────────
  if (
    status.liquidity_protection_mode?.active &&
    !status.emergency_freeze?.active &&
    !dismissed['lpm']
  ) {
    banners.push(
      <Banner
        key="lpm"
        type="warning"
        icon="⚠️"
        title="Liquidity Protection Mode Active"
        message={status.liquidity_protection_mode.user_message}
        onDismiss={() => setDismissed(d => ({ ...d, lpm: true }))}
        dismissable={true}
      />
    );
  }

  // ── 3. Structured Withdrawal Policy ──────────────────────────────
  if (
    status.structured_withdrawal_policy?.active &&
    !status.emergency_freeze?.active &&
    !dismissed['structured']
  ) {
    banners.push(
      <Banner
        key="structured"
        type="info"
        icon="ℹ️"
        title="Structured Withdrawal Policy"
        message={status.structured_withdrawal_policy.user_message}
        onDismiss={() => setDismissed(d => ({ ...d, structured: true }))}
        dismissable={true}
      />
    );
  }

  if (banners.length === 0) return null;

  return (
    <div style={styles.container}>
      {banners}
    </div>
  );
}

// ============================================================
// SOUS-COMPOSANT - Banner individuelle
// ============================================================

function Banner({ type, icon, title, message, onDismiss, dismissable }) {
  const theme = THEMES[type] || THEMES.info;

  return (
    <div style={{ ...styles.banner, ...theme.banner }}>
      <div style={styles.bannerContent}>
        <span style={styles.bannerIcon}>{icon}</span>
        <div style={styles.bannerText}>
          <div style={{ ...styles.bannerTitle, color: theme.titleColor }}>
            {title}
          </div>
          <div style={styles.bannerMessage}>{message}</div>
        </div>
      </div>
      {dismissable && (
        <button onClick={onDismiss} style={{ ...styles.dismissBtn, color: theme.titleColor }}>
          ✕
        </button>
      )}
    </div>
  );
}

// ============================================================
// THEMES
// ============================================================

const THEMES = {
  critical: {
    banner: {
      background: 'rgba(239,68,68,0.12)',
      borderColor: '#ef4444',
      borderLeft: '4px solid #ef4444',
    },
    titleColor: '#ef4444',
  },
  warning: {
    banner: {
      background: 'rgba(245,158,11,0.10)',
      borderColor: '#f59e0b',
      borderLeft: '4px solid #f59e0b',
    },
    titleColor: '#f59e0b',
  },
  info: {
    banner: {
      background: 'rgba(59,130,246,0.10)',
      borderColor: '#3b82f6',
      borderLeft: '4px solid #3b82f6',
    },
    titleColor: '#60a5fa',
  },
};

// ============================================================
// STYLES
// ============================================================

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column',
    gap: 0,
    width: '100%',
    zIndex: 999,
  },
  banner: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 20px',
    border: '1px solid',
    borderRadius: 0,
    gap: 12,
  },
  bannerContent: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 12,
    flex: 1,
  },
  bannerIcon: {
    fontSize: 20,
    flexShrink: 0,
    marginTop: 1,
  },
  bannerText: {
    flex: 1,
  },
  bannerTitle: {
    fontWeight: 700,
    fontSize: 14,
    marginBottom: 2,
  },
  bannerMessage: {
    color: '#d1d5db',
    fontSize: 13,
    lineHeight: 1.5,
  },
  dismissBtn: {
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    fontSize: 16,
    padding: '4px 8px',
    borderRadius: 4,
    flexShrink: 0,
    opacity: 0.7,
  },
};



