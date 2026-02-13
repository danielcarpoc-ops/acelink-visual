import { useState, useEffect } from 'react';
import { Send, Phone, RefreshCw, Play, Star, Search, Trash2, LayoutGrid, List, Loader2 } from 'lucide-react';

// Helper function to clean channel names
const cleanChannelName = (name: string): string => {
  if (!name) return '';
  // Remove special characters (keep letters including accented, numbers, and spaces)
  // \p{L} matches any kind of letter from any language (including accented)
  return name
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
};

interface TelegramTabProps {
  phone: string;
  setPhone: (p: string) => void;
  step: 'config' | 'code' | 'authorized';
  setStep: (s: 'config' | 'code' | 'authorized') => void;
  channels: any[];
  setChannels: (c: any[]) => void;
  addToFavorites: (name: string) => void;
  removeFromFavorites: (name: string) => void;
  isFavorite: (name: string) => boolean;
  getFavoriteMatches: () => { favoriteName: string; channel: any }[];
  isDarkMode: boolean;
}

const TelegramTab = ({ 
  phone, 
  setPhone, 
  step, 
  setStep, 
  channels, 
  setChannels,
  addToFavorites,
  removeFromFavorites,
  isFavorite,
  getFavoriteMatches,
  isDarkMode
}: TelegramTabProps) => {
  const [code, setCode] = useState('');
  const [statusMsg, setStatusMsg] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [phoneCodeHash, setPhoneCodeHash] = useState('');
  const [activeCategory, setActiveCategory] = useState<'channel' | 'event' | 'favorites'>('event');
  const [searchQuery, setSearchQuery] = useState('');
  
  // Layout state
  const [layout, setLayout] = useState<'grid' | 'list'>(() => {
    return (localStorage.getItem('channelLayout') as 'grid' | 'list') || 'grid';
  });
  
  // Persist layout
  useEffect(() => {
    localStorage.setItem('channelLayout', layout);
  }, [layout]);

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

  const handleLogin = async () => {
    if (!phone) {
      setStatusMsg('Por favor, introduce tu número de teléfono');
      return;
    }
    const res = await sendCommand('login');
    if (res.status === 'needs_code') {
      setStep('code');
      setPhoneCodeHash(res.phone_code_hash);
      setStatusMsg('Código enviado a tu app de Telegram');
    } else if (res.status === 'authorized') {
      setStep('authorized');
      fetchChannels();
    } else {
      setStatusMsg(res.message || 'Error desconocido');
    }
  };

  const submitCode = async () => {
    const res = await sendCommand('submit_code', { code, phoneCodeHash });
    if (res.status === 'authorized') {
      setStep('authorized');
      fetchChannels();
    } else {
      setStatusMsg(res.message || 'Código inválido');
    }
  };

  const fetchChannels = async () => {
    const res = await sendCommand('fetch_channels');
    if (res.status === 'success') {
      setChannels(res.data);
      setIsInitialLoading(false);
    } else {
      setStatusMsg(res.message || 'Error al obtener canales');
    }
  };

  const playChannel = (id: string) => {
    const event = new CustomEvent('play-stream', { detail: id });
    window.dispatchEvent(event);
  };

  // Auto-connect on mount if phone exists
  useEffect(() => {
    if (phone && step === 'config') {
      handleLogin();
    }
  }, []);

  // Filter and sort channels
  const filteredChannels = channels
    .filter(ch => {
      // Filter by category
      let matchesCategory = true;
      if (activeCategory === 'channel') {
        matchesCategory = ch.type === 'channel' || !ch.type;
      } else if (activeCategory === 'event') {
        matchesCategory = ch.type === 'event';
      }
      
      // Filter by search query
      const matchesSearch = searchQuery === '' || 
        cleanChannelName(ch.name).toLowerCase().includes(searchQuery.toLowerCase());
      
      return matchesCategory && matchesSearch;
    })
    .sort((a, b) => {
      return cleanChannelName(a.name).localeCompare(cleanChannelName(b.name), 'es');
    });

  // Get favorite matches
  const favoriteMatches = getFavoriteMatches();

  if (step === 'config') {
    return (
      <div className={`max-w-2xl mx-auto p-6 ${isDarkMode ? 'bg-[#242424]' : 'bg-white'} rounded-2xl shadow-xl`}>
        <h2 className={`text-2xl font-bold mb-6 flex items-center gap-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
          <Send size={24} className="text-blue-400" /> Configuración de Telegram
        </h2>
        
        <div className="space-y-4">
          <div>
            <label className={`block text-sm mb-1 flex items-center gap-2 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}><Phone size={14}/> Número de Teléfono</label>
            <input 
              type="text" 
              value={phone}
              onChange={e => setPhone(e.target.value)}
              className={`w-full border rounded-lg px-4 py-2 ${isDarkMode ? 'bg-[#1a1a1a] border-[#333] text-white' : 'bg-gray-100 border-gray-300 text-gray-900'}`}
              placeholder="+34600000000"
            />
            <p className={`text-xs mt-1 ${isDarkMode ? 'text-gray-500' : 'text-gray-500'}`}>Las credenciales API se cargan desde config.json</p>
          </div>

          <button 
            onClick={handleLogin}
            disabled={isLoading}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-xl transition-colors disabled:opacity-50"
          >
            {isLoading ? 'Conectando...' : 'Conectar'}
          </button>
          
          {statusMsg && <p className="text-red-400 text-sm mt-2">{statusMsg}</p>}
        </div>
      </div>
    );
  }

  if (step === 'code') {
    return (
      <div className={`max-w-md mx-auto p-6 ${isDarkMode ? 'bg-[#242424]' : 'bg-white'} rounded-2xl shadow-xl text-center`}>
        <h2 className={`text-xl font-bold mb-4 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Introduce el Código</h2>
        <p className={`mb-6 text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>Hemos enviado un código a tu app de Telegram.</p>
        
        <input 
          type="text" 
          value={code}
          onChange={e => setCode(e.target.value)}
          className={`w-full border rounded-lg px-4 py-3 text-center text-2xl tracking-widest mb-6 ${isDarkMode ? 'bg-[#1a1a1a] border-[#333] text-white' : 'bg-gray-100 border-gray-300 text-gray-900'}`}
          placeholder="12345"
        />

        <button 
          onClick={submitCode}
          disabled={isLoading}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-xl transition-colors disabled:opacity-50"
        >
          {isLoading ? 'Verificando...' : 'Enviar Código'}
        </button>
        {statusMsg && <p className="text-red-400 text-sm mt-2">{statusMsg}</p>}
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <div></div>
        
        <div className={`flex rounded-lg p-1 ${isDarkMode ? 'bg-[#333]' : 'bg-gray-200'}`}>
             <button 
               onClick={() => {
                 setActiveCategory('channel');
                 setSearchQuery('');
               }}
               className={`px-4 py-1 rounded-md text-sm font-medium transition-colors ${activeCategory === 'channel' ? (isDarkMode ? 'bg-[#444] text-white shadow' : 'bg-white text-gray-900 shadow') : (isDarkMode ? 'text-gray-400 hover:text-white' : 'text-gray-600 hover:text-gray-900')}`}
             >
               Canales
             </button>
             <button 
               onClick={() => {
                 setActiveCategory('event');
                 setSearchQuery('');
               }}
               className={`px-4 py-1 rounded-md text-sm font-medium transition-colors ${activeCategory === 'event' ? (isDarkMode ? 'bg-[#444] text-white shadow' : 'bg-white text-gray-900 shadow') : (isDarkMode ? 'text-gray-400 hover:text-white' : 'text-gray-600 hover:text-gray-900')}`}
             >
               Eventos
             </button>
             <button 
               onClick={() => {
                 setActiveCategory('favorites');
                 setSearchQuery('');
               }}
               className={`px-4 py-1 rounded-md text-sm font-medium transition-colors flex items-center gap-1 ${activeCategory === 'favorites' ? (isDarkMode ? 'bg-[#444] text-white shadow' : 'bg-white text-gray-900 shadow') : (isDarkMode ? 'text-gray-400 hover:text-white' : 'text-gray-600 hover:text-gray-900')}`}
             >
               <Star size={14} /> Favoritos {favoriteMatches.length > 0 && `(${favoriteMatches.length})`}
             </button>
        </div>

        <button 
          onClick={fetchChannels}
          disabled={isLoading}
          className={`p-2 rounded-lg transition-colors ${isDarkMode ? 'bg-[#333] hover:bg-[#444]' : 'bg-gray-200 hover:bg-gray-300'} ${isDarkMode ? 'text-white' : 'text-gray-700'}`}
          title="Actualizar"
        >
          <RefreshCw size={20} className={isLoading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Search bar and layout/sort controls - only show for channel and event tabs */}
      {activeCategory !== 'favorites' && (
        <div className="mb-6 space-y-4">
          <div className="flex gap-4">
            <div className="flex-1 relative">
              <Search className={`absolute left-3 top-1/2 transform -translate-y-1/2 ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`} size={18} />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Buscar canales..."
                className={`w-full border rounded-xl pl-10 pr-4 py-3 focus:outline-none focus:border-blue-500 transition-colors ${isDarkMode ? 'bg-[#242424] border-[#333] text-white' : 'bg-white border-gray-300 text-gray-900'}`}
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className={`absolute right-3 top-1/2 transform -translate-y-1/2 ${isDarkMode ? 'text-gray-500 hover:text-white' : 'text-gray-400 hover:text-gray-900'}`}
                >
                  ×
                </button>
              )}
            </div>
            
            {/* Layout toggle */}
            <div className={`flex rounded-lg ${isDarkMode ? 'bg-[#333]' : 'bg-gray-200'}`}>
              <button
                onClick={() => setLayout('grid')}
                className={`p-3 rounded-lg transition-colors ${layout === 'grid' ? (isDarkMode ? 'bg-[#444] text-white' : 'bg-white text-gray-900 shadow') : (isDarkMode ? 'text-gray-400 hover:text-white' : 'text-gray-600 hover:text-gray-900')}`}
                title="Vista de cuadrícula"
              >
                <LayoutGrid size={20} />
              </button>
              <button
                onClick={() => setLayout('list')}
                className={`p-3 rounded-lg transition-colors ${layout === 'list' ? (isDarkMode ? 'bg-[#444] text-white' : 'bg-white text-gray-900 shadow') : (isDarkMode ? 'text-gray-400 hover:text-white' : 'text-gray-600 hover:text-gray-900')}`}
                title="Vista de lista"
              >
                <List size={20} />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Loading spinner */}
      {(isLoading || isInitialLoading) && (
        <div className="flex flex-col items-center justify-center py-20">
          <Loader2 className={`w-10 h-10 animate-spin ${isDarkMode ? 'text-blue-400' : 'text-blue-600'}`} />
          <p className={`mt-4 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>Cargando canales...</p>
        </div>
      )}

      {!isLoading && !isInitialLoading && channels.length === 0 ? (
        <div className={`text-center py-20 ${isDarkMode ? 'text-gray-500' : 'text-gray-500'}`}>
          <p>Aún no se han encontrado streams.</p>
          <button onClick={fetchChannels} className="text-blue-400 mt-2 underline">Intentar escanear ahora</button>
        </div>
      ) : activeCategory === 'favorites' ? (
        // Favorites view
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {favoriteMatches.length === 0 ? (
            <div className={`col-span-full text-center py-10 ${isDarkMode ? 'text-gray-500' : 'text-gray-500'}`}>
              <p>No hay favoritos que coincidan con los canales actuales.</p>
              <p className={`text-sm mt-2 ${isDarkMode ? 'text-gray-500' : 'text-gray-500'}`}>Añade canales a favoritos desde las pestañas Canales o Eventos.</p>
            </div>
          ) : (
            favoriteMatches.map((item, idx) => (
              <div key={idx} className={`p-4 rounded-xl border transition-all group ${isDarkMode ? 'bg-[#242424] border-[#333] hover:border-yellow-500/50' : 'bg-white border-gray-200 hover:border-yellow-400'}`}>
                <div className="flex justify-between items-start mb-1">
                  <h3 className={`font-bold text-lg truncate flex-1 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{cleanChannelName(item.channel.name)}</h3>
                  <Star className="text-yellow-500 shrink-0" size={18} fill="currentColor" />
                </div>
                <p className={`text-xs mb-4 font-mono truncate ${isDarkMode ? 'text-gray-500' : 'text-gray-500'}`}>{item.channel.id}</p>
                
                <div className="flex gap-2">
                  <button 
                    onClick={() => playChannel(item.channel.id)}
                    className={`flex-1 py-2 rounded-lg flex items-center justify-center gap-2 transition-colors ${isDarkMode ? 'bg-[#1a1a1a] hover:bg-blue-600 hover:text-white text-gray-300' : 'bg-gray-100 hover:bg-blue-600 hover:text-white text-gray-700'}`}
                  >
                    <Play size={16} /> Reproducir
                  </button>
                  <button
                    onClick={() => removeFromFavorites(item.channel.name)}
                    className={`py-2 px-3 rounded-lg transition-colors ${isDarkMode ? 'bg-red-600/20 hover:bg-red-600 text-red-400 hover:text-white' : 'bg-red-100 hover:bg-red-600 text-red-600 hover:text-white'}`}
                    title="Eliminar de favoritos"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      ) : (
        // Regular channels/events view
        <div className={layout === 'grid' ? "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" : "flex flex-col gap-2"}>
          {filteredChannels.length === 0 && (
             <div className={layout === 'grid' ? `col-span-full text-center py-10 ${isDarkMode ? 'text-gray-500' : 'text-gray-500'}` : `text-center py-10 ${isDarkMode ? 'text-gray-500' : 'text-gray-500'}`}>
               {searchQuery ? 'No se encontraron canales que coincidan con la búsqueda.' : 'No se encontró contenido en esta categoría.'}
             </div>
          )}
          {filteredChannels.map((ch, idx) => (
            <div key={idx} className={`rounded-xl border transition-all group ${layout === 'list' ? 'p-3 flex items-center gap-4' : 'p-4'} ${isDarkMode ? 'bg-[#242424] border-[#333] hover:border-blue-500/50' : 'bg-white border-gray-200 hover:border-blue-400'}`}>
              {layout === 'grid' ? (
                <>
                  <div className="flex justify-between items-start mb-1">
                    <h3 className={`font-bold text-lg truncate flex-1 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{cleanChannelName(ch.name)}</h3>
                    <button
                      onClick={() => {
                        if (isFavorite(ch.name)) {
                          removeFromFavorites(ch.name);
                        } else {
                          addToFavorites(ch.name);
                        }
                      }}
                      className={`transition-colors ${isFavorite(ch.name) ? 'text-yellow-500' : (isDarkMode ? 'text-gray-600 hover:text-yellow-500' : 'text-gray-400 hover:text-yellow-500')}`}
                      title={isFavorite(ch.name) ? 'Eliminar de favoritos' : 'Añadir a favoritos'}
                    >
                      <Star size={18} fill={isFavorite(ch.name) ? 'currentColor' : 'none'} />
                    </button>
                  </div>
                  <p className={`text-xs mb-4 font-mono truncate ${isDarkMode ? 'text-gray-500' : 'text-gray-500'}`}>{ch.id}</p>
                  
                  <button 
                    onClick={() => playChannel(ch.id)}
                    className={`w-full py-2 rounded-lg flex items-center justify-center gap-2 transition-colors ${isDarkMode ? 'bg-[#1a1a1a] hover:bg-blue-600 hover:text-white text-gray-300' : 'bg-gray-100 hover:bg-blue-600 hover:text-white text-gray-700'}`}
                  >
                    <Play size={16} /> Reproducir Ahora
                  </button>
                </>
              ) : (
                <>
                  <div className="flex-1 min-w-0">
                    <h3 className={`font-bold truncate ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{cleanChannelName(ch.name)}</h3>
                    <p className={`text-xs font-mono truncate ${isDarkMode ? 'text-gray-500' : 'text-gray-500'}`}>{ch.id}</p>
                  </div>
                  <button
                    onClick={() => {
                      if (isFavorite(ch.name)) {
                        removeFromFavorites(ch.name);
                      } else {
                        addToFavorites(ch.name);
                      }
                    }}
                    className={`transition-colors ${isFavorite(ch.name) ? 'text-yellow-500' : (isDarkMode ? 'text-gray-600 hover:text-yellow-500' : 'text-gray-400 hover:text-yellow-500')}`}
                    title={isFavorite(ch.name) ? 'Eliminar de favoritos' : 'Añadir a favoritos'}
                  >
                    <Star size={18} fill={isFavorite(ch.name) ? 'currentColor' : 'none'} />
                  </button>
                  <button 
                    onClick={() => playChannel(ch.id)}
                    className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg flex items-center gap-2 transition-colors whitespace-nowrap"
                  >
                    <Play size={16} /> Reproducir
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default TelegramTab;