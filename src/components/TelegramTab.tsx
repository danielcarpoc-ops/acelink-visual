import { useState, useEffect } from 'react';
import { Send, Phone, RefreshCw, Play } from 'lucide-react';

const TelegramTab = () => {
  // Config State - Only phone is needed, API ID/Hash come from config.json
  const [phone, setPhone] = useState(localStorage.getItem('tg_phone') || '');
  
  // Auth State
  const [step, setStep] = useState('config'); // config, code, authorized
  const [code, setCode] = useState('');
  const [statusMsg, setStatusMsg] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Data State
  const [channels, setChannels] = useState<any[]>([]);

  useEffect(() => {
    // Save phone when changed
    localStorage.setItem('tg_phone', phone);
  }, [phone]);

  // Auto-connect if phone is already saved
  useEffect(() => {
    const savedPhone = localStorage.getItem('tg_phone');
    if (savedPhone && savedPhone !== phone) {
      setPhone(savedPhone);
      // Trigger auto-login
      handleLogin();
    }
  }, []);

  const sendCommand = async (cmd: string, extra = {}) => {
    setIsLoading(true);
    setStatusMsg('');
    try {
      const payload = {
        command: cmd,
        phone,
        ...extra
      };
      const res = await window.electronAPI.telegramAction(payload);
      setIsLoading(false);
      return res;
    } catch (e: any) {
      setIsLoading(false);
      setStatusMsg('Error: ' + e.message);
      return { status: 'error', message: e.message };
    }
  };

  const [phoneCodeHash, setPhoneCodeHash] = useState('');

  const handleLogin = async () => {
    if (!phone) {
      setStatusMsg('Please enter your phone number');
      return;
    }
    const res = await sendCommand('login');
    if (res.status === 'needs_code') {
      setStep('code');
      setPhoneCodeHash(res.phone_code_hash);
      setStatusMsg('Code sent to your Telegram app');
    } else if (res.status === 'authorized') {
      setStep('authorized');
      fetchChannels();
    } else {
      setStatusMsg(res.message || 'Unknown error');
    }
  };

  const submitCode = async () => {
    const res = await sendCommand('submit_code', { code, phoneCodeHash });
    if (res.status === 'authorized') {
      setStep('authorized');
      fetchChannels();
    } else {
      setStatusMsg(res.message || 'Invalid code');
    }
  };

  const fetchChannels = async () => {
    const res = await sendCommand('fetch_channels');
    if (res.status === 'success') {
      setChannels(res.data);
    } else {
      setStatusMsg(res.message || 'Failed to fetch');
    }
  };

  const playChannel = (id: string) => {
    const event = new CustomEvent('play-stream', { detail: id });
    window.dispatchEvent(event);
  };

  const [activeCategory, setActiveCategory] = useState<'channel' | 'event'>('event');

  const filteredChannels = channels.filter(ch => {
      if (activeCategory === 'channel') return ch.type === 'channel' || !ch.type;
      if (activeCategory === 'event') return ch.type === 'event';
      return true;
  });

  if (step === 'config') {
    return (
      <div className="max-w-2xl mx-auto p-6 bg-[#242424] rounded-2xl shadow-xl">
        <h2 className="text-2xl font-bold mb-6 flex items-center gap-2">
          <Send size={24} className="text-blue-400" /> Telegram Setup
        </h2>
        
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1 flex items-center gap-2"><Phone size={14}/> Phone Number</label>
            <input 
              type="text" 
              value={phone}
              onChange={e => setPhone(e.target.value)}
              className="w-full bg-[#1a1a1a] border border-[#333] rounded-lg px-4 py-2 text-white"
              placeholder="+34600000000"
            />
            <p className="text-xs text-gray-500 mt-1">API credentials are loaded from config.json</p>
          </div>

          <button 
            onClick={handleLogin}
            disabled={isLoading}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-xl transition-colors disabled:opacity-50"
          >
            {isLoading ? 'Connecting...' : 'Connect'}
          </button>
          
          {statusMsg && <p className="text-red-400 text-sm mt-2">{statusMsg}</p>}
        </div>
      </div>
    );
  }

  if (step === 'code') {
    return (
      <div className="max-w-md mx-auto p-6 bg-[#242424] rounded-2xl shadow-xl text-center">
        <h2 className="text-xl font-bold mb-4">Enter Code</h2>
        <p className="text-gray-400 mb-6 text-sm">We sent a code to your Telegram app.</p>
        
        <input 
          type="text" 
          value={code}
          onChange={e => setCode(e.target.value)}
          className="w-full bg-[#1a1a1a] border border-[#333] rounded-lg px-4 py-3 text-white text-center text-2xl tracking-widest mb-6"
          placeholder="12345"
        />

        <button 
          onClick={submitCode}
          disabled={isLoading}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-xl transition-colors disabled:opacity-50"
        >
          {isLoading ? 'Verifying...' : 'Submit Code'}
        </button>
        {statusMsg && <p className="text-red-400 text-sm mt-2">{statusMsg}</p>}
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold flex items-center gap-2">
          <Send className="text-blue-400" /> Telegram
        </h2>
        
        <div className="flex bg-[#333] rounded-lg p-1">
             <button 
               onClick={() => setActiveCategory('channel')}
               className={`px-4 py-1 rounded-md text-sm font-medium transition-colors ${activeCategory === 'channel' ? 'bg-[#444] text-white shadow' : 'text-gray-400 hover:text-white'}`}
             >
               Channels
             </button>
             <button 
               onClick={() => setActiveCategory('event')}
               className={`px-4 py-1 rounded-md text-sm font-medium transition-colors ${activeCategory === 'event' ? 'bg-[#444] text-white shadow' : 'text-gray-400 hover:text-white'}`}
             >
               Live Events
             </button>
        </div>

        <button 
          onClick={fetchChannels}
          disabled={isLoading}
          className="p-2 bg-[#333] hover:bg-[#444] rounded-lg transition-colors"
          title="Refresh"
        >
          <RefreshCw size={20} className={isLoading ? 'animate-spin' : ''} />
        </button>
      </div>

      {channels.length === 0 ? (
        <div className="text-center py-20 text-gray-500">
          <p>No streams found yet.</p>
          <button onClick={fetchChannels} className="text-blue-400 mt-2 underline">Try scanning now</button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredChannels.length === 0 && (
             <div className="col-span-full text-center py-10 text-gray-500">No content found in this category.</div>
          )}
          {filteredChannels.map((ch, idx) => (
            <div key={idx} className="bg-[#242424] p-4 rounded-xl border border-[#333] hover:border-blue-500/50 transition-all group">
              <h3 className="font-bold text-lg mb-1 truncate">{ch.name}</h3>
              <p className="text-xs text-gray-500 mb-4 font-mono truncate">{ch.id}</p>
              
              <button 
                onClick={() => playChannel(ch.id)}
                className="w-full bg-[#1a1a1a] hover:bg-blue-600 hover:text-white text-gray-300 py-2 rounded-lg flex items-center justify-center gap-2 transition-colors"
              >
                <Play size={16} /> Play Now
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default TelegramTab;
