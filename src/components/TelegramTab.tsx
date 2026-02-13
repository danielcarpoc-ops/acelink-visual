import { useState, useEffect } from 'react';
import { Send, Phone, RefreshCw, Play, Star, Search, Trash2 } from 'lucide-react';

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
  getFavoriteMatches
}: TelegramTabProps) => {
  const [code, setCode] = useState('');
  const [statusMsg, setStatusMsg] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [phoneCodeHash, setPhoneCodeHash] = useState('');
  const [activeCategory, setActiveCategory] = useState<'channel' | 'event' | 'favorites'>('event');
  const [searchQuery, setSearchQuery] = useState('');

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

  // Filter channels based on category and search
  const filteredChannels = channels.filter(ch => {
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
  });

  // Get favorite matches
  const favoriteMatches = getFavoriteMatches();

  if (step === 'config') {
    return (
      <div className="max-w-2xl mx-auto p-6 bg-[#242424] rounded-2xl shadow-xl">
        <h2 className="text-2xl font-bold mb-6 flex items-center gap-2">
          <Send size={24} className="text-blue-400" /> Configuración de Telegram
        </h2>
        
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1 flex items-center gap-2"><Phone size={14}/> Número de Teléfono</label>
            <input 
              type="text" 
              value={phone}
              onChange={e => setPhone(e.target.value)}
              className="w-full bg-[#1a1a1a] border border-[#333] rounded-lg px-4 py-2 text-white"
              placeholder="+34600000000"
            />
            <p className="text-xs text-gray-500 mt-1">Las credenciales API se cargan desde config.json</p>
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
      <div className="max-w-md mx-auto p-6 bg-[#242424] rounded-2xl shadow-xl text-center">
        <h2 className="text-xl font-bold mb-4">Introduce el Código</h2>
        <p className="text-gray-400 mb-6 text-sm">Hemos enviado un código a tu app de Telegram.</p>
        
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
        
        <div className="flex bg-[#333] rounded-lg p-1">
             <button 
               onClick={() => {
                 setActiveCategory('channel');
                 setSearchQuery('');
               }}
               className={`px-4 py-1 rounded-md text-sm font-medium transition-colors ${activeCategory === 'channel' ? 'bg-[#444] text-white shadow' : 'text-gray-400 hover:text-white'}`}
             >
               Canales
             </button>
             <button 
               onClick={() => {
                 setActiveCategory('event');
                 setSearchQuery('');
               }}
               className={`px-4 py-1 rounded-md text-sm font-medium transition-colors ${activeCategory === 'event' ? 'bg-[#444] text-white shadow' : 'text-gray-400 hover:text-white'}`}
             >
               Eventos
             </button>
             <button 
               onClick={() => {
                 setActiveCategory('favorites');
                 setSearchQuery('');
               }}
               className={`px-4 py-1 rounded-md text-sm font-medium transition-colors flex items-center gap-1 ${activeCategory === 'favorites' ? 'bg-[#444] text-white shadow' : 'text-gray-400 hover:text-white'}`}
             >
               <Star size={14} /> Favoritos {favoriteMatches.length > 0 && `(${favoriteMatches.length})`}
             </button>
        </div>

        <button 
          onClick={fetchChannels}
          disabled={isLoading}
          className="p-2 bg-[#333] hover:bg-[#444] rounded-lg transition-colors"
          title="Actualizar"
        >
          <RefreshCw size={20} className={isLoading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Search bar - only show for channel and event tabs */}
      {activeCategory !== 'favorites' && (
        <div className="mb-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500" size={18} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar canales..."
              className="w-full bg-[#242424] border border-[#333] rounded-xl pl-10 pr-4 py-3 text-white focus:outline-none focus:border-blue-500 transition-colors"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-500 hover:text-white"
              >
                ×
              </button>
            )}
          </div>
        </div>
      )}

      {channels.length === 0 ? (
        <div className="text-center py-20 text-gray-500">
          <p>Aún no se han encontrado streams.</p>
          <button onClick={fetchChannels} className="text-blue-400 mt-2 underline">Intentar escanear ahora</button>
        </div>
      ) : activeCategory === 'favorites' ? (
        // Favorites view
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {favoriteMatches.length === 0 ? (
            <div className="col-span-full text-center py-10 text-gray-500">
              <p>No hay favoritos que coincidan con los canales actuales.</p>
              <p className="text-sm mt-2">Añade canales a favoritos desde las pestañas Canales o Eventos.</p>
            </div>
          ) : (
            favoriteMatches.map((item, idx) => (
              <div key={idx} className="bg-[#242424] p-4 rounded-xl border border-[#333] hover:border-yellow-500/50 transition-all group">
                <div className="flex justify-between items-start mb-1">
                  <h3 className="font-bold text-lg truncate flex-1">{cleanChannelName(item.channel.name)}</h3>
                  <Star className="text-yellow-500 shrink-0" size={18} fill="currentColor" />
                </div>
                <p className="text-xs text-gray-500 mb-4 font-mono truncate">{item.channel.id}</p>
                
                <div className="flex gap-2">
                  <button 
                    onClick={() => playChannel(item.channel.id)}
                    className="flex-1 bg-[#1a1a1a] hover:bg-blue-600 hover:text-white text-gray-300 py-2 rounded-lg flex items-center justify-center gap-2 transition-colors"
                  >
                    <Play size={16} /> Reproducir
                  </button>
                  <button
                    onClick={() => removeFromFavorites(item.channel.name)}
                    className="bg-red-600/20 hover:bg-red-600 text-red-400 hover:text-white py-2 px-3 rounded-lg transition-colors"
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
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredChannels.length === 0 && (
             <div className="col-span-full text-center py-10 text-gray-500">
               {searchQuery ? 'No se encontraron canales que coincidan con la búsqueda.' : 'No se encontró contenido en esta categoría.'}
             </div>
          )}
          {filteredChannels.map((ch, idx) => (
            <div key={idx} className="bg-[#242424] p-4 rounded-xl border border-[#333] hover:border-blue-500/50 transition-all group">
              <div className="flex justify-between items-start mb-1">
                <h3 className="font-bold text-lg truncate flex-1">{cleanChannelName(ch.name)}</h3>
                <button
                  onClick={() => {
                    if (isFavorite(ch.name)) {
                      removeFromFavorites(ch.name);
                    } else {
                      addToFavorites(ch.name);
                    }
                  }}
                  className={`transition-colors ${isFavorite(ch.name) ? 'text-yellow-500' : 'text-gray-600 hover:text-yellow-500'}`}
                  title={isFavorite(ch.name) ? 'Eliminar de favoritos' : 'Añadir a favoritos'}
                >
                  <Star size={18} fill={isFavorite(ch.name) ? 'currentColor' : 'none'} />
                </button>
              </div>
              <p className="text-xs text-gray-500 mb-4 font-mono truncate">{ch.id}</p>
              
              <button 
                onClick={() => playChannel(ch.id)}
                className="w-full bg-[#1a1a1a] hover:bg-blue-600 hover:text-white text-gray-300 py-2 rounded-lg flex items-center justify-center gap-2 transition-colors"
              >
                <Play size={16} /> Reproducir Ahora
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default TelegramTab;