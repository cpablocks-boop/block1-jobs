// cli-runner.js
const { MobileSessionRunner } = require('./mobile-session-runner');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(query) {
  return new Promise(resolve => rl.question(query, resolve));
}

async function main() {
  console.log(`
╔═══════════════════════════════════════════╗
║     CPA Funnel Mobile Automation Suite     ║
║            with Warm-up Sessions           ║
╚═══════════════════════════════════════════╝
  `);

  console.log('📋 Configuration:');
  console.log('  • Each session: 15 minutes');
  console.log('  • Warm-up: 12 minutes (visiting US sites)');
  console.log('  • Funnel: 3 minutes');
  console.log('  • Proxy rotates every 15 minutes');
  console.log('  • Mobile viewport with touch events\n');

  // Get number of sessions
  const sessionCount = await question('How many sessions to run? (1-100): ');
  const sessions = Math.min(Math.max(parseInt(sessionCount) || 1, 1), 100);

  // Get run mode
  console.log('\nRun modes:');
  console.log('  1. Sequential (respects proxy rotation)');
  console.log('  2. Parallel batches (faster but may conflict with proxy)');
  
  const mode = await question('Select mode (1 or 2): ');
  const runParallel = mode === '2';

  // Warm-up options
  const skipWarmup = await question('\nSkip warm-up for testing? (y/N): ');
  const doWarmup = skipWarmup.toLowerCase() !== 'y';

  rl.close();

  // Configure environment
  process.env.SESSIONS = sessions.toString();
  process.env.DO_WARMUP = doWarmup.toString();
  process.env.USE_DEFAULT_PROXY = 'true';

  console.log(`\n🚀 Starting ${sessions} session(s) in ${runParallel ? 'parallel' : 'sequential'} mode`);
  
  if (runParallel) {
    // Run in batches to respect proxy
    const batchSize = 5; // Adjust based on proxy capacity
    const batches = Math.ceil(sessions / batchSize);
    
    for (let batch = 0; batch < batches; batch++) {
      const batchStart = batch * batchSize;
      const batchEnd = Math.min(batchStart + batchSize, sessions);
      const batchSessions = batchEnd - batchStart;
      
      console.log(`\n📦 Batch ${batch + 1}/${batches}: Running ${batchSessions} sessions`);
      
      const promises = [];
      for (let i = batchStart; i < batchEnd; i++) {
        const runner = new MobileSessionRunner();
        runner.sessions = 1;
        promises.push(runner.runSession(i));
      }
      
      await Promise.all(promises);
      
      if (batch < batches - 1) {
        console.log('⏳ Waiting for proxy rotation...');
        await new Promise(resolve => setTimeout(resolve, 15 * 60 * 1000));
      }
    }
  } else {
    // Sequential execution
    const runner = new MobileSessionRunner();
    await runner.run();
  }
  
  console.log('\n✅ All sessions completed!');
  process.exit(0);
}

if (require.main === module) {
  main().catch(error => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  });
}

module.exports = { main };
