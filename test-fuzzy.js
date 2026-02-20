function normalizeForEpgMatch(name) {
  if (!name) return '';
  let s = name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  s = s.replace(/^(movistar|m\+|m\.|m\s+)/, '');
  s = s.replace(/\b(hd|fhd|uhd|4k|1080p|1080|720p|720)\b/g, '');
  s = s.replace(/[^\w]/g, '');
  return s;
}

const tgNames = ["DAZN 1 FHD", "DAZN 2 FHD", "M+ Liga de Campeones 1080p"];
const epgNamesList = [
  ["DAZN 1", "DAZN 1 FHD", "DAZN 1 HD"],
  ["DAZN 2", "DAZN 2 HD"],
  ["M+ Liga de Campeones", "Movistar Liga de Campeones"]
];

tgNames.forEach(tg => {
  const normTg = normalizeForEpgMatch(tg);
  const match = epgNamesList.find(epgNames => epgNames.some(epg => normalizeForEpgMatch(epg) === normTg));
  console.log(`${tg}  ->  ${match ? match[0] : 'None'} (normalized: ${normTg})`);
});
