const createRequire = require('module').createRequire;
const factory = require('chromecasts');
const cast = factory();

console.log("Buscando chromecasts en la red local... (espera 5s)");
cast.on('update', player => {
  console.log('¡Encontrado!: ', player.name, 'en', player.host);
});

setTimeout(() => {
  console.log("Búsqueda finalizada.");
  process.exit(0);
}, 5000);
