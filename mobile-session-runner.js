// mobile-session-runner.js
const { chromium } = require('playwright');
const fs = require('fs').promises;
const path = require('path');

class MobileSessionRunner {
  constructor() {
    this.sessions = parseInt(process.env.SESSIONS || '1');
    this.warmupDuration = 12 * 60 * 1000; // 12 minutes
    this.sessionDuration = 15 * 60 * 1000; // 15 minutes
    this.funnelDuration = 3 * 60 * 1000;  // 3 minutes
    
    // Popular US websites for warm-up
    this.warmupSites = [
      { url: 'https://www.cnn.com', duration: 60000 },
      { url: 'https://www.usatoday.com', duration: 60000 },
      { url: 'https://www.weather.com', duration: 60000 },
      { url: 'https://www.espn.com', duration: 60000 },
      { url: 'https://www.reddit.com', duration: 60000 },
      { url: 'https://www.amazon.com', duration: 60000 },
      { url: 'https://www.youtube.com', duration: 60000 },
      { url: 'https://www.walmart.com', duration: 60000 },
      { url: 'https://www.target.com', duration: 60000 },
      { url: 'https://www.ebay.com', duration: 60000 },
      { url: 'https://www.nytimes.com', duration: 60000 },
      { url: 'https://www.foxnews.com', duration: 60000 }
    ];
    
    this.sessionResults = [];
  }

  async loadProfiles() {
    // Load user profiles
    const userData = await fs.readFile('User-Data.csv', 'utf8');
    this.userProfiles = this.parseCSV(userData);
    
    // Load device profiles
    const deviceData = await fs.readFile('android-device-profiles.csv', 'utf8');
    this.deviceProfiles = this.parseCSV(deviceData);
    
    console.log(`📊 Loaded ${this.userProfiles.length} user profiles`);
    console.log(`📱 Loaded ${this.deviceProfiles.length} device profiles`);
  }

  parseCSV(data) {
    const lines = data.split('\n').filter(line => line.trim());
    const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
    const profiles = [];
    
    for (let i = 1; i < lines.length; i++) {
      const values = this.parseCSVLine(lines[i]);
      if (values.length === headers.length) {
        const profile = {};
        headers.forEach((header, index) => {
          profile[header] = values[index];
        });
        profiles.push(profile);
      }
    }
    
    return profiles;
  }

  parseCSVLine(line) {
    const values = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"' && !inQuotes) {
        inQuotes = true;
      } else if (char === '"' && inQuotes) {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else if (char === ',' && !inQuotes) {
        values.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    values.push(current);
    return values.map(v => v.replace(/^"/, '').replace(/"$/, '').trim());
  }

  async humanizeScrolling(page) {
    // Simulate human scrolling patterns
    const scrollPatterns = [
      { distance: 300, duration: 1000 },
      { distance: -100, duration: 500 },
      { distance: 500, duration: 1500 },
      { distance: 200, duration: 800 },
      { distance: -50, duration: 300 }
    ];
    
    for (const pattern of scrollPatterns) {
      await page.evaluate(({ distance, duration }) => {
        return new Promise(resolve => {
          const start = window.pageYOffset;
          const startTime = Date.now();
          
          const scroll = () => {
            const elapsed = Date.now() - startTime;
            const progress = Math.min(elapsed / duration, 1);
            
            // Easing function for smooth scrolling
            const easeInOutQuad = t => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
            const currentPosition = start + (distance * easeInOutQuad(progress));
            
            window.scrollTo(0, currentPosition);
            
            if (progress < 1) {
              requestAnimationFrame(scroll);
            } else {
              resolve();
            }
          };
          
          scroll();
        });
      }, pattern);
      
      await page.waitForTimeout(Math.random() * 2000 + 1000);
    }
  }

  async humanizeTapping(page) {
    // Simulate random taps on the page (mobile behavior)
    const taps = Math.floor(Math.random() * 3) + 1;
    
    for (let i = 0; i < taps; i++) {
      const viewport = page.viewportSize();
      const x = Math.random() * viewport.width * 0.8 + viewport.width * 0.1;
      const y = Math.random() * viewport.height * 0.8 + viewport.height * 0.1;
      
      await page.mouse.click(x, y);
      await page.waitForTimeout(Math.random() * 2000 + 500);
    }
  }

  async performWarmup(page, sessionId) {
    console.log(`[Session ${sessionId}] 🔥 Starting 12-minute warm-up phase...`);
    const startTime = Date.now();
    
    // Shuffle warm-up sites
    const sites = [...this.warmupSites].sort(() => Math.random() - 0.5);
    
    for (const site of sites) {
      if (Date.now() - startTime >= this.warmupDuration) break;
      
      try {
        console.log(`[Session ${sessionId}] 🌐 Visiting ${site.url}...`);
        await page.goto(site.url, { 
          waitUntil: 'domcontentloaded',
          timeout: 30000 
        });
        
        // Humanize interactions
        await this.humanizeScrolling(page);
        await this.humanizeTapping(page);
        
        // Random reading time
        const readTime = Math.random() * 20000 + 40000; // 40-60 seconds
        await page.waitForTimeout(readTime);
        
        // Occasionally click on random links
        if (Math.random() > 0.7) {
          const links = await page.$$('a[href^="http"]:visible');
          if (links.length > 0) {
            const randomLink = links[Math.floor(Math.random() * Math.min(links.length, 10))];
            try {
              await randomLink.click();
              await page.waitForTimeout(5000);
              await page.goBack();
            } catch (e) {
              // Ignore navigation errors
            }
          }
        }
        
      } catch (error) {
        console.log(`[Session ${sessionId}] ⚠️ Error visiting ${site.url}: ${error.message}`);
      }
    }
    
    const elapsed = Date.now() - startTime;
    console.log(`[Session ${sessionId}] ✅ Warm-up completed (${Math.round(elapsed / 1000)}s)`);
  }

  async runSession(sessionId) {
    const sessionStartTime = Date.now();
    const userProfile = this.userProfiles[sessionId % this.userProfiles.length];
    const deviceProfile = this.deviceProfiles[sessionId % this.deviceProfiles.length];
    
    console.log(`\n🚀 Starting Session ${sessionId}/${this.sessions}`);
    console.log(`👤 User: ${userProfile.firstName} ${userProfile.lastName}`);
    console.log(`📱 Device: ${deviceProfile.device_name}`);
    
    const browser = await chromium.launch({
      headless: false,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled'
      ],
      proxy: process.env.USE_DEFAULT_PROXY === 'true' ? {
        server: 'http://38.134.148.20:8000',
        username: 'neon',
        password: 'neon'
      } : undefined
    });

    const context = await browser.newContext({
      viewport: {
        width: parseInt(deviceProfile.viewport_width || 360),
        height: parseInt(deviceProfile.viewport_height || 640)
      },
      userAgent: deviceProfile.user_agent,
      deviceScaleFactor: parseFloat(deviceProfile.pixel_ratio || 2),
      isMobile: true,
      hasTouch: true,
      locale: 'en-US',
      timezoneId: userProfile.timezone || 'America/New_York',
      permissions: ['geolocation'],
      geolocation: {
        latitude: parseFloat(userProfile.latitude || 40.7128),
        longitude: parseFloat(userProfile.longitude || -74.0060)
      }
    });

    const page = await context.newPage();
    
    try {
      // Warm-up phase
      await this.performWarmup(page, sessionId);
      
      // Check if we still have time for the funnel
      const elapsedTime = Date.now() - sessionStartTime;
      if (elapsedTime < this.sessionDuration - this.funnelDuration) {
        console.log(`[Session ${sessionId}] 🎯 Starting funnel automation...`);
        
        // Import and run the funnel test
        const { CPAFunnelTester } = require('./test-funnel.js');
        const tester = new CPAFunnelTester('./wfh_localjobmatcher.json');
        
        // Override browser/page
        tester.browser = browser;
        tester.page = page;
        tester.selectedUser = userProfile;
        tester.selectedProfile = deviceProfile;
        
        await tester.runFullTest();
        
        this.sessionResults.push({
          sessionId,
          user: `${userProfile.firstName} ${userProfile.lastName}`,
          device: deviceProfile.device_name,
          success: true,
          duration: Date.now() - sessionStartTime
        });
      }
      
    } catch (error) {
      console.error(`[Session ${sessionId}] ❌ Error: ${error.message}`);
      this.sessionResults.push({
        sessionId,
        user: `${userProfile.firstName} ${userProfile.lastName}`,
        device: deviceProfile.device_name,
        success: false,
        error: error.message,
        duration: Date.now() - sessionStartTime
      });
    } finally {
      await browser.close();
    }
    
    // Wait for proxy rotation if needed (15-minute mark)
    const totalElapsed = Date.now() - sessionStartTime;
    if (totalElapsed < this.sessionDuration) {
      const waitTime = this.sessionDuration - totalElapsed;
      console.log(`[Session ${sessionId}] ⏳ Waiting ${Math.round(waitTime / 1000)}s for proxy rotation...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }

  async run() {
    await this.loadProfiles();
    
    console.log(`🎯 Starting ${this.sessions} session(s)`);
    console.log(`⏱️ Each session: 15 minutes (12 min warm-up + 3 min funnel)`);
    
    // Run sessions sequentially to respect proxy rotation
    for (let i = 0; i < this.sessions; i++) {
      await this.runSession(i);
    }
    
    // Save results
    await fs.mkdir('session-results', { recursive: true });
    await fs.writeFile(
      `session-results/run-${Date.now()}.json`,
      JSON.stringify({
        totalSessions: this.sessions,
        successful: this.sessionResults.filter(r => r.success).length,
        failed: this.sessionResults.filter(r => !r.success).length,
        results: this.sessionResults
      }, null, 2)
    );
    
    console.log('\n📊 SESSION SUMMARY:');
    console.log(`Total: ${this.sessions}`);
    console.log(`Success: ${this.sessionResults.filter(r => r.success).length}`);
    console.log(`Failed: ${this.sessionResults.filter(r => !r.success).length}`);
  }
}

// Run if called directly
if (require.main === module) {
  const runner = new MobileSessionRunner();
  runner.run().catch(console.error);
}

module.exports = { MobileSessionRunner };
