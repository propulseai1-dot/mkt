import React, { useState, useEffect, useRef } from 'react';

const ClockCaptcha = ({ isOpen, onClose, onVerify }) => {
    const [targetTime, setTargetTime] = useState({ h: 0, m: 0 });
    const [hoursInput, setHoursInput] = useState('');
    const [minutesInput, setMinutesInput] = useState('');
    const [error, setError] = useState(false);
    const [timeLeft, setTimeLeft] = useState(30);
    const timerRef = useRef(null);

    const generateTime = () => {
        const h = Math.floor(Math.random() * 12) || 12;
        const m = Math.floor(Math.random() * 12) * 5;
        setTargetTime({ h, m });
        setHoursInput('');
        setMinutesInput('');
        setError(false);
        setTimeLeft(30);
    };

    useEffect(() => {
        if (isOpen) {
            generateTime();
            timerRef.current = setInterval(() => {
                setTimeLeft((prev) => {
                    if (prev <= 1) {
                        generateTime();
                        return 30;
                    }
                    return prev - 1;
                });
            }, 1000);
        }
        return () => clearInterval(timerRef.current);
    }, [isOpen]);

    const handleVerify = () => {
        const inputH = parseInt(hoursInput);
        const inputM = parseInt(minutesInput);
        
        const hMatch = inputH === targetTime.h || (targetTime.h === 12 && (inputH === 0 || inputH === 12));
        const mMatch = inputM === targetTime.m;

        if (hMatch && mMatch) {
            clearInterval(timerRef.current);
            onVerify(true);
            onClose();
        } else {
            setError(true);
            setTimeout(() => setError(false), 1000);
        }
    };

    if (!isOpen) return null;

    const minuteAngle = targetTime.m * 6;
    const hourAngle = (targetTime.h * 30) + (targetTime.m * 0.5);

    return (
      <div className="fixed inset-0 bg-black/98 flex items-center justify-center z-[9999] p-6 backdrop-blur-2xl">
        <style>{`
            /* Hide spinners for Chrome, Safari, Edge, Opera */
            input::-webkit-outer-spin-button,
            input::-webkit-inner-spin-button {
                -webkit-appearance: none;
                margin: 0;
            }
            /* Hide spinners for Firefox */
            input[type=number] {
                -moz-appearance: textfield;
            }
        `}</style>

        <div className={`bg-[#080808] border-2 ${error ? 'border-red-600 shadow-[0_0_30px_rgba(220,38,38,0.5)]' : 'border-amber-500/30 shadow-[0_0_50px_rgba(217,119,6,0.15)]'} p-8 rounded-[2.5rem] max-w-sm w-full text-center transition-all duration-300`}>
          
          <div className="flex justify-between items-center mb-6 px-1">
            <h3 className="text-amber-600/90 text-[8px] tracking-[0.4em] uppercase font-black italic">
              Temporal Sync
            </h3>
            <div className={`text-xs font-mono font-black border border-amber-500/20 px-3 py-1 rounded-full ${timeLeft <= 10 ? 'text-red-500 border-red-500 animate-pulse' : 'text-amber-600/70'}`}>
                {timeLeft}s
            </div>
          </div>
          
          {/* Cadran avec les 60 traits bien visibles */}
          <div className="w-64 h-64 border-2 border-amber-600/20 rounded-full mx-auto mb-10 relative bg-black shadow-[inset_0_0_40px_rgba(217,119,6,0.03)]">
            
            {/* 60-minute markers */}
            {[...Array(60)].map((_, i) => (
              <div key={i} className="absolute inset-0 flex justify-center" style={{ transform: `rotate(${i * 6}deg)` }}>
                <div className={`rounded-full mt-2 ${i % 5 === 0 
                    ? 'bg-amber-400 h-3.5 w-[3px] shadow-[0_0_10px_#fbbf24] z-10' 
                    : 'bg-amber-600/40 h-1.5 w-[1px] mt-3'}`} 
                />
              </div>
            ))}

            {/* Center */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-4 bg-amber-500 rounded-full z-30 border-2 border-black shadow-[0_0_15px_#d97706]" />

            {/* Clock Hands */}
            <div className="absolute top-1/2 left-1/2 w-2.5 h-14 bg-amber-400 rounded-full shadow-[0_0_20px_#fbbf24] z-20"
                 style={{ transformOrigin: 'bottom center', transform: `translate(-50%, -100%) rotate(${hourAngle}deg)` }} />
            
            <div className="absolute top-1/2 left-1/2 w-1.5 h-24 bg-amber-600 rounded-full shadow-[0_0_15px_#d97706] z-10"
                 style={{ transformOrigin: 'bottom center', transform: `translate(-50%, -100%) rotate(${minuteAngle}deg)` }} />
          </div>

          <div className="space-y-6">
            <div className="flex items-center justify-center gap-3 h-16 px-4">
                <input 
                  type="number" 
                  placeholder="HH"
                  value={hoursInput}
                  onChange={(e) => setHoursInput(e.target.value)}
                  className="w-20 h-full bg-black border-2 border-amber-500/20 rounded-xl text-amber-500 text-center text-3xl font-black outline-none focus:border-amber-400 transition-all placeholder:text-amber-900/10"
                />
                
                <span className="text-amber-500 text-4xl font-black">:</span>

                <input 
                  type="number" 
                  placeholder="MM"
                  value={minutesInput}
                  onChange={(e) => setMinutesInput(e.target.value)}
                  className="w-20 h-full bg-black border-2 border-amber-500/20 rounded-xl text-amber-500 text-center text-3xl font-black outline-none focus:border-amber-400 transition-all placeholder:text-amber-900/10"
                />
            </div>

            <button 
              onClick={handleVerify}
              className="w-full h-14 bg-[#d97706] text-black text-[12px] font-black tracking-[0.4em] uppercase hover:bg-amber-400 transition-all rounded-xl shadow-[0_0_20px_rgba(217,119,6,0.25)]"
            >
              Verify Identity
            </button>
            
            <button onClick={onClose} className="block w-full text-amber-900/40 text-[9px] uppercase font-bold hover:text-amber-500 tracking-widest transition-colors">
              Abort
            </button>
          </div>
        </div>
      </div>
    );
};

export default ClockCaptcha;