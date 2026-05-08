import React, { useState, useEffect } from 'react';
import { ChevronRight, ChevronDown, Search, X, TrendingUp } from 'lucide-react';
import { silkApiUrl } from './silkApi';

// ============================================================
// DARKNET MARKET CATEGORY SIDEBAR
// Full hierarchical category tree with product counts
// ============================================================

const DEFAULT_CATEGORIES = [
  { id: "drugs", name: "Drugs", parent: null, icon: "💊" },
  { id: "cannabis", name: "Cannabis", parent: "Drugs", icon: "🌿" },
  { id: "stimulants", name: "Stimulants", parent: "Drugs", icon: "⚡" },
  { id: "psychedelics", name: "Psychedelics", parent: "Drugs", icon: "🍄" },
  { id: "opioids", name: "Opioids", parent: "Drugs", icon: "💉" },
  { id: "benzos", name: "Benzos", parent: "Drugs", icon: "💊" },
  { id: "dissociatives", name: "Dissociatives", parent: "Drugs", icon: "🌀" },
  { id: "empathogens", name: "Empathogens", parent: "Drugs", icon: "❤️" },
  { id: "steroids", name: "Steroids", parent: "Drugs", icon: "💪" },
  { id: "prescription", name: "Prescription", parent: "Drugs", icon: "🏥" },
  { id: "fraud", name: "Fraud", parent: null, icon: "💳" },
  { id: "carding", name: "Carding", parent: "Fraud", icon: "💳" },
  { id: "bank_accounts", name: "Bank Accounts", parent: "Fraud", icon: "🏦" },
  { id: "paypal", name: "PayPal / Cashapp", parent: "Fraud", icon: "💰" },
  { id: "identity", name: "Identity Docs", parent: "Fraud", icon: "🪪" },
  { id: "counterfeit", name: "Counterfeit", parent: "Fraud", icon: "🖨️" },
  { id: "digital", name: "Digital Goods", parent: null, icon: "💻" },
  { id: "accounts", name: "Accounts", parent: "Digital Goods", icon: "🔑" },
  { id: "malware", name: "Malware / RATs", parent: "Digital Goods", icon: "🦠" },
  { id: "exploits", name: "Exploits / 0day", parent: "Digital Goods", icon: "🔓" },
  { id: "ebooks", name: "eBooks / Guides", parent: "Digital Goods", icon: "📚" },
  { id: "software", name: "Software / Keys", parent: "Digital Goods", icon: "🔐" },
  { id: "services", name: "Services", parent: null, icon: "🛠️" },
  { id: "hacking", name: "Hacking", parent: "Services", icon: "💻" },
  { id: "ddos", name: "DDoS", parent: "Services", icon: "⚡" },
  { id: "money_laundering", name: "Money Laundering", parent: "Services", icon: "🧹" },
  { id: "mixing", name: "Crypto Mixing", parent: "Services", icon: "🔄" },
  { id: "escrow_service", name: "Escrow Service", parent: "Services", icon: "🔒" },
  { id: "weapons", name: "Weapons", parent: null, icon: "🔫" },
  { id: "firearms", name: "Firearms", parent: "Weapons", icon: "🔫" },
  { id: "ammo", name: "Ammunition", parent: "Weapons", icon: "🎯" },
  { id: "knives", name: "Knives / Blades", parent: "Weapons", icon: "🔪" },
  { id: "other", name: "Other", parent: null, icon: "📦" },
  { id: "jewelry", name: "Jewelry / Luxury", parent: "Other", icon: "💎" },
  { id: "electronics", name: "Electronics", parent: "Other", icon: "📱" },
];

export default function CategorySidebar({ onSelectCategory, selectedCategory, listings = [] }) {
  const [categories, setCategories] = useState(DEFAULT_CATEGORIES);
  const [expanded, setExpanded] = useState({});
  const [search, setSearch] = useState('');
  const [productCounts, setProductCounts] = useState({});

  // Load categories from API
  useEffect(() => {
    fetch(silkApiUrl('/api/categories'))
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data) && data.length > 0) setCategories(data);
      })
      .catch(() => {});
  }, []);

  // Count products per category
  useEffect(() => {
    const counts = {};
    listings.forEach(item => {
      const cat = item.category;
      if (cat) {
        counts[cat] = (counts[cat] || 0) + 1;
      }
    });
    // Also count parent categories (sum of children)
    categories.forEach(cat => {
      if (!cat.parent) {
        const children = categories.filter(c => c.parent === cat.name);
        const childTotal = children.reduce((sum, c) => sum + (counts[c.name] || 0), 0);
        counts[`__parent_${cat.name}`] = childTotal + (counts[cat.name] || 0);
      }
    });
    setProductCounts(counts);
  }, [listings, categories]);

  // Build tree structure
  const parents = categories.filter(c => !c.parent);
  const getChildren = (parentName) => categories.filter(c => c.parent === parentName);

  const toggleExpand = (catName) => {
    setExpanded(prev => ({ ...prev, [catName]: !prev[catName] }));
  };

  // Auto-expand parent of selected category
  useEffect(() => {
    if (selectedCategory) {
      const cat = categories.find(c => c.name === selectedCategory);
      if (cat?.parent) {
        setExpanded(prev => ({ ...prev, [cat.parent]: true }));
      }
    }
  }, [selectedCategory, categories]);

  // Filter categories by search
  const filteredParents = search
    ? parents.filter(p => {
        const children = getChildren(p.name);
        return p.name.toLowerCase().includes(search.toLowerCase()) ||
          children.some(c => c.name.toLowerCase().includes(search.toLowerCase()));
      })
    : parents;

  const totalProducts = listings.length;

  return (
    <aside style={{
      width: 220,
      minWidth: 220,
      background: 'linear-gradient(180deg, #0d0d1a 0%, #0a0a14 100%)',
      borderRight: '1px solid #1a1a2e',
      height: '100%',
      overflowY: 'auto',
      flexShrink: 0,
      display: 'flex',
      flexDirection: 'column',
    }}>
      {/* Header */}
      <div style={{ padding: '14px 12px 8px', borderBottom: '1px solid #1a1a2e' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
          <span style={{ fontSize: 14, fontWeight: 700, color: '#9b59b6', letterSpacing: 1, textTransform: 'uppercase' }}>
            Categories
          </span>
          <span style={{ fontSize: 10, color: '#555', marginLeft: 'auto' }}>
            {totalProducts} items
          </span>
        </div>
        {/* Search */}
        <div style={{ position: 'relative' }}>
          <Search size={12} style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', color: '#555' }} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Filter..."
            style={{
              width: '100%',
              padding: '5px 24px 5px 26px',
              background: '#111122',
              border: '1px solid #222',
              borderRadius: 6,
              color: '#ccc',
              fontSize: 11,
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
          {search && (
            <button onClick={() => setSearch('')} style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#555', padding: 0 }}>
              <X size={10} />
            </button>
          )}
        </div>
      </div>

      {/* All Products */}
      <button
        onClick={() => onSelectCategory(null)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 12px',
          background: !selectedCategory ? 'rgba(155,89,182,0.15)' : 'transparent',
          border: 'none',
          borderLeft: !selectedCategory ? '2px solid #9b59b6' : '2px solid transparent',
          cursor: 'pointer',
          width: '100%',
          textAlign: 'left',
          transition: 'all 0.15s',
        }}
      >
        <span style={{ fontSize: 14 }}>🏪</span>
        <span style={{ fontSize: 12, color: !selectedCategory ? '#9b59b6' : '#aaa', fontWeight: !selectedCategory ? 700 : 400 }}>
          All Products
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 10, color: '#555', background: '#111', padding: '1px 5px', borderRadius: 8 }}>
          {totalProducts}
        </span>
      </button>

      {/* Trending */}
      <button
        onClick={() => onSelectCategory('__trending')}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 12px',
          background: selectedCategory === '__trending' ? 'rgba(231,76,60,0.15)' : 'transparent',
          border: 'none',
          borderLeft: selectedCategory === '__trending' ? '2px solid #e74c3c' : '2px solid transparent',
          cursor: 'pointer',
          width: '100%',
          textAlign: 'left',
        }}
      >
        <TrendingUp size={13} style={{ color: '#e74c3c' }} />
        <span style={{ fontSize: 12, color: selectedCategory === '__trending' ? '#e74c3c' : '#aaa', fontWeight: selectedCategory === '__trending' ? 700 : 400 }}>
          Trending
        </span>
      </button>

      <div style={{ height: 1, background: '#1a1a2e', margin: '4px 0' }} />

      {/* Category Tree */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
        {filteredParents.map(parent => {
          const children = getChildren(parent.name);
          const isExpanded = expanded[parent.name];
          const isSelected = selectedCategory === parent.name;
          const parentCount = productCounts[`__parent_${parent.name}`] || 0;

          // Filter children by search
          const filteredChildren = search
            ? children.filter(c => c.name.toLowerCase().includes(search.toLowerCase()))
            : children;

          return (
            <div key={parent.id}>
              {/* Parent Category */}
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <button
                  onClick={() => {
                    onSelectCategory(parent.name);
                    if (children.length > 0) toggleExpand(parent.name);
                  }}
                  style={{
                    flex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 7,
                    padding: '7px 12px',
                    background: isSelected ? 'rgba(155,89,182,0.12)' : 'transparent',
                    border: 'none',
                    borderLeft: isSelected ? '2px solid #9b59b6' : '2px solid transparent',
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'all 0.15s',
                  }}
                >
                  <span style={{ fontSize: 13 }}>{parent.icon}</span>
                  <span style={{
                    fontSize: 12,
                    color: isSelected ? '#c39bd3' : '#ccc',
                    fontWeight: isSelected ? 700 : 600,
                    flex: 1,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}>
                    {parent.name}
                  </span>
                  {parentCount > 0 && (
                    <span style={{ fontSize: 9, color: '#555', background: '#111', padding: '1px 4px', borderRadius: 6, flexShrink: 0 }}>
                      {parentCount}
                    </span>
                  )}
                </button>
                {children.length > 0 && (
                  <button
                    onClick={() => toggleExpand(parent.name)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '7px 8px 7px 0', color: '#555' }}
                  >
                    {isExpanded
                      ? <ChevronDown size={12} />
                      : <ChevronRight size={12} />
                    }
                  </button>
                )}
              </div>

              {/* Children */}
              {(isExpanded || search) && filteredChildren.map(child => {
                const isChildSelected = selectedCategory === child.name;
                const childCount = productCounts[child.name] || 0;
                return (
                  <button
                    key={child.id}
                    onClick={() => onSelectCategory(child.name)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '5px 12px 5px 28px',
                      background: isChildSelected ? 'rgba(155,89,182,0.1)' : 'transparent',
                      border: 'none',
                      borderLeft: isChildSelected ? '2px solid #8e44ad' : '2px solid transparent',
                      cursor: 'pointer',
                      width: '100%',
                      textAlign: 'left',
                      transition: 'all 0.15s',
                    }}
                  >
                    <span style={{ fontSize: 11 }}>{child.icon}</span>
                    <span style={{
                      fontSize: 11,
                      color: isChildSelected ? '#c39bd3' : '#888',
                      fontWeight: isChildSelected ? 600 : 400,
                      flex: 1,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}>
                      {child.name}
                    </span>
                    {childCount > 0 && (
                      <span style={{ fontSize: 9, color: '#444', background: '#0d0d1a', padding: '1px 4px', borderRadius: 6, flexShrink: 0 }}>
                        {childCount}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div style={{ padding: '8px 12px', borderTop: '1px solid #1a1a2e' }}>
        <div style={{ fontSize: 9, color: '#333', textAlign: 'center', letterSpacing: 1 }}>
          SILKGENESIS v2.0
        </div>
      </div>
    </aside>
  );
}
