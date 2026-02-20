import { fetchEPG, getCurrentPrograms } from './electron/epg.ts';

async function test() {
  await fetchEPG();
  const progs = getCurrentPrograms();
  const dazn = progs.filter(p => p.id.toLowerCase().includes('dazn'));
  console.log("DAZN programs:");
  dazn.forEach(p => console.log(`- ${p.id}: ${p.names.join(', ')} -> ${p.title}`));
}
test();
