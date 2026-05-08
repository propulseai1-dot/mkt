import React, { useState } from 'react';
import { Fingerprint, ShieldCheck } from 'lucide-react';
// Logo import (ensure Silk_logo.png is at /src root)
import Logo from '../Silk_logo.png'; 
import ClockCaptcha from './ClockCaptcha'; 

function LoginPage({ onLogin }) {
  const [isRegister, setIsRegister] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isVerified, setIsVerified] = useState(false); // Change captchaToken par isVerified
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [error, setError] = useState('');
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!isVerified) return;
    setError('');

    const endpoint = isRegister ? 'register' : 'login';
    
    try {
      const response = await fetch(`/api/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: username,
          password: password
        }),
      });

      const data = await response.json();

              if (response.ok && data.status === 'success') {
        if (isRegister) {
          alert(`IDENTITY_FABRICATED: ${data.address}`);
          setIsRegister(false);
          setIsVerified(false);
        } else {
          // Gateway access granted: send data to App.js
          onLogin(data.user, data.session_token); 
        }
      } else {
        setError(data.detail || 'GATEWAY_ERROR: ACCESS_DENIED');
        // Reset captcha on error
        setIsVerified(false);
      }
    } catch (err) {
      setError('CORE_SYSTEM_OFFLINE');
    }
  };

  return (
    <div className="min-h-screen bg-[#050505] flex items-center justify-center p-4 font-mono relative uppercase italic font-black text-center">
      <div className="w-full max-w-lg bg-[#0d0d0d] border border-amber-900/30 p-12 rounded-[2.5rem] shadow-2xl shadow-amber-900/5">
        
        <div className="text-center mb-10">
          <img src={Logo} alt="SilkGenesis" className="h-16 mx-auto mb-8 drop-shadow-[0_0_10px_rgba(217,119,6,0.3)]" />
          <p className="text-[10px] text-amber-600/60 tracking-[0.7em] border-t border-amber-900/20 pt-5 uppercase">
            {isRegister ? "Fabricate New Identity" : "Initialize Access Gateway"}
          </p>
        </div>

        {error && (
          <div className="mb-6 p-4 border border-red-900/50 bg-red-900/10 text-red-500 text-[10px] tracking-widest animate-pulse">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-4">
            <input 
              type="text" 
              placeholder="USER ID" 
              className="w-full bg-black border-2 border-white/5 p-5 rounded-2xl text-amber-500 outline-none text-lg font-black placeholder:text-amber-900/20 focus:border-amber-600/50 transition-all" 
              value={username}
              onChange={(e) => setUsername(e.target.value)} 
              required
            />
            <input 
              type="password" 
              placeholder="PASSPHRASE" 
              className="w-full bg-black border-2 border-white/5 p-5 rounded-2xl text-amber-500 outline-none text-lg font-black placeholder:text-amber-900/20 focus:border-amber-600/50 transition-all" 
              value={password}
              onChange={(e) => setPassword(e.target.value)} 
              required
            />
          </div>
          
          <div className="bg-black/50 border border-amber-900/20 p-6 rounded-2xl text-center space-y-4 shadow-inner">
             {!isVerified ? (
               <button 
                 type="button" 
                 onClick={() => setIsModalOpen(true)} 
                 className="w-full py-4 border-2 border-amber-600/30 text-amber-600 text-[10px] uppercase hover:bg-amber-600/10 transition-all flex items-center justify-center gap-3 rounded-xl font-black tracking-widest"
               >
                  <Fingerprint size={18}/> Run Integrity Check
               </button>
             ) : (
               <div className="flex items-center justify-center gap-3 text-green-500 font-black text-[11px] py-2 animate-pulse uppercase tracking-[0.2em]">
                 <ShieldCheck size={20} /><span>GATEWAY ACCESS CONFIRMED</span>
               </div>
             )}
          </div>

          <button 
            type="submit" 
            disabled={!isVerified} 
            className={`w-full py-5 rounded-2xl tracking-[0.4em] text-[13px] font-black transition-all duration-300 ${isVerified ? 'bg-amber-600 text-black hover:bg-amber-400 shadow-[0_0_20px_rgba(217,119,6,0.4)] active:scale-95' : 'bg-gray-900 text-gray-700 cursor-not-allowed'}`}
          >
            {isRegister ? "Fabricate Identity" : "Initialize Access"}
          </button>

          <p 
            className="text-[10px] text-gray-600 mt-6 cursor-pointer hover:text-amber-500 transition-colors uppercase tracking-widest" 
            onClick={() => {
              setIsRegister(!isRegister); 
              setIsVerified(false);
              setError('');
            }}
          >
            {isRegister ? "Already in Network? Initialize Access" : "No Node Found? Fabricate Identity"}
          </p>
        </form>
      </div>

      {/* Captcha Component */}
      <ClockCaptcha 
        isOpen={isModalOpen} 
        onClose={() => setIsModalOpen(false)} 
        onVerify={(status) => setIsVerified(status)} 
      />
    </div>
  );
}

export default LoginPage;

