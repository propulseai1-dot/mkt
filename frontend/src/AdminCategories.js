import React, { useState, useEffect } from 'react';
import { Plus, Trash2, Edit3, ChevronRight, Save, X, AlertTriangle, CheckCircle } from 'lucide-react';
import { silkApiUrl } from './silkApi';

// ============================================================
// ADMIN CATEGORIES MANAGER
// Full CRUD for parent/child categories
// ============================================================

const ICONS = ['📦','💊','🌿','⚡','🍄','💉','🌀','❤️','💪','🏥','💳','🏦','💰','🪪','🖨️','💻','🔑','🦠','🔓','📚','🔐','🛠️','🧹','🔄','🔒','🔫','🎯','🔪','💎','📱','🌍','🎭','🎪','🎨','🎬','🎮','🎲','🎯','🏆','🥇','🥈','🥉','🎖️','🏅','🎗️','🎫','🎟️','🎪'];

export default function AdminCategories({ user, sessionToken: sessionTokenProp }) {
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [editCat, setEditCat] = useState(null);

  const bearerHeaders = (extra = {}) => {
    let t = sessionTokenProp;
    if (!t) {
      try {
        const raw = localStorage.getItem('silkGenesis_session');
        if (raw) t = JSON.parse(raw).session_token || '';
      } catch {}
    }
    const h = { 'Content-Type': 'application/json', ...extra };
    if (t) h.Authorization = `Bearer ${t}`;
    return h;
  };

  // Form state
  const [newName, setNewName] = useState('');
  const [newIcon, setNewIcon] = useState('📦');
  const [newParent, setNewParent] = useState('');
  const [showIconPicker, setShowIconPicker] = useState(false);

  const showMsg = (text, type = 'success') => {
    setMsg({ text, type });
    setTimeout(() => setMsg(null), 3000);
  };

  const loadCategories = () => {
    setLoading(true);
    fetch(silkApiUrl('/api/categories'))
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data)) setCategories(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffect(() => { loadCategories(); }, []);

  const parents = categories.filter(c => !c.parent);
  const getChildren = (parentName) => categories.filter(c => c.parent === parentName);

  const addCategory = async () => {
    if (!newName.trim()) return showMsg('Name is required', 'error');
    try {
      const r = await fetch(silkApiUrl('/api/admin/categories'), {
        method: 'POST',
        headers: bearerHeaders(),
        body: JSON.stringify({
          name: newName.trim(),
          icon: newIcon,
          parent: newParent || null,
          admin: user?.username
        })
      });
      const data = await r.json();
      if (r.ok) {
        showMsg(`Category "${newName}" added!`);
        setNewName(''); setNewIcon('📦'); setNewParent(''); setShowAdd(false);
        loadCategories();
      } else {
        showMsg(data.detail || 'Error adding category', 'error');
      }
    } catch (e) {
      showMsg('Network error', 'error');
    }
  };

  const deleteCategory = async (catName) => {
    if (!window.confirm(`Delete "${catName}" and all its subcategories?`)) return;
    try {
      const r = await fetch(silkApiUrl(`/api/admin/categories/${encodeURIComponent(catName)}`), {
        method: 'DELETE',
        headers: bearerHeaders(),
      });
      if (r.ok) {
        showMsg(`"${catName}" deleted`);
        loadCategories();
      } else {
        showMsg('Error deleting', 'error');
      }
    } catch (e) {
      showMsg('Network error', 'error');
    }
  };

  const updateCategory = async (oldName, newData) => {
    try {
      const r = await fetch(silkApiUrl(`/api/admin/categories/${encodeURIComponent(oldName)}`), {
        method: 'PUT',
        headers: bearerHeaders(),
        body: JSON.stringify(newData),
      });
      if (r.ok) {
        showMsg('Category updated!');
        setEditCat(null);
        loadCategories();
      } else {
        showMsg('Error updating', 'error');
      }
    } catch (e) {
      showMsg('Network error', 'error');
    }
  };

  const s = {
    container: { padding: 24, maxWidth: 900, margin: '0 auto' },
    header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 },
    title: { fontSize: 20, fontWeight: 700, color: '#9b59b6' },
    addBtn: { display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', background: '#9b59b6', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600 },
    card: { background: '#0d0d1a', border: '1px solid #1a1a2e', borderRadius: 10, marginBottom: 8, overflow: 'hidden' },
    parentRow: { display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', background: '#111122' },
    childRow: { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 16px 8px 36px', borderTop: '1px solid #0d0d1a' },
    iconBtn: { background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, padding: 0 },
    name: { flex: 1, fontSize: 14, color: '#ddd', fontWeight: 600 },
    childName: { flex: 1, fontSize: 13, color: '#aaa' },
    badge: { fontSize: 10, color: '#555', background: '#0a0a14', padding: '2px 6px', borderRadius: 10 },
    actionBtn: { background: 'none', border: 'none', cursor: 'pointer', padding: '4px 6px', borderRadius: 4, color: '#555', transition: 'color 0.15s' },
    form: { background: '#111122', border: '1px solid #9b59b6', borderRadius: 10, padding: 20, marginBottom: 16 },
    input: { width: '100%', padding: '8px 12px', background: '#0d0d1a', border: '1px solid #222', borderRadius: 6, color: '#fff', fontSize: 13, outline: 'none', boxSizing: 'border-box' },
    select: { width: '100%', padding: '8px 12px', background: '#0d0d1a', border: '1px solid #222', borderRadius: 6, color: '#fff', fontSize: 13, outline: 'none', boxSizing: 'border-box' },
    label: { fontSize: 11, color: '#888', marginBottom: 4, display: 'block', textTransform: 'uppercase', letterSpacing: 0.5 },
    saveBtn: { padding: '8px 20px', background: '#27ae60', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600 },
    cancelBtn: { padding: '8px 16px', background: '#333', color: '#aaa', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13 },
  };

  return (
    <div style={s.container}>
      {/* Header */}
      <div style={s.header}>
        <div>
          <div style={s.title}>🗂️ Category Management</div>
          <div style={{ fontSize: 12, color: '#555', marginTop: 2 }}>
            {categories.length} categories ({parents.length} parent, {categories.length - parents.length} subcategories)
          </div>
        </div>
        <button style={s.addBtn} onClick={() => { setShowAdd(!showAdd); setEditCat(null); }}>
          <Plus size={14} /> Add Category
        </button>
      </div>

      {/* Message */}
      {msg && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px',
          background: msg.type === 'error' ? 'rgba(231,76,60,0.15)' : 'rgba(39,174,96,0.15)',
          border: `1px solid ${msg.type === 'error' ? '#e74c3c' : '#27ae60'}`,
          borderRadius: 8, marginBottom: 16, fontSize: 13,
          color: msg.type === 'error' ? '#e74c3c' : '#27ae60'
        }}>
          {msg.type === 'error' ? <AlertTriangle size={14} /> : <CheckCircle size={14} />}
          {msg.text}
        </div>
      )}

      {/* Add Form */}
      {showAdd && (
        <div style={s.form}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#9b59b6', marginBottom: 16 }}>
            ➕ New Category
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 80px', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={s.label}>Name *</label>
              <input
                style={s.input}
                value={newName}
                onChange={e => setNewName(e.target.value)}
                placeholder="e.g. Psychedelics"
                onKeyDown={e => e.key === 'Enter' && addCategory()}
              />
            </div>
            <div>
              <label style={s.label}>Parent (optional)</label>
              <select style={s.select} value={newParent} onChange={e => setNewParent(e.target.value)}>
                <option value="">— Root Category —</option>
                {parents.map(p => (
                  <option key={p.id} value={p.name}>{p.icon} {p.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={s.label}>Icon</label>
              <button
                style={{ ...s.input, cursor: 'pointer', textAlign: 'center', fontSize: 20, padding: '4px' }}
                onClick={() => setShowIconPicker(!showIconPicker)}
              >
                {newIcon}
              </button>
            </div>
          </div>
          {showIconPicker && (
            <div style={{ background: '#0d0d1a', border: '1px solid #222', borderRadius: 8, padding: 12, marginBottom: 12, display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 120, overflowY: 'auto' }}>
              {ICONS.map(icon => (
                <button key={icon} onClick={() => { setNewIcon(icon); setShowIconPicker(false); }}
                  style={{ background: newIcon === icon ? '#9b59b6' : 'transparent', border: 'none', cursor: 'pointer', fontSize: 18, padding: '4px 6px', borderRadius: 4 }}>
                  {icon}
                </button>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={s.saveBtn} onClick={addCategory}>
              <Save size={13} style={{ display: 'inline', marginRight: 4 }} /> Save
            </button>
            <button style={s.cancelBtn} onClick={() => { setShowAdd(false); setNewName(''); setNewParent(''); }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Category Tree */}
      {loading ? (
        <div style={{ textAlign: 'center', color: '#555', padding: 40 }}>Loading...</div>
      ) : (
        <div>
          {parents.map(parent => {
            const children = getChildren(parent.name);
            const isEditing = editCat?.name === parent.name;

            return (
              <div key={parent.id} style={s.card}>
                {/* Parent Row */}
                <div style={s.parentRow}>
                  <span style={{ fontSize: 18 }}>{parent.icon}</span>
                  {isEditing ? (
                    <EditForm
                      cat={parent}
                      parents={[]}
                      onSave={(data) => updateCategory(parent.name, data)}
                      onCancel={() => setEditCat(null)}
                    />
                  ) : (
                    <>
                      <span style={s.name}>{parent.name}</span>
                      <span style={s.badge}>{children.length} sub</span>
                      <button style={s.actionBtn} onClick={() => setEditCat(parent)} title="Edit">
                        <Edit3 size={13} />
                      </button>
                      <button style={{ ...s.actionBtn, color: '#e74c3c' }} onClick={() => deleteCategory(parent.name)} title="Delete">
                        <Trash2 size={13} />
                      </button>
                    </>
                  )}
                </div>

                {/* Children */}
                {children.map(child => {
                  const isEditingChild = editCat?.name === child.name;
                  return (
                    <div key={child.id} style={s.childRow}>
                      <ChevronRight size={10} style={{ color: '#444', flexShrink: 0 }} />
                      <span style={{ fontSize: 14 }}>{child.icon}</span>
                      {isEditingChild ? (
                        <EditForm
                          cat={child}
                          parents={parents}
                          onSave={(data) => updateCategory(child.name, data)}
                          onCancel={() => setEditCat(null)}
                        />
                      ) : (
                        <>
                          <span style={s.childName}>{child.name}</span>
                          <button style={s.actionBtn} onClick={() => setEditCat(child)} title="Edit">
                            <Edit3 size={12} />
                          </button>
                          <button style={{ ...s.actionBtn, color: '#e74c3c' }} onClick={() => deleteCategory(child.name)} title="Delete">
                            <Trash2 size={12} />
                          </button>
                        </>
                      )}
                    </div>
                  );
                })}

                {/* Add subcategory shortcut */}
                <button
                  onClick={() => { setShowAdd(true); setNewParent(parent.name); setEditCat(null); window.scrollTo(0, 0); }}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 16px 6px 36px', background: 'none', border: 'none', cursor: 'pointer', color: '#555', fontSize: 11, width: '100%', borderTop: '1px solid #0d0d1a' }}
                >
                  <Plus size={10} /> Add subcategory to {parent.name}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function EditForm({ cat, parents, onSave, onCancel }) {
  const [name, setName] = useState(cat.name);
  const [icon, setIcon] = useState(cat.icon || '📦');
  const [showPicker, setShowPicker] = useState(false);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
      <button onClick={() => setShowPicker(!showPicker)} style={{ background: 'none', border: '1px solid #333', borderRadius: 4, cursor: 'pointer', fontSize: 16, padding: '2px 6px' }}>
        {icon}
      </button>
      {showPicker && (
        <div style={{ position: 'absolute', zIndex: 100, background: '#111', border: '1px solid #333', borderRadius: 8, padding: 8, display: 'flex', flexWrap: 'wrap', gap: 4, maxWidth: 200 }}>
          {ICONS.map(i => (
            <button key={i} onClick={() => { setIcon(i); setShowPicker(false); }}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, padding: 2 }}>{i}</button>
          ))}
        </div>
      )}
      <input
        value={name}
        onChange={e => setName(e.target.value)}
        style={{ flex: 1, padding: '4px 8px', background: '#0d0d1a', border: '1px solid #9b59b6', borderRadius: 4, color: '#fff', fontSize: 13, outline: 'none' }}
        onKeyDown={e => e.key === 'Enter' && onSave({ name, icon })}
      />
      <button onClick={() => onSave({ name, icon })} style={{ background: '#27ae60', border: 'none', borderRadius: 4, cursor: 'pointer', color: '#fff', padding: '4px 8px' }}>
        <Save size={12} />
      </button>
      <button onClick={onCancel} style={{ background: '#333', border: 'none', borderRadius: 4, cursor: 'pointer', color: '#aaa', padding: '4px 8px' }}>
        <X size={12} />
      </button>
    </div>
  );
}
