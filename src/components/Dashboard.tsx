import { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Play, 
  ExternalLink, 
  Tv, 
  RefreshCw, 
  PictureInPicture, 
  Monitor, 
  Settings, 
  Cast,
  Circle,
  Square
} from 'lucide-react';
import Hls from 'hls.js';

interface DashboardProps {
  initialStreamId?: string;
  isDarkMode: boolean;
}

// Cast SDK types
declare global {
  interface Window {
    cast?: any;
    chrome?: any;
  }
}

const Dashboard = ({ initialStreamId, isDarkMode }: DashboardProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const retryCountRef = useRef(0);
  const maxRetries = 3;
  
  const [streamId, setStreamId] = useState(initialStreamId || '');
  const [isPlaying, setIsPlaying] = useState(false);
  const [streamUrl, setStreamUrl] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string>('');
  const [retryCount, setRetryCount] = useState(0);
  const [isRetrying, setIsRetrying] = useState(false);
  
  // Quality selector state
  const [qualityLevels, setQualityLevels] = useState<{level: number; height: number; width: number}[]>([]);
  const [currentQuality, setCurrentQuality] = useState<number>(-1);
  const [showQualityMenu, setShowQualityMenu] = useState(false);
  
  // PiP and Always on Top state
  const [isPiPActive, setIsPiPActive] = useState(false);
  const [isAlwaysOnTop, setIsAlwaysOnTop] = useState(false);
  
  // Chromecast state
  const [isCastAvailable, setIsCastAvailable] = useState(false);
  const [isCasting, setIsCasting] = useState(false);
  const castContextRef = useRef<any>(null);
  
  // Recording state
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const recordingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (initialStreamId) {
        setStreamId(initialStreamId);
        const cleanId = initialStreamId.replace('acestream://', '').trim();
        setTimeout(() => handlePlay(cleanId), 100);
    }
  }, [initialStreamId]);

  // Initialize Cast SDK
  useEffect(() => {
    const initializeCast = () => {
      if (window.cast && window.chrome && window.chrome.cast) {
        const castContext = window.cast.framework.CastContext.getInstance();
        castContext.setOptions({
          receiverApplicationId: window.chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
          autoJoinPolicy: window.chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED
        });
        
        castContextRef.current = castContext;
        
        // Listen for cast state changes
        castContext.addEventListener(
          window.cast.framework.CastContextEventType.CAST_STATE_CHANGED,
          (event: any) => {
            setIsCasting(event.castState === window.cast.framework.CastState.CONNECTED);
          }
        );
        
        setIsCastAvailable(true);
      }
    };

    // Load Cast SDK
    if (!window.cast) {
      const script = document.createElement('script');
      script.src = 'https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1';
      script.onload = initializeCast;
      document.body.appendChild(script);
    } else {
      initializeCast();
    }
  }, []);

  // Retry function
  const handleRetry = useCallback(() => {
    if (retryCountRef.current < maxRetries) {
      retryCountRef.current += 1;
      setRetryCount(retryCountRef.current);
      setIsRetrying(true);
      setStatus(`Reconectando ${retryCountRef.current}/${maxRetries}...`);
      
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      
      setTimeout(() => {
        setIsRetrying(false);
        setStreamUrl(prev => prev + '?retry=' + Date.now());
      }, 2000);
    } else {
      setStatus('Error fatal - usa VLC');
      setError('No se pudo conectar después de varios intentos. Intenta abrirlo en VLC.');
    }
  }, []);

  // Initialize HLS player when stream URL changes
  useEffect(() => {
    if (isPlaying && streamUrl && videoRef.current) {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }

      const video = videoRef.current;
      retryCountRef.current = 0;
      setRetryCount(0);

      if (Hls.isSupported()) {
        hlsRef.current = new Hls({
          debug: false,
          enableWorker: true,
          lowLatencyMode: true,
          maxBufferLength: 30,
          maxMaxBufferLength: 60,
          startLevel: -1,
        });

        hlsRef.current.loadSource(streamUrl);
        hlsRef.current.attachMedia(video);

        hlsRef.current.on(Hls.Events.MANIFEST_PARSED, (_, data) => {
          setQualityLevels(data.levels.map((level, idx) => ({
            level: idx,
            height: level.height,
            width: level.width
          })));
          setCurrentQuality(hlsRef.current?.currentLevel ?? -1);
          
          setStatus('Cargando...');
          video.play().catch(err => {
            console.log('Auto-play prevented:', err);
            setStatus('Pulsa play para iniciar');
          });
        });

        hlsRef.current.on(Hls.Events.ERROR, (_, data) => {
          if (data.fatal) {
            switch (data.type) {
              case Hls.ErrorTypes.NETWORK_ERROR:
                if (retryCountRef.current < maxRetries && !isRetrying) {
                  handleRetry();
                } else {
                  setStatus('Error de red - usa VLC');
                }
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
          setRetryCount(0);
          retryCountRef.current = 0;
        });

        hlsRef.current.on(Hls.Events.LEVEL_SWITCHED, (_, data) => {
          setCurrentQuality(data.level);
        });

      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
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
  }, [isPlaying, streamUrl, isRetrying, handleRetry]);

  const handlePlay = async (overrideId?: string) => {
    const targetId = (typeof overrideId === 'string' ? overrideId : streamId);
    
    if (!targetId) return;
    setLoading(true);
    setError('');
    setStatus('Inicializando...');
    setIsPlaying(false);
    setRetryCount(0);
    retryCountRef.current = 0;

    const cleanId = targetId.replace('acestream://', '').trim();

    try {
      if (!window.electronAPI) {
        throw new Error('API de Electron no disponible');
      }
      
      const proxyUrl = await window.electronAPI.getProxyUrl(cleanId);
      const hlsUrl = proxyUrl.replace('/stream?', '/manifest.m3u8?');
      setStreamUrl(hlsUrl);
      
      setStatus('Esperando al motor de Ace Stream...');
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      setIsPlaying(true);
      setLoading(false);

    } catch (err: any) {
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

  const handleQualityChange = (level: number) => {
    if (hlsRef.current) {
      hlsRef.current.currentLevel = level;
      setCurrentQuality(level);
      setShowQualityMenu(false);
    }
  };

  const togglePiP = async () => {
    if (!videoRef.current) return;
    
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
        setIsPiPActive(false);
      } else {
        await videoRef.current.requestPictureInPicture();
        setIsPiPActive(true);
      }
    } catch (err) {
      console.error('PiP error:', err);
    }
  };

  useEffect(() => {
    const handleEnterPiP = () => setIsPiPActive(true);
    const handleLeavePiP = () => setIsPiPActive(false);
    
    videoRef.current?.addEventListener('enterpictureinpicture', handleEnterPiP);
    videoRef.current?.addEventListener('leavepictureinpicture', handleLeavePiP);
    
    return () => {
      videoRef.current?.removeEventListener('enterpictureinpicture', handleEnterPiP);
      videoRef.current?.removeEventListener('leavepictureinpicture', handleLeavePiP);
    };
  }, []);

  const toggleAlwaysOnTop = async () => {
    try {
      const newState = !isAlwaysOnTop;
      setIsAlwaysOnTop(newState);
      await window.electronAPI.setAlwaysOnTop?.(newState);
    } catch (err) {
      console.error('Always on Top error:', err);
    }
  };

  // Chromecast functions
  const toggleCast = async () => {
    if (!castContextRef.current) return;
    
    try {
      if (isCasting) {
        castContextRef.current.endCurrentSession(true);
      } else {
        await castContextRef.current.requestSession();
        
        // Load media after connecting
        if (streamUrl) {
          const mediaInfo = new window.chrome.cast.media.MediaInfo(streamUrl, 'application/x-mpegURL');
          const request = new window.chrome.cast.media.LoadRequest(mediaInfo);
          
          const session = castContextRef.current.getCurrentSession();
          await session.loadMedia(request);
        }
      }
    } catch (err) {
      console.error('Cast error:', err);
    }
  };

  // Recording functions
  const startRecording = async () => {
    if (!videoRef.current) return;
    
    try {
      const stream = (videoRef.current as any).captureStream();
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'video/webm;codecs=vp9,opus'
      });
      
      const chunks: Blob[] = [];
      
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunks.push(e.data);
        }
      };
      
      mediaRecorder.onstop = () => {
        const blob = new Blob(chunks, { type: 'video/webm' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `ace-recording-${new Date().toISOString().replace(/[:.]/g, '-')}.webm`;
        a.click();
        URL.revokeObjectURL(url);
      };
      
      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start(1000);
      setIsRecording(true);
      
      // Start timer
      setRecordingTime(0);
      recordingIntervalRef.current = setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);
      
    } catch (err) {
      console.error('Recording error:', err);
      alert('Error al iniciar la grabación');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      
      if (recordingIntervalRef.current) {
        clearInterval(recordingIntervalRef.current);
        recordingIntervalRef.current = null;
      }
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="max-w-4xl mx-auto">
      <h2 className={`text-3xl font-bold mb-6 flex items-center gap-3 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
        <Tv className="text-blue-500" />
        Reproductor de Streams
      </h2>

      {/* Input Section */}
      <div className={`p-6 rounded-2xl mb-8 shadow-lg ${isDarkMode ? 'bg-[#242424]' : 'bg-white'}`}>
        <label className={`block text-sm mb-2 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>ID de Ace Stream o Enlace Magnet</label>
        <div className="flex gap-3">
          <input 
            type="text" 
            value={streamId}
            onChange={(e) => setStreamId(e.target.value)}
            placeholder="ej. 23894723847238947..."
            className={`flex-1 border rounded-xl px-4 py-3 focus:outline-none focus:border-blue-500 transition-colors ${isDarkMode ? 'bg-[#1a1a1a] border-[#333] text-white' : 'bg-gray-100 border-gray-300 text-gray-900'}`}
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
          <div className={`mt-3 p-3 rounded-lg ${isDarkMode ? 'bg-red-500/10 border border-red-500/30' : 'bg-red-50 border border-red-200'}`}>
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
              {retryCount > 0 && retryCount < maxRetries && (
                <span className="ml-2 text-yellow-400">({retryCount}/{maxRetries})</span>
              )}
            </div>
          )}

          {/* Recording indicator */}
          {isRecording && (
            <div className="absolute top-4 left-4 flex items-center gap-2 bg-red-600 px-3 py-1 rounded-lg z-10">
              <Circle className="w-3 h-3 fill-white animate-pulse" />
              <span className="text-white text-sm font-medium">{formatTime(recordingTime)}</span>
            </div>
          )}

          {/* Retry button when error */}
          {retryCount >= maxRetries && !isRetrying && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/80 z-20">
              <div className="text-center">
                <p className="text-red-400 mb-4">No se pudo conectar al stream</p>
                <button 
                  onClick={handleRetry}
                  className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-xl font-medium transition-colors flex items-center gap-2"
                >
                  <RefreshCw size={18} />
                  Reintentar
                </button>
                <button 
                  onClick={openVLC}
                  className="ml-2 bg-orange-600 hover:bg-orange-700 text-white px-6 py-3 rounded-xl font-medium transition-colors flex items-center gap-2"
                >
                  <ExternalLink size={16} />
                  Abrir en VLC
                </button>
              </div>
            </div>
          )}
           
           {/* Overlay Controls */}
           <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity flex gap-2">
              {/* Recording Button */}
              <button 
                onClick={isRecording ? stopRecording : startRecording}
                className={`p-2 rounded-lg transition-colors ${isRecording ? 'bg-red-600 text-white animate-pulse' : 'bg-black/50 backdrop-blur-md text-white hover:bg-white/20'}`}
                title={isRecording ? 'Detener grabación' : 'Grabar'}
              >
                {isRecording ? <Square size={18} /> : <Circle size={18} className="fill-red-500" />}
              </button>

              {/* Chromecast */}
              {isCastAvailable && (
                <button 
                  onClick={toggleCast}
                  className={`p-2 rounded-lg transition-colors ${isCasting ? 'bg-blue-600 text-white' : 'bg-black/50 backdrop-blur-md text-white hover:bg-white/20'}`}
                  title={isCasting ? 'Desconectar Chromecast' : 'Enviar a TV (Chromecast)'}
                >
                  <Cast size={18} />
                </button>
              )}

              {/* Quality Selector */}
              {qualityLevels.length > 0 && (
                <div className="relative">
                  <button 
                    onClick={() => setShowQualityMenu(!showQualityMenu)}
                    className="bg-black/50 backdrop-blur-md p-2 rounded-lg text-white hover:bg-white/20 transition-colors"
                    title="Calidad del video"
                  >
                    <Settings size={18} />
                    <span className="ml-1 text-xs">{currentQuality === -1 ? 'Auto' : `${qualityLevels[currentQuality]?.height}p`}</span>
                  </button>
                  
                  {showQualityMenu && (
                    <div className="absolute top-full right-0 mt-2 bg-[#333] rounded-lg shadow-xl py-2 min-w-[120px] z-50">
                      <button
                        onClick={() => handleQualityChange(-1)}
                        className={`w-full px-4 py-2 text-left text-sm hover:bg-[#444] transition-colors ${currentQuality === -1 ? 'text-blue-400' : 'text-white'}`}
                      >
                        Auto
                      </button>
                      {qualityLevels.map((q) => (
                        <button
                          key={q.level}
                          onClick={() => handleQualityChange(q.level)}
                          className={`w-full px-4 py-2 text-left text-sm hover:bg-[#444] transition-colors ${currentQuality === q.level ? 'text-blue-400' : 'text-white'}`}
                        >
                          {q.height}p
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Picture-in-Picture */}
              <button 
                onClick={togglePiP}
                className={`p-2 rounded-lg transition-colors ${isPiPActive ? 'bg-blue-600 text-white' : 'bg-black/50 backdrop-blur-md text-white hover:bg-white/20'}`}
                title={isPiPActive ? 'Salir de PiP' : 'Picture-in-Picture'}
              >
                <PictureInPicture size={18} />
              </button>

              {/* Always on Top */}
              <button 
                onClick={toggleAlwaysOnTop}
                className={`p-2 rounded-lg transition-colors ${isAlwaysOnTop ? 'bg-green-600 text-white' : 'bg-black/50 backdrop-blur-md text-white hover:bg-white/20'}`}
                title={isAlwaysOnTop ? 'Desactivar Siempre Visible' : 'Siempre Visible'}
              >
                <Monitor size={18} />
              </button>
              
              {/* Mute */}
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

              {/* VLC */}
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
            className={`p-6 rounded-2xl border transition-colors cursor-pointer group ${isDarkMode ? 'bg-[#242424] border-[#333] hover:border-orange-500/50' : 'bg-white border-gray-200 hover:border-orange-400'}`}
            onClick={openVLC}
          >
            <div className={`w-12 h-12 rounded-full flex items-center justify-center mb-4 transition-colors ${isDarkMode ? 'bg-orange-500/10 group-hover:bg-orange-500/20' : 'bg-orange-100 group-hover:bg-orange-200'}`}>
              <ExternalLink className="text-orange-500" size={24} />
            </div>
            <h3 className={`text-xl font-semibold mb-2 ${isDarkMode ? 'text-orange-400' : 'text-orange-600'}`}>Abrir en VLC</h3>
            <p className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>Mejor compatibilidad con todos los canales y códecs de Ace Stream.</p>
          </div>

          <div className={`p-6 rounded-2xl border ${isDarkMode ? 'bg-[#242424] border-[#333]' : 'bg-white border-gray-200'}`}>
            <div className={`w-12 h-12 rounded-full flex items-center justify-center mb-4 ${isDarkMode ? 'bg-blue-500/10' : 'bg-blue-100'}`}>
              <Play className="text-blue-500" size={24} />
            </div>
            <h3 className={`text-xl font-semibold mb-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Reproductor Integrado</h3>
            <p className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>Usa streaming HLS para mejor compatibilidad con el navegador.</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;
