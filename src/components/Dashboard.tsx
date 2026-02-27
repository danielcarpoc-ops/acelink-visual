import { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Play, 
  ExternalLink, 
  RefreshCw, 
  PictureInPicture, 
  Monitor, 
  Cast,
  Circle,
  Square,
  Loader2
} from 'lucide-react';
import Hls from 'hls.js';

interface ChannelGroup {
  displayName: string;
  channels: { id: string; name: string }[];
}

interface DashboardProps {
  initialStreamId?: string;
  streamOrigin?: 'channel' | 'event' | 'favorites' | 'manual';
  channelGroup?: ChannelGroup;
  isDarkMode: boolean;
}

interface ChromecastDevice {
  name: string;
  host: string;
}

const Dashboard = ({ initialStreamId, streamOrigin, channelGroup, isDarkMode }: DashboardProps) => {
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
  // Track whether current playback was started from channels or manually
  const [playOrigin, setPlayOrigin] = useState<'channel' | 'event' | 'favorites' | 'manual'>('manual');
  const [isRetrying, setIsRetrying] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);
  
  // PiP and Always on Top state
  const [isPiPActive, setIsPiPActive] = useState(false);
  const [isAlwaysOnTop, setIsAlwaysOnTop] = useState(false);
  
  // Chromecast state
  const [chromecastDevices, setChromecastDevices] = useState<ChromecastDevice[]>([]);
  const [isCasting, setIsCasting] = useState(false);
  const [currentCastDevice, setCurrentCastDevice] = useState<string>('');
  const [showCastMenu, setShowCastMenu] = useState(false);
  const [isScanningCast, setIsScanningCast] = useState(false);
  
  // Recording state
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const recordingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Channel switcher state
  const [activeGroup, setActiveGroup] = useState<ChannelGroup | undefined>(undefined);
  const [activeChannelId, setActiveChannelId] = useState<string>('');


  useEffect(() => {
    if (initialStreamId) {
        setStreamId(initialStreamId);
        setPlayOrigin(streamOrigin || 'manual');
        setActiveGroup(channelGroup);
        setActiveChannelId(initialStreamId);
        const cleanId = initialStreamId.replace('acestream://', '').trim();
        setTimeout(() => handlePlay(cleanId), 100);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialStreamId]);

  // Initialize Chromecast
  useEffect(() => {
    // Get initial list of devices
    window.electronAPI?.chromecastGetDevices().then((devices: ChromecastDevice[]) => {
      setChromecastDevices(devices);
    });

    // Listen for device updates
    const unsubscribeDevices = window.electronAPI?.onChromecastDevicesUpdated((devices: ChromecastDevice[]) => {
      setChromecastDevices(devices);
    });

    // Listen for status changes
    const unsubscribeStatus = window.electronAPI?.onChromecastStatusChanged((status: { isCasting: boolean; device?: string }) => {
      setIsCasting(status.isCasting);
      if (status.device) {
        setCurrentCastDevice(status.device);
      }
    });

    return () => {
      // Cleanup listeners
      unsubscribeDevices?.();
      unsubscribeStatus?.();
    };
  }, []);

  // Retry function
  const handleRetry = useCallback(() => {
    if (retryCountRef.current < maxRetries) {
      retryCountRef.current += 1;
      setRetryCount(retryCountRef.current);
      setIsRetrying(true);
      setIsBuffering(true);
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

      // Quitar overlay cuando el vídeo muestra imagen real — definido aquí para poder limpiarlo
      const handlePlaying = () => setIsBuffering(false);
      video.addEventListener('playing', handlePlaying);

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

        hlsRef.current.on(Hls.Events.MANIFEST_PARSED, () => {
          setStatus('Cargando...');
          video.play().catch(err => {
            console.log('Auto-play prevented:', err);
            setStatus('Pulsa play para iniciar');
            setIsBuffering(false);
          });
        });

        hlsRef.current.on(Hls.Events.ERROR, (_, data) => {
          if (data.fatal) {
            setIsBuffering(false);
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

      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = streamUrl;
        setStatus('Reproducción nativa');
      } else {
        setError('Tu navegador no soporta la reproducción HLS');
        setStatus('No soportado');
      }

      return () => {
        video.removeEventListener('playing', handlePlaying);
        if (hlsRef.current) {
          hlsRef.current.destroy();
          hlsRef.current = null;
        }
      };
    }
  }, [isPlaying, streamUrl, isRetrying, handleRetry]);

  const handlePlay = async (overrideId?: string) => {
    const targetId = (typeof overrideId === 'string' ? overrideId : streamId);
    
    if (!targetId) return;
    if (typeof overrideId !== 'string') {
      setPlayOrigin('manual');
    }
    setLoading(true);
    setError('');
    setStatus('Conectando...');
    setIsPlaying(false);
    setIsBuffering(false);
    setRetryCount(0);
    retryCountRef.current = 0;

    const cleanId = targetId.replace('acestream://', '').trim();

    try {
      if (!window.electronAPI) {
        throw new Error('API de Electron no disponible');
      }
      
      const proxyUrl = await window.electronAPI.getProxyUrl(cleanId);
      const hlsUrl = proxyUrl.replace('/stream?', '/manifest.m3u8?');

      // Mostrar el player inmediatamente con overlay de buffering
      setLoading(false);
      setIsPlaying(true);
      setIsBuffering(true);
      setStatus('Esperando al motor de Ace Stream...');
      setStreamUrl(hlsUrl);

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      setError(`Error al obtener el stream: ${errorMessage}`);
      setLoading(false);
      setStatus('Error');
    }
  };

  const openVLC = async () => {
    if (!streamId) return;
    const url = await window.electronAPI.getStreamUrl(streamId);
    await window.electronAPI.openVlc(url);
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
    const video = videoRef.current;
    
    video?.addEventListener('enterpictureinpicture', handleEnterPiP);
    video?.addEventListener('leavepictureinpicture', handleLeavePiP);
    
    return () => {
      video?.removeEventListener('enterpictureinpicture', handleEnterPiP);
      video?.removeEventListener('leavepictureinpicture', handleLeavePiP);
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
  const handleScanCast = async () => {
    setIsScanningCast(true);
    try {
      const devices = await window.electronAPI?.chromecastScan();
      if (devices) {
        setChromecastDevices(devices);
      }
    } catch (err) {
      console.error('Scan error:', err);
    }
    // Set a timeout to clear the scanning state after 5 seconds
    setTimeout(() => {
      setIsScanningCast(false);
    }, 5000);
  };

  const toggleCast = async () => {
    if (isCasting) {
      try {
        await window.electronAPI?.chromecastStop();
        setIsCasting(false);
        setCurrentCastDevice('');
      } catch (err) {
        console.error('Cast stop error:', err);
      }
    } else {
      const newMenuState = !showCastMenu;
      setShowCastMenu(newMenuState);
      
      // If opening menu and no devices, auto-trigger scan
      if (newMenuState && chromecastDevices.length === 0) {
        handleScanCast();
      }
    }
  };

  const startCasting = async (deviceName: string) => {
    if (!streamUrl) return;
    
    try {
      const result = await window.electronAPI?.chromecastStart(deviceName, streamUrl);
      if (result?.success) {
        setIsCasting(true);
        setCurrentCastDevice(result.device);
      }
    } catch (err) {
      console.error('Cast start error:', err);
      setError(`Error al conectar con ${deviceName}`);
    }
    setShowCastMenu(false);
  };

  // Recording functions
  const startRecording = async () => {
    if (!videoRef.current) return;
    
    try {
      const stream = (videoRef.current as HTMLVideoElement & { captureStream(): MediaStream }).captureStream();
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

  // Build labels for channel switcher buttons, numbering duplicates
  // e.g. [FHD, FHD, FHD, HD] -> ["FHD 1", "FHD 2", "FHD 3", "HD"]
  const buildSwitcherLabels = (channels: { id: string; name: string }[]): string[] => {
    const QUALITY_TAGS = ['UHD', 'FHD', '4K', '1080p', '1080', '720p', '720', 'HD'];
    const extractQ = (name: string): string => {
      const upper = name.toUpperCase();
      for (const tag of QUALITY_TAGS) {
        if (new RegExp(`\\b${tag}\\b`, 'i').test(upper)) return tag.toUpperCase();
      }
      return '';
    };
    const qualities = channels.map(ch => extractQ(ch.name) || 'Enlace');
    // Count occurrences of each quality
    const counts: Record<string, number> = {};
    for (const q of qualities) counts[q] = (counts[q] || 0) + 1;
    // Assign numbered labels only when quality appears more than once
    const cursors: Record<string, number> = {};
    return qualities.map(q => {
      if (counts[q] > 1) {
        cursors[q] = (cursors[q] || 0) + 1;
        return `${q} ${cursors[q]}`;
      }
      return q;
    });
  };

  return (
    <div className="max-w-4xl mx-auto">
      <h2 className={`text-3xl font-bold mb-6 flex items-center gap-3 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
        <Play className="text-blue-500" />
        Reproductor de Streams
      </h2>

      {/* Input Section - Hide when playing */}
      {!isPlaying && (
        <div className={`p-6 rounded-2xl mb-8 shadow-lg ${isDarkMode ? 'bg-[#242424]' : 'bg-white'}`}>
          <label className={`block text-sm mb-2 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>ID de Ace Stream</label>
          <input 
            type="text" 
            value={streamId}
            onChange={(e) => setStreamId(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && streamId && handlePlay()}
            placeholder="ej. 23894723847238947..."
            className={`w-full border rounded-xl px-4 py-3 focus:outline-none focus:border-blue-500 transition-colors ${isDarkMode ? 'bg-[#1a1a1a] border-[#333] text-white' : 'bg-gray-100 border-gray-300 text-gray-900'}`}
          />
          
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
      )}

      {/* Back button - Show when playing or loading */}
      {(isPlaying || loading) && (
        <button 
          onClick={() => {
            setIsPlaying(false);
            setLoading(false);
            setIsBuffering(false);
            setStreamUrl('');
            setError('');
            setStatus('');
            setActiveGroup(undefined);
            setActiveChannelId('');
            if (hlsRef.current) {
              hlsRef.current.destroy();
              hlsRef.current = null;
            }
            // If played from manual input, stay on dashboard (show the input form again)
            // Otherwise go back to the originating tab/category
            if (playOrigin !== 'manual') {
              setStreamId('');
              window.dispatchEvent(new CustomEvent('go-to-channels', { detail: playOrigin }));
            }
          }}
          className="mb-4 bg-gray-600 hover:bg-gray-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
        >
          ← Volver
        </button>
      )}

      {/* Channel switcher - show when playing/loading from a group (not manual) */}
      {(isPlaying || loading) && playOrigin !== 'manual' && activeGroup && activeGroup.channels.length > 1 && (() => {
        const labels = buildSwitcherLabels(activeGroup.channels);
        return (
          <div className="mb-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`text-xs font-medium ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>
                {activeGroup.displayName}:
              </span>
              {activeGroup.channels.map((ch, i) => {
                const isActive = ch.id === activeChannelId;
                return (
                  <button
                    key={ch.id}
                    onClick={() => {
                      if (!isActive) {
                        setActiveChannelId(ch.id);
                        const cleanId = ch.id.replace('acestream://', '').trim();
                        handlePlay(cleanId);
                      }
                    }}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                      isActive
                        ? 'bg-blue-600 text-white'
                        : isDarkMode
                          ? 'bg-[#333] text-gray-300 hover:bg-[#444]'
                          : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                    }`}
                  >
                    <Play size={12} />
                    {labels[i]}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* Loading spinner — mismo recuadro que el player pero con overlay de carga */}
      {loading && (
        <div className="bg-black rounded-2xl overflow-hidden shadow-2xl aspect-video relative flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="w-10 h-10 animate-spin text-blue-400" />
            <p className="text-gray-300 text-sm">{status || 'Conectando...'}</p>
          </div>
        </div>
      )}

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
          
          {/* Buffering overlay — mientras HLS negocia el manifiesto */}
          {isBuffering && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 z-10">
              <Loader2 className="w-10 h-10 animate-spin text-blue-400" />
              <p className="mt-3 text-gray-300 text-sm">
                {(!status || status === 'Reproduciendo') ? 'Esperando al motor de Ace Stream...' : status}
              </p>
            </div>
          )}

          {/* Status overlay — visible cuando no está en buffering y hay algo que mostrar */}
          {!isBuffering && status && status !== 'Reproduciendo' && (
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
               <div className="relative">
                 <button 
                   onClick={toggleCast}
                   className={`p-2 rounded-lg transition-colors ${isCasting ? 'bg-blue-600 text-white' : 'bg-black/50 backdrop-blur-md text-white hover:bg-white/20'}`}
                   title={isCasting ? `Transmitiendo en ${currentCastDevice}` : 'Enviar a TV (Chromecast)'}
                 >
                   <Cast size={18} />
                 </button>
                 
                 {/* Chromecast Device Menu */}
                 {showCastMenu && chromecastDevices.length > 0 && (
                   <div className="absolute top-full right-0 mt-2 bg-[#333] rounded-lg shadow-xl py-2 min-w-[200px] z-50">
                     <div className="px-4 py-2 text-sm text-gray-400 border-b border-gray-600">
                       Selecciona dispositivo
                     </div>
                     {chromecastDevices.map((device) => (
                       <button
                         key={device.name}
                         onClick={() => startCasting(device.name)}
                         className="w-full px-4 py-2 text-left text-sm hover:bg-[#444] transition-colors text-white"
                       >
                         {device.name}
                       </button>
                     ))}
                     {/* Botón de Test (Mock) en DEV */}
                     {import.meta.env.DEV && (
                       <button
                         key="mock-device"
                         onClick={() => {
                            setIsCasting(true);
                            setCurrentCastDevice("Mock TV (Dev)");
                            setShowCastMenu(false);
                            console.log("Mock casting started to", streamUrl);
                         }}
                         className="w-full px-4 py-2 text-left text-sm hover:bg-[#444] transition-colors text-green-400 font-medium border-t border-gray-600 mt-1"
                       >
                         📺 Mock TV (Simulador)
                       </button>
                     )}
                   </div>
                 )}
                 
                 {showCastMenu && chromecastDevices.length === 0 && (
                   <div className="absolute top-full right-0 mt-2 bg-[#333] rounded-lg shadow-xl py-3 px-4 min-w-[220px] z-50">
                     {isScanningCast ? (
                       <div className="flex flex-col items-center gap-2">
                         <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin"></div>
                         <p className="text-sm text-gray-400">Buscando en red local...</p>
                       </div>
                     ) : (
                       <div className="flex flex-col items-center gap-3">
                         <p className="text-sm text-gray-400 text-center">No se han encontrado dispositivos Chromecast.</p>
                         <button 
                           onClick={handleScanCast}
                           className="w-full bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold py-2 rounded-lg transition-colors"
                         >
                           Volver a escanear
                         </button>
                         {/* Botón de Test (Mock) en DEV para estado vacío */}
                         {import.meta.env.DEV && (
                           <button
                             onClick={() => {
                                setIsCasting(true);
                                setCurrentCastDevice("Mock TV (Dev)");
                                setShowCastMenu(false);
                                console.log("Mock casting started to", streamUrl);
                             }}
                             className="w-full mt-2 border border-green-500 text-green-400 hover:bg-green-500 hover:text-white text-xs font-bold py-2 rounded-lg transition-colors"
                           >
                             📺 Usar Mock TV (Simulador)
                           </button>
                         )}
                       </div>
                     )}
                   </div>
                 )}
               </div>

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
          </div>

          <div 
            className={`p-6 rounded-2xl border transition-colors cursor-pointer group ${isDarkMode ? 'bg-[#242424] border-[#333] hover:border-blue-500/50' : 'bg-white border-gray-200 hover:border-blue-400'}`}
            onClick={() => streamId && handlePlay()}
          >
            <div className={`w-12 h-12 rounded-full flex items-center justify-center mb-4 transition-colors ${isDarkMode ? 'bg-blue-500/10 group-hover:bg-blue-500/20' : 'bg-blue-100 group-hover:bg-blue-200'}`}>
              <Play className="text-blue-500" size={24} />
            </div>
            <h3 className={`text-xl font-semibold mb-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>Reproductor Integrado</h3>
          </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;
