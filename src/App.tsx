import { useState, useEffect } from 'react';
import { Activity, Play, Tv } from 'lucide-react';
import Dashboard from './components/Dashboard';
import TelegramTab from './components/TelegramTab';

function App() {
  const [engineStatus, setEngineStatus] = useState<string>('checking');
  const [activeTab, setActiveTab] = useState('telegram');
  const [pendingStream, setPendingStream] = useState<string | null>(null);

  useEffect(() => {
    // Listen for play requests from other tabs
    const handlePlayStream = (e: any) => {
        setPendingStream(e.detail);
        setActiveTab('dashboard');
    };
    
    window.addEventListener('play-stream', handlePlayStream);
    return () => window.removeEventListener('play-stream', handlePlayStream);
  }, []);

  useEffect(() => {
    const checkStatus = async () => {
      const status = await window.electronAPI.checkDockerStatus();
      setEngineStatus(status);
    };

    checkStatus();
    const interval = setInterval(checkStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  // Telegram State (moved up to persist across tab switches)
  const [tgPhone, setTgPhone] = useState(localStorage.getItem('tg_phone') || '');
  const [tgChannels, setTgChannels] = useState<any[]>([]);
  const [tgStep, setTgStep] = useState<'config' | 'code' | 'authorized'>('config');

  // Persist phone
  useEffect(() => {
    if (tgPhone) localStorage.setItem('tg_phone', tgPhone);
  }, [tgPhone]);

  // Favorites State - array of cleaned channel names
  const [favorites, setFavorites] = useState<string[]>(() => {
    return JSON.parse(localStorage.getItem('ace_favorites') || '[]');
  });

  // Persist favorites
  useEffect(() => {
    localStorage.setItem('ace_favorites', JSON.stringify(favorites));
  }, [favorites]);

  // Helper functions for favorites
  const addToFavorites = (channelName: string) => {
    const cleanedName = channelName
      .replace(/[^\p{L}\p{N}\s]/gu, '')
      .replace(/\s+/g, ' ')
      .trim();
    
    if (!favorites.includes(cleanedName)) {
      setFavorites([...favorites, cleanedName].sort((a, b) => a.localeCompare(b, 'es')));
    }
  };

  const removeFromFavorites = (channelName: string) => {
    const cleanedName = channelName
      .replace(/[^\p{L}\p{N}\s]/gu, '')
      .replace(/\s+/g, ' ')
      .trim();
    
    setFavorites(favorites.filter(f => f !== cleanedName).sort((a, b) => a.localeCompare(b, 'es')));
  };

  const isFavorite = (channelName: string) => {
    const cleanedName = channelName
      .replace(/[^\p{L}\p{N}\s]/gu, '')
      .replace(/\s+/g, ' ')
      .trim();
    
    return favorites.includes(cleanedName);
  };

  // Find matching channels for favorites
  const getFavoriteMatches = () => {
    return favorites
      .map(favName => {
        const match = tgChannels.find(ch => {
          const cleanChName = ch.name
            .replace(/[^\p{L}\p{N}\s]/gu, '')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();
          const cleanFavName = favName.toLowerCase();
          return cleanChName.includes(cleanFavName) || cleanFavName.includes(cleanChName);
        });
        return match ? { favoriteName: favName, channel: match } : null;
      })
      .filter((item): item is { favoriteName: string; channel: any } => item !== null)
      .sort((a, b) => a.favoriteName.localeCompare(b.favoriteName, 'es'));
  };

  return (
    <div className="flex h-screen bg-[#1a1a1a] text-white">
      {/* Sidebar */}
      <div className="w-20 bg-[#242424] flex flex-col items-center py-6 border-r border-[#333] pt-12 drag">
        <div className="mb-8 p-2 bg-blue-600 rounded-lg no-drag">
          <Activity size={24} color="white" />
        </div>
        
        <nav className="flex flex-col gap-4 w-full items-center no-drag">
          <button 
            onClick={() => setActiveTab('telegram')}
            className={`p-3 rounded-xl transition-all ${activeTab === 'telegram' ? 'bg-[#333] text-blue-400' : 'text-gray-400 hover:text-white'}`}
            title="Canales"
          >
            <Tv size={24} />
          </button>
          <button 
            onClick={() => setActiveTab('dashboard')}
            className={`p-3 rounded-xl transition-all ${activeTab === 'dashboard' ? 'bg-[#333] text-blue-400' : 'text-gray-400 hover:text-white'}`}
            title="Reproductor"
          >
            <Play size={24} />
          </button>
        </nav>


      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col">
        {/* Title Bar Area (Drag Region) */}
        <div className="h-10 w-full drag flex items-center px-4 bg-[#1a1a1a]">
          <div className="flex-1"></div>
          <div className="flex items-center gap-2">
             <div className={`w-2 h-2 rounded-full ${engineStatus === 'running' ? 'bg-green-500' : 'bg-red-500'}`}></div>
             <span className="text-xs text-gray-400">
               {engineStatus === 'running' ? 'Motor Listo' : 'Motor Detenido'}
             </span>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-6">
          {activeTab === 'dashboard' && <Dashboard initialStreamId={pendingStream || undefined} />}
          {activeTab === 'telegram' && (
            <TelegramTab 
              phone={tgPhone} 
              setPhone={setTgPhone}
              step={tgStep}
              setStep={setTgStep}
              channels={tgChannels}
              setChannels={setTgChannels}
              addToFavorites={addToFavorites}
              removeFromFavorites={removeFromFavorites}
              isFavorite={isFavorite}
              getFavoriteMatches={getFavoriteMatches}
            />
          )}
          {activeTab === 'history' && <div className="text-center mt-20 text-gray-500">Historial próximamente...</div>}
        </div>
      </div>
    </div>
  );
}

export default App;
