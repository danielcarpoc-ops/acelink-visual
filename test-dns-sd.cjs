const { spawn } = require('child_process');

const proc = spawn('dns-sd', ['-B', '_googlecast._tcp']);
proc.stdout.on('data', data => console.log(data.toString()));
proc.stderr.on('data', data => console.error(data.toString()));

setTimeout(() => {
  proc.kill();
  console.log('Done');
}, 5000);
