/* Quick check: does node-pty load under Electron's Node? */
process.env.ELECTRON_RUN_AS_NODE = '1'
try {
  const pty = require('node-pty')
  console.log('PTY_OK', typeof pty.spawn)
} catch (err) {
  console.error('PTY_FAIL', err && err.message ? err.message : err)
  process.exitCode = 1
}
