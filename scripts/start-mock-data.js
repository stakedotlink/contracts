var child_process = require('child_process')

// Start hardhat, wait for `deploy-status-ready` status, then run mock data script

async function run() {
  const hardhatCP = child_process.spawn('npx', ['yarn', 'start'])
  hardhatCP.stdout.on('data', (data) => {
    console.log('hardhat process (' + hardhatCP.pid + '): ' + data)
    if (data.toString().includes('deploy-status-ready')) {
      child_process.spawn('npx', ['yarn', 'mock-data'])
    }
  })
  process.on('SIGINT', () => {
    process.kill(hardhatCP.pid)
    process.exit()
  })
  process.on('SIGTERM', () => {
    process.kill(hardhatCP.pid)
    process.exit()
  })
}

run().catch((error) => {
  console.log('error', error)
  console.error(error)
  process.exit(1)
})
