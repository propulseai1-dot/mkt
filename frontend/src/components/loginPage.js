function LoginPage({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [captchaSolved, setCaptchaSolved] = useState(false);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!captchaSolved) return alert("COMPLETE_VISUAL_CHALLENGE");
    onLogin(username, password);
  };

  return (
    <div className="min-h-screen bg-[#050505] flex items-center justify-center p-4 uppercase font-mono">
      <div className="w-full max-w-md bg-[#111] border border-amber-900/30 p-8 rounded-2xl shadow-2xl">
        <div className="text-center mb-10">
          <h1 className="text-4xl font-black text-amber-600 italic tracking-tighter">SILKGENESIS</h1>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <input type="text" placeholder="Username" className="..." onChange={(e) => setUsername(e.target.value)} />
          <input type="password" placeholder="Password" className="..." onChange={(e) => setPassword(e.target.value)} />

          {/* LE NOUVEAU CAPTCHA VISUEL */}
          <VisualCaptcha onVerify={setCaptchaSolved} />

          <button 
            type="submit" 
            className={`w-full py-4 rounded font-black tracking-widest text-xs transition-all ${captchaSolved ? 'bg-amber-600 text-black shadow-lg shadow-amber-900/20' : 'bg-gray-900 text-gray-700 cursor-not-allowed'}`}
          >
            Authenticate_Node
          </button>
        </form>
      </div>
    </div>
  );
}