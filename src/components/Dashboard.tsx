import { useState, useEffect, useRef } from 'react';
import { Play, ExternalLink, Tv } from 'lucide-react';
import Hls from 'hls.js';

interface DashboardProps {
  initialStreamId?: string;
}

const Dashboard = ({ initialStreamId }: DashboardProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [streamId, setStreamId] = useState(initialStreamId || '');
  const [isPlaying, setIsPlaying] = useState(false);
  const [streamUrl, setStreamUrl] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string>('');

  useEffect(() => {
    if (initialStreamId) {
        setStreamId(initialStreamId);
        const cleanId = initialStreamId.replace('acestream://', '').trim();
        setTimeout(() => handlePlay(cleanId), 100);
    }
  }, [initialStreamId]);

  // Initialize HLS player when stream URL changes
  useEffect(() => {
    if (isPlaying && streamUrl && videoRef.current) {
      // Clean up previous HLS instance
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }

      const video = videoRef.current;

      if (Hls.isSupported()) {
        console.log('HLS.js is supported, creating player...');
        
        hlsRef.current = new Hls({
          debug: false,
          enableWorker: true,
          lowLatencyMode: true,
          maxBufferLength: 30,
          maxMaxBufferLength: 60,
        });

        hlsRef.current.loadSource(streamUrl);
        hlsRef.current.attachMedia(video);

        hlsRef.current.on(Hls.Events.MANIFEST_PARSED, () => {
          console.log('HLS manifest parsed, starting playback...');
          setStatus('Cargando...');
          video.play().catch(err => {
            console.log('Auto-play prevented:', err);
            setStatus('Pulsa play para iniciar');
          });
        });

        hlsRef.current.on(Hls.Events.ERROR, (event, data) => {
          console.error('HLS Error:', event, data);
          
          if (data.fatal) {
            switch (data.type) {
              case Hls.ErrorTypes.NETWORK_ERROR:
                setStatus('Error de red - reintentando...');
                hlsRef.current?.startLoad();
                break;
              case Hls.ErrorTypes.MEDIA_ERROR:
                setStatus('Error de medios - recuperando...');
                hlsRef.current?.recoverMediaError();
                break;
              default:
                setStatus('Error fatal - usa VLC');
                setError('Error en el stream. Intenta abrirlo en VLC para mejor compatibilidad.');
                break;
            }
          }
        });

        hlsRef.current.on(Hls.Events.FRAG_LOADED, () => {
          setStatus('Reproduciendo');
        });

      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        // Native HLS support (Safari)
        console.log('Using native HLS support');
        video.src = streamUrl;
        setStatus('Reproducción nativa');
      } else {
        setError('Tu navegador no soporta la reproducción HLS');
        setStatus('No soportado');
      }
    }

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [isPlaying, streamUrl]);

  const handlePlay = async (overrideId?: string) => {
    const targetId = (typeof overrideId === 'string' ? overrideId : streamId);
    
    if (!targetId) return;
    setLoading(true);
    setError('');
    setStatus('Inicializando...');
    setIsPlaying(false);

    const cleanId = targetId.replace('acestream://', '').trim();

    try {
      if (!window.electronAPI) {
        throw new Error('API de Electron no disponible');
      }
      
      // Get proxy URL - we'll use the manifest endpoint for HLS
      const proxyUrl = await window.electronAPI.getProxyUrl(cleanId);
      // Replace the URL to use manifest.m3u8 instead of getstream
      const hlsUrl = proxyUrl.replace('/stream?', '/manifest.m3u8?');
      console.log('HLS Stream URL:', hlsUrl);
      setStreamUrl(hlsUrl);
      
      // Wait for engine to buffer
      setStatus('Esperando al motor de Ace Stream...');
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      setIsPlaying(true);
      setLoading(false);

    } catch (err: any) {
      console.error('Play Error:', err);
      setError(`Error al obtener el stream: ${err.message}`);
      setLoading(false);
      setStatus('Error');
    }
  };

  const openVLC = async () => {
    if (!streamId) return;
    const url = await window.electronAPI.getStreamUrl(streamId);
    await window.electronAPI.openVlc(url);
  };

  return (
    <div className="max-w-4xl mx-auto">
      <h2 className="text-3xl font-bold mb-6 flex items-center gap-3">
        <Tv className="text-blue-500" />
        Reproductor de Streams
      </h2>

      {/* Input Section */}
      <div className="bg-[#242424] p-6 rounded-2xl mb-8 shadow-lg">
        <label className="block text-sm text-gray-400 mb-2">ID de Ace Stream o Enlace Magnet</label>
        <div className="flex gap-3">
          <input 
            type="text" 
            value={streamId}
            onChange={(e) => setStreamId(e.target.value)}
            placeholder="ej. 23894723847238947..."
            className="flex-1 bg-[#1a1a1a] border border-[#333] rounded-xl px-4 py-3 focus:outline-none focus:border-blue-500 text-white transition-colors"
          />
          <button 
            onClick={() => handlePlay()}
            disabled={loading}
            className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-xl font-medium transition-colors flex items-center gap-2 disabled:opacity-50"
          >
            {loading ? 'Cargando...' : <><Play size={18} /> Reproducir</>}
          </button>
        </div>
        
        {error && (
          <div className="mt-3 p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
            <p className="text-red-400 text-sm mb-2">{error}</p>
            <button 
              onClick={openVLC}
              className="bg-orange-600 hover:bg-orange-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
            >
              <ExternalLink size={16} />
              Abrir en VLC
            </button>
          </div>
        )}
      </div>

      {/* Player Section */}
      {isPlaying && (
        <div className="bg-black rounded-2xl overflow-hidden shadow-2xl aspect-video relative group">
          <video
            ref={videoRef}
            controls
            playsInline
            muted
            className="w-full h-full"
            style={{ objectFit: 'contain' }}
          />
          
          {/* Status overlay */}
          {status && status !== 'Reproduciendo' && (
            <div className="absolute bottom-4 left-4 bg-black/70 px-3 py-1 rounded-lg text-sm text-gray-300">
              {status}
            </div>
          )}
           
           {/* Overlay Controls */}
           <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity flex gap-2">
              <button 
                onClick={() => {
                  if (videoRef.current) {
                    videoRef.current.muted = !videoRef.current.muted;
                  }
                }}
                className="bg-black/50 backdrop-blur-md p-2 rounded-lg text-white hover:bg-white/20 transition-colors"
                title="Silenciar/Activar sonido"
              >
                {videoRef.current?.muted ? '🔇' : '🔊'}
              </button>
              <button 
                onClick={openVLC}
                className="bg-orange-600 hover:bg-orange-700 text-white p-2 rounded-lg transition-colors flex items-center gap-2 shadow-lg"
                title="Abrir en VLC"
              >
                <ExternalLink size={18} />
                <span className="text-sm font-medium">VLC</span>
              </button>
           </div>
        </div>
      )}

      {/* Empty State */}
      {!isPlaying && !loading && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div 
            className="bg-[#242424] p-6 rounded-2xl border border-[#333] hover:border-orange-500/50 transition-colors cursor-pointer group"
            onClick={openVLC}
          >
            <div className="w-12 h-12 bg-orange-500/10 rounded-full flex items-center justify-center mb-4 group-hover:bg-orange-500/20 transition-colors">
              <ExternalLink className="text-orange-500" size={24} />
            </div>
            <h3 className="text-xl font-semibold mb-2 text-orange-400">Abrir en VLC</h3>
            <p className="text-gray-400 text-sm">Mejor compatibilidad con todos los canales y códecs de Ace Stream.</p>
          </div>

          <div className="bg-[#242424] p-6 rounded-2xl border border-[#333]">
            <div className="w-12 h-12 bg-blue-500/10 rounded-full flex items-center justify-center mb-4">
              <Play className="text-blue-500" size={24} />
            </div>
            <h3 className="text-xl font-semibold mb-2">Reproductor Integrado</h3>
            <p className="text-gray-400 text-sm">Usa streaming HLS para mejor compatibilidad con el navegador.</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;
