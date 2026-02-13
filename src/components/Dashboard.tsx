import { useState, useEffect } from 'react';
import ReactPlayer from 'react-player';
import { Play, ExternalLink, Copy, Tv } from 'lucide-react';

interface DashboardProps {
  initialStreamId?: string;
}

const Dashboard = ({ initialStreamId }: DashboardProps) => {
  const Player = ReactPlayer as any;
  const [streamId, setStreamId] = useState(initialStreamId || '');
  const [isPlaying, setIsPlaying] = useState(false);
  const [streamUrl, setStreamUrl] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (initialStreamId) {
        setStreamId(initialStreamId);
        // Clean and play
        const cleanId = initialStreamId.replace('acestream://', '').trim();
        setTimeout(() => handlePlay(cleanId), 100);
    }
  }, [initialStreamId]);

  const handlePlay = async (overrideId?: string) => {
    // If called via button click, overrideId is undefined (event object)
    // If called via effect, it is a string
    const targetId = (typeof overrideId === 'string' ? overrideId : streamId);
    
    if (!targetId) return;
    setLoading(true);
    setError('');
    setIsPlaying(false);

    // Sanitize ID: Remove 'acestream://' if present
    const cleanId = targetId.replace('acestream://', '').trim();

    try {
      if (!window.electronAPI) {
        throw new Error('Electron API not available');
      }
      const url = await window.electronAPI.getStreamUrl(cleanId);
      console.log('Stream URL:', url);
      setStreamUrl(url);
      
      // Give the engine a moment to resolve the stream (Ace Stream takes time)
      setTimeout(() => {
        setIsPlaying(true);
        setLoading(false);
      }, 2000); 

    } catch (err: any) {
      console.error('Play Error:', err);
      setError(`Failed to get stream URL: ${err.message || err}`);
      setLoading(false);
    }
  };

  const openVLC = async () => {
    if (!streamUrl && !streamId) return;
    const url = streamUrl || await window.electronAPI.getStreamUrl(streamId);
    await window.electronAPI.openVlc(url);
  };

  return (
    <div className="max-w-4xl mx-auto">
      <h2 className="text-3xl font-bold mb-6 flex items-center gap-3">
        <Tv className="text-blue-500" />
        Stream Player
      </h2>

      {/* Input Section */}
      <div className="bg-[#242424] p-6 rounded-2xl mb-8 shadow-lg">
        <label className="block text-sm text-gray-400 mb-2">Ace Stream ID or Magnet Link</label>
        <div className="flex gap-3">
          <input 
            type="text" 
            value={streamId}
            onChange={(e) => setStreamId(e.target.value)}
            placeholder="e.g. 23894723847238947..."
            className="flex-1 bg-[#1a1a1a] border border-[#333] rounded-xl px-4 py-3 focus:outline-none focus:border-blue-500 text-white transition-colors"
          />
          <button 
            onClick={() => handlePlay()}
            disabled={loading}
            className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-xl font-medium transition-colors flex items-center gap-2 disabled:opacity-50"
          >
            {loading ? 'Loading...' : <><Play size={18} /> Play</>}
          </button>
        </div>
        {error && <p className="text-red-500 mt-2 text-sm">{error}</p>}
      </div>

      {/* Player Section */}
      {isPlaying && (
        <div className="bg-black rounded-2xl overflow-hidden shadow-2xl aspect-video relative group">
           <Player 
             url={streamUrl} 
             playing={true}
             controls={true}
             width="100%"
             height="100%"
             onError={(e: any) => {
               console.error('Player Error:', e);
               setError('Playback error. Try opening in VLC.');
             }}
           />
           
           {/* Overlay Controls */}
           <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity">
              <button 
                onClick={openVLC}
                className="bg-black/50 backdrop-blur-md p-2 rounded-lg text-white hover:bg-white/20 transition-colors"
                title="Open in VLC"
              >
                <ExternalLink size={20} />
              </button>
           </div>
        </div>
      )}

      {/* Empty State / Hints */}
      {!isPlaying && !loading && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-[#242424] p-6 rounded-2xl border border-[#333] hover:border-[#444] transition-colors cursor-pointer" onClick={openVLC}>
            <div className="w-12 h-12 bg-orange-500/10 rounded-full flex items-center justify-center mb-4">
              <ExternalLink className="text-orange-500" size={24} />
            </div>
            <h3 className="text-xl font-semibold mb-2">Open External</h3>
            <p className="text-gray-400 text-sm">Use VLC or another player for better compatibility with raw streams.</p>
          </div>

           <div className="bg-[#242424] p-6 rounded-2xl border border-[#333]">
            <div className="w-12 h-12 bg-green-500/10 rounded-full flex items-center justify-center mb-4">
              <Copy className="text-green-500" size={24} />
            </div>
            <h3 className="text-xl font-semibold mb-2">From Clipboard</h3>
            <p className="text-gray-400 text-sm">Paste directly from your clipboard to start watching instantly.</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;
