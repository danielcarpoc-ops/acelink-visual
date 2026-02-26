import { useState, useEffect } from 'react';
import { Play, Tv, Sun, Moon, Settings, RefreshCw } from 'lucide-react';
import Dashboard from './components/Dashboard';
import TelegramTab from './components/TelegramTab';

function App() {
  const [engineStatus, setEngineStatus] = useState<string>('checking');
  const [isStartingEngine, setIsStartingEngine] = useState(false);
  const [activeTab, setActiveTab] = useState('telegram');
  const [pendingStream, setPendingStream] = useState<string | null>(null);
  
  // Theme state
  const [isDarkMode, setIsDarkMode] = useState(() => {
    return localStorage.getItem('theme') !== 'light';
  });
  
  // Font size state
  const [fontSize, setFontSize] = useState<'small' | 'normal' | 'large'>(() => {
    return (localStorage.getItem('fontSize') as 'small' | 'normal' | 'large') || 'normal';
  });
  
  // Persist theme
  useEffect(() => {
    localStorage.setItem('theme', isDarkMode ? 'dark' : 'light');
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
      document.documentElement.classList.remove('light');
    } else {
      document.documentElement.classList.add('light');
      document.documentElement.classList.remove('dark');
    }
  }, [isDarkMode]);
  
  // Persist font size
  useEffect(() => {
    localStorage.setItem('fontSize', fontSize);
    document.documentElement.style.fontSize = 
      fontSize === 'small' ? '14px' : fontSize === 'large' ? '18px' : '16px';
  }, [fontSize]);

  // Listen for play requests from other tabs
  const handlePlayStream = (e: CustomEvent<string>) => {
    setPendingStream(e.detail);
    setActiveTab('dashboard');
  };

  // Listen for going back to channels
  const handleGoToChannels = () => {
    setActiveTab('telegram');
  };

  useEffect(() => {
    window.addEventListener('play-stream', handlePlayStream as EventListener);
    window.addEventListener('go-to-channels', handleGoToChannels);
    return () => {
      window.removeEventListener('play-stream', handlePlayStream as EventListener);
      window.removeEventListener('go-to-channels', handleGoToChannels);
    };
  }, []);

  // Reset pending stream when switching to dashboard tab manually
  useEffect(() => {
    if (activeTab === 'dashboard' && pendingStream !== null) {
      // Use RAF to avoid synchronous setState during render
      requestAnimationFrame(() => {
        setPendingStream(null);
      });
    }
  }, [activeTab, pendingStream]);

  useEffect(() => {
    const checkStatus = async () => {
      const status = await window.electronAPI.checkDockerStatus();
      setEngineStatus(status);
    };

    checkStatus();
    const interval = setInterval(checkStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleRestartEngine = async () => {
    setIsStartingEngine(true);
    try {
      await window.electronAPI.startEngine();
      const status = await window.electronAPI.checkDockerStatus();
      setEngineStatus(status);
    } catch (e) {
      console.error('Failed to start engine', e);
    } finally {
      setIsStartingEngine(false);
    }
  };

  // Telegram State (moved up to persist across tab switches)
  interface Channel {
    id: number;
    name: string;
  }
  
  const [tgPhone, setTgPhone] = useState(localStorage.getItem('tg_phone') || '');
  const [tgChannels, setTgChannels] = useState<Channel[]>([]);
  const [tgStep, setTgStep] = useState<'loading' | 'config' | 'code' | 'authorized'>('loading');

  // Settings State for Telegram Config
  const [apiId, setApiId] = useState('');
  const [apiHash, setApiHash] = useState('');
  const [settingsPhone, setSettingsPhone] = useState(tgPhone);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [settingsMsg, setSettingsMsg] = useState('');

  // Fetch config when switching to settings
  useEffect(() => {
    if (activeTab === 'settings') {
      window.electronAPI.readConfig().then(config => {
        setApiId(config.api_id ? String(config.api_id) : '');
        setApiHash(config.api_hash || '');
      });
      setSettingsPhone(tgPhone);
      setSettingsMsg('');
    }
  }, [activeTab, tgPhone]);

  const handleSaveSettings = async () => {
    setIsSavingSettings(true);
    setSettingsMsg('');
    try {
      const success = await window.electronAPI.writeConfig({
        api_id: parseInt(apiId, 10) || apiId,
        api_hash: apiHash
      });
      if (success) {
        setTgPhone(settingsPhone);
        if (settingsPhone !== tgPhone) {
          setTgStep('config'); // Force re-login if phone changed
        }
        setSettingsMsg('Configuración guardada correctamente.');
      } else {
        setSettingsMsg('Error al guardar la configuración.');
      }
    } catch (e) {
      setSettingsMsg('Error: ' + String(e));
    } finally {
      setIsSavingSettings(false);
    }
  };

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
      .filter((item): item is { favoriteName: string; channel: Channel } => item !== null)
      .sort((a, b) => a.favoriteName.localeCompare(b.favoriteName, 'es'));
  };

  return (
    <div className={`flex h-screen ${isDarkMode ? 'bg-[#1a1a1a] text-white' : 'bg-gray-50 text-gray-900'}`}>
      {/* Sidebar */}
      <div className={`w-20 flex flex-col items-center py-6 border-r pt-12 drag ${isDarkMode ? 'bg-[#242424] border-[#333]' : 'bg-white border-gray-200'}`}>
        <nav className="flex flex-col gap-4 w-full items-center no-drag">
          <button 
            onClick={() => setActiveTab('telegram')}
            className={`p-3 rounded-xl transition-all ${activeTab === 'telegram' ? (isDarkMode ? 'bg-[#333] text-blue-400' : 'bg-blue-100 text-blue-600') : (isDarkMode ? 'text-gray-400 hover:text-white' : 'text-gray-500 hover:text-gray-900')}`}
            title="Canales"
          >
            <Tv size={24} />
          </button>
          <button 
            onClick={() => setActiveTab('dashboard')}
            className={`p-3 rounded-xl transition-all ${activeTab === 'dashboard' ? (isDarkMode ? 'bg-[#333] text-blue-400' : 'bg-blue-100 text-blue-600') : (isDarkMode ? 'text-gray-400 hover:text-white' : 'text-gray-500 hover:text-gray-900')}`}
            title="Reproductor"
          >
            <Play size={24} />
          </button>
          <button 
            onClick={() => setActiveTab('settings')}
            className={`p-3 rounded-xl transition-all ${activeTab === 'settings' ? (isDarkMode ? 'bg-[#333] text-blue-400' : 'bg-blue-100 text-blue-600') : (isDarkMode ? 'text-gray-400 hover:text-white' : 'text-gray-500 hover:text-gray-900')}`}
            title="Configuración"
          >
            <Settings size={24} />
          </button>
        </nav>

      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col">
        {/* Title Bar Area (Drag Region) */}
        <div className={`h-10 w-full drag flex items-center px-4 ${isDarkMode ? 'bg-[#1a1a1a]' : 'bg-gray-200'}`}>
          <div className="flex-1"></div>
          <div className="flex items-center gap-2">
             <div className={`w-2 h-2 rounded-full ${engineStatus === 'running' ? 'bg-green-500' : 'bg-red-500'}`}></div>
              <span className={`text-xs ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                {engineStatus === 'running' ? 'Motor Listo' : 'Motor Detenido'}
              </span>
              {engineStatus !== 'running' && (
                <button 
                  onClick={handleRestartEngine}
                  disabled={isStartingEngine}
                  className={`no-drag flex items-center gap-1 px-2 py-1 ml-2 text-xs rounded transition-colors ${
                    isDarkMode 
                      ? 'bg-[#333] hover:bg-[#444] text-white disabled:bg-[#222]' 
                      : 'bg-white hover:bg-gray-100 text-gray-900 shadow-sm border border-gray-200 disabled:bg-gray-50'
                  } disabled:opacity-50`}
                  title="Relanzar Motor"
                >
                  <RefreshCw size={12} className={isStartingEngine ? 'animate-spin' : ''} />
                  {isStartingEngine ? 'Iniciando...' : 'Relanzar'}
                </button>
              )}
          </div>
        </div>

        {/* Content */}
        <div className={`flex-1 overflow-auto p-6 ${isDarkMode ? 'bg-[#1a1a1a] text-white' : 'bg-gray-100 text-gray-900'}`}>
          {activeTab === 'dashboard' && <Dashboard initialStreamId={pendingStream || undefined} isDarkMode={isDarkMode} />}
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
              isDarkMode={isDarkMode}
            />
          )}
          {activeTab === 'settings' && (
            <div className="max-w-2xl mx-auto">
              <h2 className="text-3xl font-bold mb-6">Configuración</h2>
              
              <div className="space-y-6">
                <div className={`p-6 rounded-2xl shadow-lg ${isDarkMode ? 'bg-[#242424]' : 'bg-white'}`}>
                  <h3 className="text-xl font-semibold mb-4">Apariencia</h3>
                  
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <span>Tema</span>
                      <button 
                        onClick={() => setIsDarkMode(!isDarkMode)}
                        className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors"
                      >
                        {isDarkMode ? <Sun size={18} /> : <Moon size={18} />}
                        {isDarkMode ? 'Modo oscuro' : 'Modo claro'}
                      </button>
                    </div>
                    
                    <div className="flex items-center justify-between">
                      <span>Tamaño de texto</span>
                      <div className="flex gap-2">
                        <button 
                          onClick={() => setFontSize('small')}
                          className={`px-4 py-2 rounded-lg transition-colors ${fontSize === 'small' ? 'bg-blue-600 text-white' : isDarkMode ? 'bg-[#333] text-gray-400' : 'bg-gray-200 text-gray-700'}`}
                        >
                          Pequeño
                        </button>
                        <button 
                          onClick={() => setFontSize('normal')}
                          className={`px-4 py-2 rounded-lg transition-colors ${fontSize === 'normal' ? 'bg-blue-600 text-white' : isDarkMode ? 'bg-[#333] text-gray-400' : 'bg-gray-200 text-gray-700'}`}
                        >
                          Normal
                        </button>
                        <button 
                          onClick={() => setFontSize('large')}
                          className={`px-4 py-2 rounded-lg transition-colors ${fontSize === 'large' ? 'bg-blue-600 text-white' : isDarkMode ? 'bg-[#333] text-gray-400' : 'bg-gray-200 text-gray-700'}`}
                        >
                          Grande
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                <div className={`p-6 rounded-2xl shadow-lg ${isDarkMode ? 'bg-[#242424]' : 'bg-white'}`}>
                  <h3 className="text-xl font-semibold mb-4">API de Telegram</h3>
                  <div className="space-y-4">
                    <div>
                      <label className={`block text-sm mb-1 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>API ID</label>
                      <input 
                        type="text" 
                        value={apiId}
                        onChange={e => setApiId(e.target.value)}
                        className={`w-full border rounded-lg px-4 py-2 ${isDarkMode ? 'bg-[#1a1a1a] border-[#333] text-white' : 'bg-gray-100 border-gray-300 text-gray-900'}`}
                        placeholder="ej. 32453871"
                      />
                    </div>
                    <div>
                      <label className={`block text-sm mb-1 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>API Hash</label>
                      <input 
                        type="text" 
                        value={apiHash}
                        onChange={e => setApiHash(e.target.value)}
                        className={`w-full border rounded-lg px-4 py-2 ${isDarkMode ? 'bg-[#1a1a1a] border-[#333] text-white' : 'bg-gray-100 border-gray-300 text-gray-900'}`}
                        placeholder="Tu API Hash"
                      />
                    </div>
                    <div>
                      <label className={`block text-sm mb-1 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>Teléfono</label>
                      <input 
                        type="text" 
                        value={settingsPhone}
                        onChange={e => setSettingsPhone(e.target.value)}
                        className={`w-full border rounded-lg px-4 py-2 ${isDarkMode ? 'bg-[#1a1a1a] border-[#333] text-white' : 'bg-gray-100 border-gray-300 text-gray-900'}`}
                        placeholder="+34600000000"
                      />
                    </div>
                    <button 
                      onClick={handleSaveSettings}
                      disabled={isSavingSettings}
                      className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 rounded-xl transition-colors disabled:opacity-50 mt-4"
                    >
                      {isSavingSettings ? 'Guardando...' : 'Guardar Configuración'}
                    </button>
                    {settingsMsg && (
                      <p className={`text-sm mt-2 ${settingsMsg.includes('Error') ? 'text-red-400' : 'text-green-400'}`}>
                        {settingsMsg}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
          {activeTab === 'history' && <div className="text-center mt-20 text-gray-500">Historial próximamente...</div>}
        </div>
      </div>
    </div>
  );
}

export default App;
