const ChromecastAPI = require('chromecast-api');
const client = new ChromecastAPI();

console.log("Searching for devices...");
client.on('device', function (device) {
  console.log('Found:', device.friendlyName, device.host);
});

setTimeout(() => {
  console.log("Done.");
  process.exit();
}, 5000);
