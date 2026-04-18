import React, { useState, useEffect, useCallback } from 'react';
import { 
  ShieldCheck, RefreshCw, Clock, MessageSquare, Package, Settings, Home, 
  PlusCircle, AlertTriangle, Hourglass, User as UserIcon, Shield, 
  ChevronRight, ChevronDown, Camera, Fingerprint, Terminal, Activity, 
  Layers, Trash2, CheckCircle, XCircle, Ban, Zap, Send, ShieldAlert, 
  Unlock, Power, UserPlus, DollarSign, Image as ImageIcon, UserMinus, Copy,
  Gavel, Scale
} from 'lucide-react';
import Logo from './Silk_logo.png'; 

// --- 1. COMPOSANT CAPTCHA HORLOGE ---
function ClockCaptcha({ isOpen, onClose, onVerify }) {
  const [targetTime, setTargetTime] = useState({ h: 0, m: 0 });
  const [hourInput, setHourInput] = useState('');
  const [minInput, setMinInput] = useState('');
  const [timeLeft, setTimeLeft] = useState(30);
  const [isExpired, setIsExpired] = useState(false);
  
  const generateRandomTime = useCallback(() => {
    const h = Math.floor(Math.random() * 12) || 12;
    const m = Math.floor(Math.random() * 60);
    setTargetTime({ h, m }); 
    setHourInput(''); 
    setMinInput('');
    setTimeLeft(30); 
    setIsExpired(false);
  }, []);

  useEffect(() => {
    let timer;
    if (isOpen && timeLeft > 0 && !isExpired) {
      timer = setTimeout(() => setTimeLeft(timeLeft - 1), 1000);
    } else if (timeLeft === 0) {
      setIsExpired(true);
    }
    return () => clearTimeout(timer);
  }, [isOpen, timeLeft, isExpired]);

  useEffect(() => { if (isOpen) generateRandomTime(); }, [isOpen, generateRandomTime]);

  if (!isOpen) return null;

  const verify = () => {
    if (isExpired) return;
    if (parseInt(hourInput) === targetTime.h && parseInt(minInput) === targetTime.m) {
      onVerify(btoa(`VALID_CLOCK_${hourInput}:${minInput}_${Date.now()}`));
      onClose();
    } else { 
      alert("VERIFICATION FAILED"); 
      generateRandomTime(); 
    }
  };

  const hourDeg = (targetTime.h * 30) + (targetTime.m * 0.5);
  const minDeg = targetTime.m * 6;

  return (
    <div className="fixed inset-0 z-[100] bg-black/98 backdrop-blur-2xl flex items-center justify-center p-4 font-mono text-center">
      <div className="bg-[#0a0a0a] border border-amber-900/60 p-8 rounded-lg w-[400px] shadow-2xl relative">
        <div className="flex justify-between items-center mb-6 border-b border-amber-900/30 pb-3 text-amber-500 font-black uppercase text-[11px]">
          <div className="flex items-center gap-2 tracking-widest">
            <Shield size={16} className={!isExpired ? "animate-pulse" : ""} />
            <span>Biometric Clock Sync</span>
          </div>
          <div>00:{timeLeft.toString().padStart(2, '0')}</div>
        </div>
        {!isExpired ? (
          <>
            <div className="relative w-40 h-40 mx-auto mb-10 border-4 border-amber-600/40 rounded-full bg-black">
               {[...Array(60)].map((_, i) => (
                 <div key={i} className="absolute inset-0 flex justify-center" style={{ transform: `rotate(${i * 6}deg)` }}>
                   <div className={`w-[1px] ${i % 5 === 0 ? 'h-3 bg-amber-500' : 'h-1 bg-gray-600'}`}></div>
                 </div>
               ))}
               <div className="absolute inset-0 flex justify-center items-center" style={{ transform: `rotate(${hourDeg}deg)` }}>
                 <div className="w-1.5 h-12 bg-amber-600 rounded-full -translate-y-6 shadow-lg"></div>
               </div>
               <div className="absolute inset-0 flex justify-center items-center" style={{ transform: `rotate(${minDeg}deg)` }}>
                 <div className="w-1 h-16 bg-white rounded-full -translate-y-8 shadow-lg"></div>
               </div>
            </div>
            <div className="flex items-center justify-center gap-3 mb-6">
              <input type="text" maxLength="2" placeholder="00" value={hourInput} onChange={(e) => setHourInput(e.target.value.replace(/\D/g, ''))} className="w-16 bg-black border border-amber-900/50 p-3 rounded text-center text-2xl text-amber-500 font-black outline-none" />
              <span className="text-2xl text-amber-500 font-black animate-pulse">:</span>
              <input type="text" maxLength="2" placeholder="00" value={minInput} onChange={(e) => setMinInput(e.target.value.replace(/\D/g, ''))} className="w-16 bg-black border border-amber-900/50 p-3 rounded text-center text-2xl text-amber-500 font-black outline-none" />
            </div>
            <button onClick={verify} className="w-full py-4 bg-amber-600 text-black text-[12px] font-black uppercase hover:bg-amber-400">Confirm Sequence</button>
          </>
        ) : (
          <button onClick={generateRandomTime} className="w-full py-4 text-amber-500 border border-amber-900/40 uppercase text-[11px] font-black">Retry</button>
        )}
      </div>
    </div>
  );
}

// --- 2. PAGE DE PROFIL ---
function ProfilePage({ user, balance, xmrRate, onUpdateAvatar, onUpgrade, onDelete, onWithdraw }) {
  const [tempImg, setTempImg] = useState(user?.avatar || null);
  const [wAddr, setWAddr] = useState('');
  const [wAmt, setWAmt] = useState('');

  const handleAvatarChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setTempImg(reader.result);
        onUpdateAvatar(reader.result);
      };
      reader.readAsDataURL(file);
    }
  };

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 font-mono uppercase italic font-black space-y-6">
      <div className="bg-[#111] border border-amber-900/20 rounded-3xl overflow-hidden shadow-2xl">
        <div className="bg-gradient-to-r from-amber-900/20 to-transparent p-10 border-b border-amber-900/10 flex items-end gap-8">
          <div className="relative group">
            <div className="w-28 h-28 bg-black border-2 border-amber-600/30 rounded-2xl flex items-center justify-center text-amber-600 font-black text-4xl shadow-xl overflow-hidden">
              {tempImg ? <img src={tempImg} className="w-full h-full object-cover" alt="Avatar" /> : (user?.username ? user.username[0].toUpperCase() : '?')}
            </div>
            <label className="absolute inset-0 bg-black/60 flex items-center justify-center opacity-0 group-hover:opacity-100 cursor-pointer transition-all rounded-2xl">
                <Camera size={24} className="text-amber-500" />
                <input type="file" className="hidden" accept="image/*" onChange={handleAvatarChange} />
            </label>
          </div>
          <div className="flex-1">
            <h2 className="text-5xl font-black text-white tracking-tighter">{user?.username}</h2>
            <p className="text-amber-500 text-[12px] tracking-[0.4em] mt-2 flex items-center gap-2"><Shield size={14}/> Node Identifier Secured</p>
          </div>
          {user?.role === 'buyer' && (
             <button onClick={onUpgrade} className="bg-amber-600 text-black px-6 py-3 rounded-xl text-[11px] hover:bg-amber-400 transition-all flex items-center gap-2 shadow-xl">
               <Zap size={14}/> Become a Seller ($200)
             </button>
          )}
        </div>
        <div className="grid grid-cols-3 gap-1 p-1 bg-amber-900/10 text-center">
          <div className="bg-[#0a0a0a] p-10"><p className="text-[11px] text-gray-500 mb-2">Trust Level</p><p className="text-2xl text-green-500 italic">99.8%</p></div>
          <div className="bg-[#0a0a0a] p-10"><p className="text-[11px] text-gray-500 mb-2">Records</p><p className="text-2xl text-white italic">{user?.pos || 142}</p></div>
          <div className="bg-[#0a0a0a] p-10"><p className="text-[11px] text-gray-500 mb-2">Vault Value</p><p className="text-2xl text-amber-500 italic">${(balance * xmrRate).toFixed(2)}</p></div>
        </div>
      </div>

      <div className="bg-[#111] border border-amber-900/20 rounded-3xl p-8 shadow-2xl">
        <h3 className="text-amber-500 mb-6 flex items-center gap-2"><DollarSign size={20}/> Cryptographic Deposit Node</h3>
        <div className="space-y-4">
          <p className="text-[10px] text-gray-500 italic">Your unique network address for incoming XMR:</p>
          <div className="bg-black p-4 rounded-xl border border-white/5 flex items-center justify-between group">
            <code className="text-[11px] text-amber-600 break-all font-mono">{user?.xmr_address || "GENERATING..."}</code>
            <button onClick={() => {navigator.clipboard.writeText(user?.xmr_address); alert("COPIED");}} className="ml-4 p-2 bg-amber-900/20 text-amber-500 rounded hover:bg-amber-600 hover:text-black transition-all"><Copy size={14}/></button>
          </div>
        </div>
      </div>

      <div className="bg-[#111] border border-red-900/20 rounded-3xl p-8 shadow-2xl">
        <h3 className="text-red-500 mb-6 flex items-center gap-2"><Power size={20}/> Outbound Fund Transfer</h3>
        <div className="space-y-4">
          <input type="text" placeholder="EXTERNAL XMR ADDRESS" value={wAddr} onChange={e=>setWAddr(e.target.value)} className="w-full bg-black border border-white/10 p-4 rounded-xl text-[11px] text-amber-500 outline-none font-mono" />
          <div className="flex gap-4">
            <input type="number" placeholder="AMOUNT" value={wAmt} onChange={e=>setWAmt(e.target.value)} className="flex-1 bg-black border border-white/10 p-4 rounded-xl text-[11px] text-amber-500 font-mono" />
            <button onClick={() => onWithdraw(wAddr, parseFloat(wAmt))} className="bg-red-600 text-black px-8 rounded-xl font-black uppercase text-[11px] hover:bg-red-500">Execute</button>
          </div>
        </div>
      </div>

      <div className="flex justify-end">
          <button onClick={onDelete} className="flex items-center gap-2 text-red-900 hover:text-red-500 text-[10px] tracking-widest transition-all p-2 border border-red-900/20 rounded-lg bg-red-900/5">
            <UserMinus size={14}/> Purge Identity (Permanent Delete)
          </button>
      </div>
    </div>
  );
}

// --- 3. PAGE DE CONNEXION ---
function LoginPage({ onLogin, onRegister }) {
  const [isRegister, setIsRegister] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [captchaToken, setCaptchaToken] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!captchaToken) return;
    if (isRegister) {
      const success = await onRegister(username, password, captchaToken);
      if (success) setIsRegister(false);
    } else {
      onLogin(username, password, captchaToken);
    }
  };

  return (
    <div className="min-h-screen bg-[#050505] flex items-center justify-center p-4 font-mono relative uppercase italic font-black text-center">
      <div className="w-full max-w-lg bg-[#0d0d0d] border border-amber-900/30 p-12 rounded-3xl shadow-2xl">
        <div className="text-center mb-10">
          <img src={Logo} alt="SilkGenesis" className="h-16 mx-auto mb-8" />
          <p className="text-[10px] text-amber-900 tracking-[0.7em] border-t border-amber-900/20 pt-5 uppercase">
            {isRegister ? "Fabricate New Identity" : "Authentication Gateway"}
          </p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-6">
          <input type="text" placeholder="USER ID" className="w-full bg-black border-2 border-white/5 p-5 rounded-2xl text-amber-500 outline-none text-lg font-black placeholder:text-amber-900/20" onChange={(e) => setUsername(e.target.value)} />
          <input type="password" placeholder="PASSPHRASE" className="w-full bg-black border-2 border-white/5 p-5 rounded-2xl text-amber-500 outline-none text-lg font-black placeholder:text-amber-900/20" onChange={(e) => setPassword(e.target.value)} />
          <div className="bg-black border border-amber-900/20 p-6 rounded-2xl text-center space-y-4 shadow-inner">
             {!captchaToken ? (
               <button type="button" onClick={() => setIsModalOpen(true)} className="w-full py-3.5 border-2 border-amber-900/40 text-amber-800 text-[10px] uppercase hover:bg-amber-900/10 flex items-center justify-center gap-3 rounded-xl"><Fingerprint size={18}/> Run integrity check</button>
             ) : (
               <div className="flex items-center justify-center gap-3 text-green-500 font-black text-[11px] py-2 animate-pulse uppercase"><ShieldCheck size={20} /><span>GATEWAY ACCESS CONFIRMED</span></div>
             )}
          </div>
          <ClockCaptcha isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} onVerify={setCaptchaToken} />
          <button type="submit" disabled={!captchaToken} className={`w-full py-5 rounded-2xl tracking-[0.4em] text-[13px] font-black transition-all ${captchaToken ? 'bg-amber-600 text-black hover:bg-amber-500 shadow-xl' : 'bg-gray-900 text-gray-800'}`}>
            {isRegister ? "Fabricate Identity" : "Initialize Access"}
          </button>
          <p className="text-[10px] text-gray-600 mt-4 cursor-pointer hover:text-amber-500 transition-colors uppercase" onClick={() => {setIsRegister(!isRegister); setCaptchaToken(null);}}>
            {isRegister ? "Already in network? Login" : "No node found? Register"}
          </p>
        </form>
      </div>
    </div>
  );
}

// --- 4. APPLICATION PRINCIPALE ---
function App() {
  const [user, setUser] = useState(null);
  const [activeTab, setActiveTab] = useState('home');
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [balance, setBalance] = useState(0); 
  const [products, setProducts] = useState([]); 
  const [categories, setCategories] = useState([]);
  const [allUsers, setAllUsers] = useState([]); 
  const [sellerRequests, setSellerRequests] = useState([]);
  const [disputes, setDisputes] = useState([]); // Litiges
  const [expandedCats, setExpandedCats] = useState({"Drugs": true});
  const [xmrRate, setXmrRate] = useState(165.0);

  // States Admin / Vendor
  const [newTitle, setNewTitle] = useState('');
  const [newPriceUsd, setNewPriceUsd] = useState('');
  const [newCat, setNewCat] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newImage, setNewImage] = useState(null);
  const [adminNewUser, setAdminNewUser] = useState('');
  const [adminNewPass, setAdminNewPass] = useState('');
  const [adminNewRole, setAdminNewRole] = useState('buyer');
  const [newCatName, setNewCatName] = useState('');
  const [newCatParent, setNewCatParent] = useState('');

  const loadData = async () => {
    try {
        const [pRes, cRes, uRes, reqRes, disRes] = await Promise.all([
            fetch('http://127.0.0.1:8000/api/listings'),
            fetch('http://127.0.0.1:8000/api/categories'),
            fetch('http://127.0.0.1:8000/api/admin/users'),
            fetch('http://127.0.0.1:8000/api/admin/seller-requests'),
            fetch('http://127.0.0.1:8000/api/admin/disputes')
        ]);
        
        if (pRes.ok) {
          const pData = await pRes.json();
          setProducts(pData.items || []);
          setXmrRate(pData.rate || 165.0);
        }
        if (cRes.ok) {
          const cData = await cRes.json();
          setCategories(Array.isArray(cData) ? cData : []);
          if (Array.isArray(cData) && cData.length > 0 && !newCat) setNewCat(cData[0].name);
        }
        if (uRes.ok) setAllUsers(await uRes.json() || []);
        if (reqRes.ok) setSellerRequests(await reqRes.json() || []);
        if (disRes.ok) setDisputes(await disRes.json() || []);
    } catch (err) { console.error("Backend Offline"); }
  };

  useEffect(() => {
    const saved = localStorage.getItem('silkGenesis_session');
    if (saved) {
      const data = JSON.parse(saved);
      setUser(data.user); 
      setBalance(data.user.balance); 
      loadData();
    }
  }, []);

  useEffect(() => {
    if (user) {
      const interval = setInterval(loadData, 10000);
      return () => clearInterval(interval);
    }
  }, [user]);

  const handleAction = async (url, body) => {
    try {
      const res = await fetch(`http://127.0.0.1:8000${url}`, { 
          method: 'POST', 
          headers: { 'Content-Type': 'application/json' }, 
          body: JSON.stringify(body) 
      });
      if (res.ok) {
        await loadData();
        return true;
      } else {
        const err = await res.json();
        alert(`ERROR: ${err.detail}`);
        return false;
      }
    } catch (e) {
      alert("SERVER ERROR");
      return false;
    }
  };

  const handleWithdraw = async (address, amount) => {
    if (amount > balance) return alert("INSUFFICIENT FUNDS");
    await handleAction('/api/user/withdraw', { username: user.username, address, amount });
    alert("TRANSFER BROADCASTED");
  };

  const deleteAccount = async () => {
    if (window.confirm("PERMANENT PURGE? Irreversible identity deletion.")) {
        await handleAction('/api/user/delete-account', { username: user.username });
        localStorage.removeItem('silkGenesis_session');
        setUser(null);
    }
  };

  const handleAddProduct = async (e) => {
    e.preventDefault();
    const xmrValue = parseFloat(newPriceUsd) / xmrRate;
    const ok = await handleAction('/api/listings', { title: newTitle, price_xmr: xmrValue, category: newCat, description: newDesc, vendor: user.username, image: newImage });
    if(ok) {
        alert("TRANSMISSION SUCCESS"); 
        setNewTitle(''); 
        setActiveTab('home');
    }
  };

  const handleLogin = async (username, password, token) => {
    const res = await fetch('http://127.0.0.1:8000/api/login', { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ username, password, pow_solution: token }) 
    });
    const data = await res.json();
    if (res.ok) { 
        localStorage.setItem('silkGenesis_session', JSON.stringify(data));
        setUser(data.user); 
        setBalance(data.user.balance); 
        loadData(); 
    } else { alert(data.detail || "Access Denied"); }
  };

  const handleRegister = async (username, password, token) => {
    const res = await fetch('http://127.0.0.1:8000/api/register', { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ username, password, pow_solution: token }) 
    });
    if (res.ok) { 
        alert("IDENTITY FABRICATED. LOGIN NOW."); 
        return true; 
    } else { 
        const d = await res.json(); alert(d.detail); 
        return false; 
    }
  };

  if (!user) return <LoginPage onLogin={handleLogin} onRegister={handleRegister} />;

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-gray-300 font-sans uppercase italic font-black">
      {/* HEADER */}
      <header className="sticky top-0 z-50 bg-[#111111]/95 border-b border-amber-900/40 p-4 shadow-2xl backdrop-blur-md">
        <div className="max-w-[1400px] mx-auto flex justify-between items-center px-4">
          <div className="w-[200px]">
            <img src={Logo} alt="SilkGenesis" className="h-10 cursor-pointer hover:scale-105 transition-all" onClick={() => setActiveTab('home')} />
          </div>
          
          <div className="flex items-center gap-6 font-mono text-amber-500">
              <div className="text-right border-r border-amber-900/20 pr-6">
                <p className="text-[9px] text-gray-500 uppercase">Secure Vault</p>
                <p className="text-lg tracking-tighter">{balance.toFixed(4)} XMR</p>
              </div>
              <div className={`px-4 py-1 rounded border shadow-lg text-[10px] ${user.role === 'admin' ? 'border-red-600 text-red-600' : user.role === 'vendor' ? 'border-purple-500 text-purple-500' : 'border-blue-500 text-blue-500'}`}>
                {user.role === 'admin' ? 'COMMAND' : user.role === 'vendor' ? 'VENDOR' : 'BUYER'}
              </div>
              <button onClick={() => {localStorage.removeItem('silkGenesis_session'); setUser(null);}} className="bg-amber-900/10 border border-amber-600 px-4 py-1.5 rounded hover:bg-amber-600 transition-all font-black text-[10px]">Logout</button>
          </div>
        </div>
      </header>

      {/* MAIN LAYOUT */}
      <div className="max-w-[1400px] mx-auto grid grid-cols-[250px_1fr] gap-8 p-6 font-mono">
        <aside className="space-y-5">
          <div className="border border-white/5 bg-white/[0.02] rounded-xl p-4 space-y-2 text-xs">
            <li onClick={() => setActiveTab('home')} className={`p-2.5 rounded-lg cursor-pointer list-none flex items-center transition-all ${activeTab === 'home' ? 'text-amber-500 bg-amber-900/10 border-l-4 border-amber-600' : 'hover:bg-white/5'}`}><Home className="mr-3" size={16}/> Market</li>
            <li onClick={() => setActiveTab('chat')} className={`p-2.5 rounded-lg cursor-pointer list-none flex items-center transition-all ${activeTab === 'chat' ? 'text-amber-500 bg-amber-900/10 border-l-4 border-amber-600' : 'hover:bg-white/5'}`}><MessageSquare className="mr-3" size={16}/> Chat</li>
            {user.role === 'admin' && <li onClick={() => setActiveTab('admin_panel')} className={`p-2.5 rounded-lg cursor-pointer list-none flex items-center border border-red-900/20 transition-all ${activeTab === 'admin_panel' ? 'bg-red-900/20 text-red-500 border-l-4 border-red-600' : 'hover:bg-red-900/5'}`}><Terminal className="mr-3" size={16}/> Control</li>}
            {user.role === 'vendor' && <li onClick={() => setActiveTab('vendor_panel')} className={`p-2.5 rounded-lg cursor-pointer list-none flex items-center border border-purple-900/20 transition-all ${activeTab === 'vendor_panel' ? 'bg-purple-900/20 text-purple-500 border-l-4 border-purple-600' : 'hover:bg-purple-900/5'}`}><PlusCircle className="mr-3" size={16}/> Selling</li>}
            <li onClick={() => setActiveTab('profile')} className={`p-2.5 rounded-lg cursor-pointer list-none flex items-center transition-all ${activeTab === 'profile' ? 'text-amber-500 bg-amber-900/10 border-l-4 border-amber-600' : 'hover:bg-white/5'}`}><UserIcon className="mr-3" size={16}/> Identity</li>
          </div>
          
          <div className="p-1">
            <h3 className="text-[10px] text-gray-600 mb-4 ml-2 tracking-[0.2em] border-b border-white/5 pb-2 uppercase">Browser</h3>
            {categories.filter(c => !c.parent).map(cat => (
              <div key={cat.name}>
                <div onClick={() => { setExpandedCats(prev => ({...prev, [cat.name]: !prev[cat.name]})); setSelectedCategory(cat.name); setActiveTab('home'); }} className={`text-[12px] px-3 py-2 rounded flex items-center justify-between hover:text-amber-500 transition-all cursor-pointer ${selectedCategory === cat.name ? 'text-amber-500 bg-amber-900/5' : 'text-gray-500'}`}>
                  <span>{cat.name}</span>
                  {categories.some(c => c.parent === cat.name) && (expandedCats[cat.name] ? <ChevronDown size={12}/> : <ChevronRight size={12}/>)}
                </div>
                {expandedCats[cat.name] && <div className="ml-4 border-l border-amber-900/10 mt-1">
                  {categories.filter(c => c.parent === cat.name).map(sub => (
                    <div key={sub.name} onClick={() => {setSelectedCategory(sub.name); setActiveTab('home');}} className={`text-[11px] pl-5 py-1.5 cursor-pointer hover:text-amber-400 transition-all ${selectedCategory === sub.name ? 'text-amber-600 border-r-2 border-amber-600' : 'text-gray-600'}`}>{sub.name}</div>
                  ))}
                </div>}
              </div>
            ))}
          </div>
        </aside>

        <main>
          {activeTab === 'home' && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 animate-in fade-in">
              {products.filter(p => selectedCategory === "All" || p.category === selectedCategory).map(p => (
                <div key={p.id} className="bg-[#111] border border-white/5 p-4 rounded-xl hover:border-amber-900/30 transition-all cursor-pointer group shadow-xl">
                  <div className="h-44 bg-black rounded-lg mb-4 overflow-hidden">
                    {p.image ? <img src={p.image} className="w-full h-full object-cover group-hover:scale-105 transition-all" alt="" /> : <span className="flex items-center justify-center h-full text-[9px] text-gray-800 uppercase italic">No Signal</span>}
                  </div>
                  <h4 className="text-lg text-white group-hover:text-amber-500 transition-colors truncate">{p.title}</h4>
                  <div className="mt-5 flex justify-between items-end border-t border-white/5 pt-4">
                    <p className="text-xl text-amber-500 tracking-tighter italic">{parseFloat(p.price_xmr).toFixed(4)} XMR</p>
                    <button className="bg-amber-900/5 border border-amber-900/20 px-4 py-1.5 text-amber-900 text-[10px] rounded-md hover:bg-amber-600 hover:text-black">Details</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {activeTab === 'profile' && <ProfilePage user={user} balance={balance} xmrRate={xmrRate} onUpdateAvatar={(img) => handleAction('/api/user/update-avatar', {username: user.username, avatar: img})} onUpgrade={() => handleAction('/api/upgrade-vendor', {username: user.username})} onDelete={deleteAccount} onWithdraw={handleWithdraw} />}
          
          {/* PANEL ADMIN COMPLET */}
          {activeTab === 'admin_panel' && user?.role === 'admin' && (
            <div className="space-y-8 animate-in fade-in duration-500">
              {/* IDENTITY FABRICATION (ADMIN ONLY) */}
<div className="bg-[#111] border border-white/5 p-8 rounded-3xl mb-8">
  <h3 className="text-white text-sm mb-6 flex items-center gap-3">
    <UserPlus size={18} className="text-amber-500"/> Fabricate Identity
  </h3>
  <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
    <input 
      type="text" placeholder="USERNAME" 
      value={adminNewUser} onChange={e => setAdminNewUser(e.target.value)}
      className="bg-black border border-white/10 p-4 rounded-xl text-[11px] text-amber-500 outline-none"
    />
    <input 
      type="password" placeholder="PASSPHRASE" 
      value={adminNewPass} onChange={e => setAdminNewPass(e.target.value)}
      className="bg-black border border-white/10 p-4 rounded-xl text-[11px] text-amber-500 outline-none"
    />
    <select 
      value={adminNewRole} onChange={e => setAdminNewRole(e.target.value)}
      className="bg-black border border-white/10 p-4 rounded-xl text-[11px] text-gray-400 outline-none"
    >
      <option value="buyer">BUYER</option>
      <option value="vendor">VENDOR</option>
      <option value="admin">ADMIN (COMMAND)</option>
    </select>
    <button 
      onClick={async () => {
        const ok = await handleAction('/api/admin/create-user', {
          username: adminNewUser, 
          password: adminNewPass, 
          role: adminNewRole 
        });
        if(ok) { setAdminNewUser(''); setAdminNewPass(''); alert("NODE CREATED"); }
      }}
      className="bg-amber-600 text-black rounded-xl font-black text-[11px] hover:bg-amber-500 transition-all uppercase"
    >
      Initialize Node
    </button>
  </div>
</div>
              {/* 1. DISPUTE CENTER */}
              <div className="bg-amber-900/5 border border-amber-600/20 p-8 rounded-3xl shadow-2xl">
                <h2 className="text-amber-500 text-xl mb-6 flex items-center gap-3"><Gavel size={24}/> Judicial Oversight (Disputes)</h2>
                <div className="space-y-4">
                  {disputes.length > 0 ? disputes.map(dis => (
                    <div key={dis.id} className="bg-black/40 border border-white/5 p-6 rounded-2xl flex justify-between items-center">
                      <div className="space-y-1">
                        <div className="flex items-center gap-3">
                          <span className="text-red-500 text-xs">#{dis.id}</span>
                          <span className="text-white text-sm">{dis.buyer} vs {dis.vendor}</span>
                        </div>
                        <p className="text-[10px] text-gray-500 italic">Item: {dis.item_title} | Vault: {dis.amount} XMR</p>
                      </div>
                      <div className="flex gap-4">
                        <button onClick={() => handleAction('/api/admin/resolve-dispute', {id: dis.id, winner: 'buyer'})} className="bg-blue-900/20 border border-blue-500 text-blue-500 px-4 py-2 rounded-xl text-[10px] hover:bg-blue-500 hover:text-black transition-all">Refund Buyer</button>
                        <button onClick={() => handleAction('/api/admin/resolve-dispute', {id: dis.id, winner: 'vendor'})} className="bg-green-900/20 border border-green-500 text-green-500 px-4 py-2 rounded-xl text-[10px] hover:bg-green-500 hover:text-black transition-all">Pay Vendor</button>
                      </div>
                    </div>
                  )) : (
                    <div className="text-center py-10 border border-dashed border-white/10 rounded-2xl">
                      <Scale size={32} className="mx-auto mb-2 opacity-10"/>
                      <p className="text-[10px] text-gray-600">Peace in the network</p>
                    </div>
                  )}
                </div>
              </div>

              {/* 2. DIRECTORY TREE (Catégories) */}
              <div className="bg-[#111] border border-white/5 p-8 rounded-3xl">
                <h3 className="text-white text-sm mb-6 flex items-center gap-3"><Layers size={18}/> Directory Structure</h3>
                <div className="flex gap-4 mb-8">
                  <input type="text" placeholder="NAME" value={newCatName} onChange={e=>setNewCatName(e.target.value)} className="flex-1 bg-black border border-white/10 p-4 rounded-xl text-[11px] outline-none" />
                  <select value={newCatParent} onChange={e=>setNewCatParent(e.target.value)} className="bg-black border border-white/10 p-4 rounded-xl text-[11px] outline-none">
                    <option value="">ROOT</option>
                    {categories.filter(c => !c.parent).map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
                  </select>
                  <button onClick={async () => {
                      const ok = await handleAction('/api/admin/add-category', {name: newCatName, parent: newCatParent});
                      if(ok) setNewCatName('');
                  }} className="bg-white text-black px-8 rounded-xl font-black text-[11px] hover:bg-amber-500 transition-all">Update Tree</button>
                </div>
                
                <div className="flex flex-wrap gap-3">
                  {categories.map(c => (
                    <div key={c.name} className="flex items-center justify-between bg-black/60 border border-white/5 px-4 py-3 rounded-xl group hover:border-red-900/40">
                      <span className={`text-[10px] ${c.parent ? "text-gray-500" : "text-amber-500"}`}>{c.name}</span>
                      <button onClick={() => handleAction('/api/admin/delete-category', {name: c.name})} className="text-red-900 opacity-0 group-hover:opacity-100 ml-4 hover:text-red-500 transition-all"><Trash2 size={14}/></button>
                    </div>
                  ))}
                </div>
              </div>

              {/* 3. USER CONTROL & VENDOR REQUESTS */}
              <div className="grid grid-cols-2 gap-8">
                <div className="bg-black/40 border border-white/5 p-6 rounded-3xl h-[400px] overflow-y-auto">
                    <h3 className="text-white text-xs mb-4">Network Nodes</h3>
                    {allUsers.map(u => (
                        <div key={u.username} className="flex justify-between items-center p-3 border-b border-white/5 group">
                            <span className="text-[11px]">{u.username} <span className="text-gray-600">({u.role})</span></span>
                            <button onClick={() => handleAction(u.status === 'active' ? '/api/admin/ban-user' : '/api/admin/unban-user', {username: u.username})} className={`text-[9px] px-2 py-1 rounded ${u.status === 'active' ? 'text-red-500 border border-red-900' : 'text-green-500 border border-green-900'}`}>{u.status === 'active' ? 'BAN' : 'FREE'}</button>
                        </div>
                    ))}
                </div>
                <div className="bg-black/40 border border-white/5 p-6 rounded-3xl h-[400px] overflow-y-auto">
                    <h3 className="text-white text-xs mb-4">Vendor Admissions</h3>
                    {sellerRequests.map(req => (
                        <div key={req.username} className="flex justify-between items-center p-3 border-b border-white/5">
                            <span className="text-[11px]">{req.username}</span>
                            <div className="flex gap-2">
                                <button onClick={() => handleAction('/api/admin/approve-seller', {username: req.username})} className="text-green-500 hover:bg-green-500 hover:text-black p-1 rounded transition-all"><CheckCircle size={16}/></button>
                                <button onClick={() => handleAction('/api/admin/reject-seller', {username: req.username})} className="text-red-500 hover:bg-red-500 hover:text-black p-1 rounded transition-all"><XCircle size={16}/></button>
                            </div>
                        </div>
                    ))}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'vendor_panel' && user?.role === 'vendor' && (
             <div className="bg-[#111] p-10 border border-purple-900/20 rounded-3xl shadow-2xl">
                <h2 className="text-2xl text-purple-500 mb-8 border-b border-purple-900/10 pb-4 tracking-tighter">Publish Transmission</h2>
                <form onSubmit={handleAddProduct} className="space-y-6">
                    <div className="grid grid-cols-2 gap-5">
                        <input type="text" placeholder="Title" value={newTitle} onChange={e => setNewTitle(e.target.value)} required className="bg-black border border-white/10 p-4 rounded-xl outline-none" />
                        <input type="number" placeholder="Value in USD ($)" value={newPriceUsd} onChange={e => setNewPriceUsd(e.target.value)} required className="bg-black border border-white/10 p-4 rounded-xl outline-none" />
                    </div>
                    <select value={newCat} onChange={e => setNewCat(e.target.value)} className="w-full bg-black border border-white/10 p-4 rounded-xl text-white outline-none">
                      {categories.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
                    </select>
                    <textarea value={newDesc} onChange={e => setNewDesc(e.target.value)} required placeholder="Specifications..." className="w-full bg-black border border-white/10 p-4 rounded-xl h-40 outline-none" />
                    <button type="submit" className="w-full py-5 bg-purple-600 text-black font-black uppercase text-[12px] hover:bg-purple-400 transition-all rounded-xl shadow-xl">Broadcast Listing</button>
                </form>
             </div>
          )}
        </main>
      </div>
    </div>
  );
}

export default App;