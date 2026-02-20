import { fetchEPG, getCurrentPrograms } from './electron/epg.ts';
async function test() {
  await fetchEPG();
  const progs = getCurrentPrograms();
  console.log("Current programs playing:", progs.length);
  if (progs.length > 0) {
    console.log("Sample:", progs[0]);
  }
}
test();
