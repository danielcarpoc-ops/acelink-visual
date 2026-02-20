import https from 'https';

const EPG_URL = 'https://raw.githubusercontent.com/davidmuma/EPG_dobleM/master/guiatv.xml';

interface Program {
  title: string;
  start: number;
  stop: number;
}

interface ChannelInfo {
  names: string[];
  programs: Program[];
}

let epgData: Map<string, ChannelInfo> = new Map();
let lastFetch = 0;
let isFetching = false;

function parseDateStr(str: string): number {
  // 20260220075000 +0100
  if (!str) return 0;
  const y = parseInt(str.substring(0, 4), 10);
  const m = parseInt(str.substring(4, 6), 10) - 1;
  const d = parseInt(str.substring(6, 8), 10);
  const h = parseInt(str.substring(8, 10), 10);
  const min = parseInt(str.substring(10, 12), 10);
  const s = parseInt(str.substring(12, 14), 10);
  const offsetDir = str.substring(15, 16);
  const offsetH = parseInt(str.substring(16, 18), 10);
  const offsetM = parseInt(str.substring(18, 20), 10);
  
  let date = Date.UTC(y, m, d, h, min, s);
  const offsetMs = (offsetH * 60 + offsetM) * 60000;
  if (offsetDir === '+') {
    date -= offsetMs;
  } else {
    date += offsetMs;
  }
  return date;
}

export async function fetchEPG() {
  if (isFetching) return;
  const now = Date.now();
  if (now - lastFetch < 3600000 && epgData.size > 0) return; // Cache for 1 hour

  isFetching = true;
  console.log('[EPG] Fetching EPG data...');
  
  try {
    const xml = await new Promise<string>((resolve, reject) => {
      https.get(EPG_URL, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`Status: ${res.statusCode}`));
          return;
        }
        let data = '';
        res.setEncoding('utf8');
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve(data));
      }).on('error', reject);
    });

    const newEpgData = new Map<string, ChannelInfo>();

    // Parse Channels
    const channelRegex = /<channel id="([^"]+)">(.*?)<\/channel>/gs;
    const displayNameRegex = /<display-name[^>]*>(.*?)<\/display-name>/g;
    
    let match;
    while ((match = channelRegex.exec(xml)) !== null) {
      const id = match[1];
      const inner = match[2];
      const names = [];
      let nameMatch;
      while ((nameMatch = displayNameRegex.exec(inner)) !== null) {
        names.push(nameMatch[1].trim());
      }
      newEpgData.set(id, { names, programs: [] });
    }

    // Parse Programs
    const programRegex = /<programme start="([^"]+)" stop="([^"]+)" channel="([^"]+)">(.*?)<\/programme>/gs;
    const titleRegex = /<title[^>]*>(.*?)<\/title>/;
    
    while ((match = programRegex.exec(xml)) !== null) {
      const startStr = match[1];
      const stopStr = match[2];
      const channelId = match[3];
      const inner = match[4];
      
      const titleMatch = titleRegex.exec(inner);
      if (titleMatch && newEpgData.has(channelId)) {
        const start = parseDateStr(startStr);
        const stop = parseDateStr(stopStr);
        // Only keep programs that end in the future or today
        if (stop > now - 86400000) {
          newEpgData.get(channelId)!.programs.push({
            title: titleMatch[1].replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1').trim(),
            start,
            stop
          });
        }
      }
    }

    epgData = newEpgData;
    lastFetch = now;
    console.log(`[EPG] Parsed ${epgData.size} channels successfully.`);
  } catch (error) {
    console.error('[EPG] Failed to fetch or parse EPG:', error);
  } finally {
    isFetching = false;
  }
}

export function getCurrentPrograms() {
  const now = Date.now();
  const current = [];

  for (const [id, info] of epgData.entries()) {
    const active = info.programs.find(p => p.start <= now && p.stop > now);
    if (active) {
      current.push({
        id,
        names: info.names,
        title: active.title,
        start: active.start,
        stop: active.stop
      });
    }
  }
  return current;
}
