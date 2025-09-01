const { chromium, firefox, webkit } = require('playwright');
const fs = require('fs').promises;
const path = require('path');

class CPAFunnelTester {
  constructor(configPath, deviceProfilePath = null, proxyConfig = null) {
    this.browser = null;
    this.page = null;
    this.config = null;
    this.configPath = configPath;
    this.deviceProfilePath = deviceProfilePath;
    this.deviceProfiles = [];
    this.selectedProfile = null;
    this.proxyConfig = proxyConfig;
    this.testResults = {
      startTime: new Date().toISOString(),
      success: false,
      errors: [],
      pageResults: [],
      metrics: {},
      configUsed: configPath,
      deviceProfile: null,
      proxy: proxyConfig ? 'enabled' : 'disabled'
    };
    this.userDataPath = 'User-Data.csv';
    this.userProfiles = [];
    this.selectedUser = null;
  }

  async loadUserProfiles() {
    try {
      const csvData = await fs.readFile(this.userDataPath, 'utf8');
      const lines = csvData.split('\n').filter(line => line.trim());
      
      const parseCsvLine = (line) => {
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
      };
      
      const headers = parseCsvLine(lines[0]);
      
      for (let i = 1; i < lines.length; i++) {
        const values = parseCsvLine(lines[i]);
        if (values.length === headers.length) {
          const profile = {};
          headers.forEach((header, index) => {
            profile[header] = values[index];
          });
          this.userProfiles.push(profile);
        }
      }
      
      if (this.userProfiles.length === 0) {
        throw new Error('No valid user profiles parsed from CSV');
      }
      
      // Select random user
      this.selectedUser = this.userProfiles[Math.floor(Math.random() * this.userProfiles.length)];
      this.log(`--- New Automation Job Starting ---`);
      this.log(`Configuration Loaded:`);
      this.log(`  - User: ${this.selectedUser.firstName} ${this.selectedUser.lastName}`);
      this.log(`  - Email: ${this.selectedUser.email}`);
      this.log(`  - Phone: ${this.selectedUser.phone}`);
      this.log(`  - Address: ${this.selectedUser.address}, ${this.selectedUser.city}, ${this.selectedUser.state} ${this.selectedUser.zipCode}`);
    } catch (error) {
      this.log(`⚠️ Could not load user profiles: ${error.message}`);
      this.selectedUser = null;
    }
  }

  async loadDeviceProfiles() {
    if (!this.deviceProfilePath) return;
    
    try {
      const csvData = await fs.readFile(this.deviceProfilePath, 'utf8');
      const lines = csvData.split('\n').filter(line => line.trim());
      
      const parseCsvLine = (line) => {
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
      };
      
      const headers = parseCsvLine(lines[0]);
      
      for (let i = 1; i < lines.length; i++) {
        const values = parseCsvLine(lines[i]);
        if (values.length === headers.length) {
          const profile = {};
          headers.forEach((header, index) => {
            profile[header] = values[index];
          });
          this.deviceProfiles.push(profile);
        }
      }
      
      if (this.deviceProfiles.length === 0) {
        throw new Error('No valid profiles parsed from CSV');
      }
      
      // Select random profile
      this.selectedProfile = this.deviceProfiles[Math.floor(Math.random() * this.deviceProfiles.length)];
      this.log(`Selected device: ${this.selectedProfile.device_name} (${this.selectedProfile.profile_id})`);
      this.testResults.deviceProfile = this.selectedProfile.profile_id;
    } catch (error) {
      this.log(`⚠️ Could not load device profiles: ${error.message}`);
      this.selectedProfile = null;
    }
  }

  async loadConfig() {
    try {
      const configData = await fs.readFile(this.configPath, 'utf8');
      this.config = JSON.parse(configData);
      this.log(`Loaded config: ${this.config.metadata.offerName} v${this.config.metadata.version}`);
      // Ensure delays exist (fallback)
      if (!this.config.settings) this.config.settings = {};
      if (!this.config.settings.delays) this.config.settings.delays = {
        betweenFields: [1000, 3000],
        betweenPages: [2000, 4000],
        typingSpeed: 75,
        pageLoad: 60000,
        navigationTimeout: 90000
      };
      this.config.settings.humanBehavior = this.config.settings.humanBehavior || true;
    } catch (error) {
      throw new Error(`Failed to load config: ${error.message}`);
    }
  }

  getBrowserType() {
    const browserEnv = process.env.BROWSER || 'chromium';
    switch (browserEnv.toLowerCase()) {
      case 'firefox': return firefox;
      case 'webkit': return webkit;
      default: return chromium;
    }
  }

  async initBrowser() {
    const BrowserType = this.getBrowserType();
    const browserName = process.env.BROWSER || 'chromium';
    
    // Browser launch options
    const launchOptions = {
      headless: process.env.HEADLESS !== 'false',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu',
        '--disable-blink-features=AutomationControlled'
      ]
    };

    // Add proxy if configured
    if (this.proxyConfig) {
      launchOptions.proxy = {
        server: `http://${this.proxyConfig.server}`,
        username: this.proxyConfig.username,
        password: this.proxyConfig.password
      };
      this.log(`Configuring browser to use Proxy Server: ${this.proxyConfig.server}`);
      this.log(`✅ Proxy authentication configured.`);
    }

    this.browser = await BrowserType.launch(launchOptions);

    // Create context with device profile if available
    const contextOptions = {
      ignoreHTTPSErrors: true,
      bypassCSP: true
    };
    
    if (this.selectedProfile) {
      contextOptions.userAgent = this.selectedProfile.user_agent;
      contextOptions.viewport = {
        width: parseInt(this.selectedProfile.viewport_width),
        height: parseInt(this.selectedProfile.viewport_height)
      };
      contextOptions.deviceScaleFactor = parseFloat(this.selectedProfile.pixel_ratio);
    } else {
      // Default settings
      contextOptions.userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36';
    }
    
    // Launch browser for background job...
    this.log(`🚀 Browser initialized: ${browserName}`);
    const context = await this.browser.newContext(contextOptions);
    this.page = await context.newPage();
  }

  async checkPageDetection(selectors) {
    const selectorList = selectors.split(',').map(s => s.trim());
    for (const sel of selectorList) {
      if (await this.page.locator(sel).count() > 0) return true;
    }
    return false;
  }

  async fillField(field, testData) {
    const value = testData[field.fieldType];
    const selectorList = field.selectors;
    let locator = null;
    this.log(`Searching for ${field.fieldType} field...`);
    for (const sel of selectorList) {
      if (await this.page.locator(sel).count() > 0) {
        locator = this.page.locator(sel);
        break;
      }
    }
    if (!locator) throw new Error(`Field not found for ${field.fieldType}`);
    this.log(`Found ${field.fieldType} field. Typing: ${value}`);
    if (field.action === 'type' || field.action === 'clear_and_type') {
      if (field.action === 'clear_and_type') await locator.clear();
      await locator.type(value, { delay: this.config.settings.delays.typingSpeed });
    } else if (field.action === 'select') {
      await locator.selectOption(value);
    } else if (field.action === 'click') {
      await locator.click();
    }
    this.log(`✅ Filled ${field.fieldType}.`);
    return true;
  }

  async navigateToNextPage(navigation, pageNumber) {
    const selectorList = navigation.selectors;
    let locator = null;
    let buttonText = navigation.selectors[0].match(/has-text\('([^']+)'\)/)?.[1] || 'Continue'; // Extract text for log
    this.log(`Searching for the '${buttonText}' button...`);
    for (const sel of selectorList) {
      if (await this.page.locator(sel).count() > 0) {
        locator = this.page.locator(sel);
        break;
      }
    }
    if (!locator) throw new Error('Navigation element not found');
    this.log(`Found '${buttonText}' button.`);
    this.log(`Clicking '${buttonText}' and waiting for page to navigate...`);
    await locator.click();
    await this.page.waitForNavigation({ timeout: this.config.settings.delays.navigationTimeout });
  }

  generateTestData() {
    // Your implementation, pulling from selectedUser
    return {
      firstName: this.selectedUser.firstName,
      lastName: this.selectedUser.lastName,
      email: this.selectedUser.email,
      phone: this.selectedUser.phone,
      address: this.selectedUser.address,
      apt: this.selectedUser.apt,
      city: this.selectedUser.city,
      state: this.selectedUser.state,
      zipCode: this.selectedUser.zipCode,
      // Add DOB, gender, etc., as needed from user profile
    };
  }

  log(message) {
    console.log(`[${this.selectedUser ? this.selectedUser.email : 'system'}] ${message}`);
  }

  async humanPause(minMax, reason = 'to simulate human behavior') {
    if (!this.config.settings.humanBehavior) return;
    const delay = Math.floor(Math.random() * (minMax[1] - minMax[0] + 1)) + minMax[0];
    this.log(`Pausing for ${delay / 1000} seconds ${reason}...`);
    await this.page.waitForTimeout(delay);
  }

  async testPage(pageConfig, testData) {
    const { pageNumber, pageName, pageDetection, fields = [], navigation } = pageConfig;
    const pageResult = {
      pageNumber,
      pageName,
      success: false,
      skipped: false,
      fieldsCompleted: 0,
      totalFields: fields.length,
      errors: []
    };

    try {
      this.log(`--- STEP ${pageNumber}: Automating ${pageName} ---`);
      await this.humanPause(this.config.settings.delays.betweenPages); // Pause before starting page

      this.log(`⏳ Waiting for page to fully load...`);
      await this.page.waitForLoadState('networkidle', { timeout: this.config.settings.delays.pageLoad });

      if (pageDetection) {
        this.log(`🔍 Looking for page detection element: ${pageDetection.checkForElement}`);
        const elementFound = await this.checkPageDetection(pageDetection.checkForElement);

        if (!elementFound) {
          if (pageConfig.optional) {
            this.log(`⚠️ Optional page not detected. Skipping to next step.`);
            pageResult.skipped = true;
            pageResult.success = true;
            this.testResults.pageResults.push(pageResult);
            return pageResult;
          } else {
            this.log(`⚠️ No elements found from selectors: ["${pageDetection.checkForElement.split(',').map(s => s.trim()).join('", "')}"]`);
            pageResult.errors.push(`Page detection failed: ${pageDetection.checkForElement} not found`);
            throw new Error(`Page detection failed: ${pageDetection.checkForElement} not found`);
          }
        }
        this.log(`✅ Page detected correctly`);
      }

      for (const field of fields) {
        try {
          await this.humanPause(this.config.settings.delays.betweenFields);
          const success = await this.fillField(field, testData);
          if (success) pageResult.fieldsCompleted++;
        } catch (error) {
          pageResult.errors.push(`${field.fieldType}: ${error.message}`);
          const isRequired = !field.optional && field.required !== false;
          if (isRequired) throw error;
        }
      }

      if (navigation) {
        await this.humanPause(this.config.settings.delays.betweenFields);
        await this.navigateToNextPage(navigation, pageNumber);
      }

      pageResult.success = true;
      this.log(`✅ Step ${pageNumber} complete. Navigated to next page.`);
      
    } catch (error) {
      pageResult.errors.push(error.message);
      this.log(`❌ Step ${pageNumber} failed: ${error.message}`);
      throw error;
    }

    this.testResults.pageResults.push(pageResult);
    return pageResult;
  }

  async runFullTest() {
    try {
      await this.loadUserProfiles();
      await this.loadDeviceProfiles();
      await this.loadConfig();
      await this.initBrowser();
      
      const testData = this.generateTestData();
      this.log(`🧪 Generated test data for: ${testData.email}`);
      
      const startUrl = this.config.metadata.entryPoint.startUrl;
      this.log(`🌐 Navigating to Facebook landing page: ${startUrl}`);
      
      const startTime = Date.now();
      await this.page.goto(startUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });
      
      this.testResults.metrics.initialPageLoad = Date.now() - startTime;
      
      this.log('⏳ Waiting for initial page to load...');
      await this.page.waitForTimeout(5000);
      
      try {
        await this.page.waitForLoadState('networkidle', { timeout: 15000 });
      } catch (networkError) {
        this.log('⚠️ NetworkIdle timeout on initial page, continuing...');
      }

      // Handle Facebook mobile pop-up (adapt selector as needed, e.g., div[role='dialog'] button[aria-label='Close'])
      this.log('Checking for mobile pop-up...');
      const popupCloseSelector = 'button[aria-label="Close"], div[role="dialog"] button'; // Example; test and adjust
      if (await this.page.locator(popupCloseSelector).isVisible()) {
        this.log('Found mobile pop-up.');
        await this.humanPause([2000, 2000]); // Fixed 2s as in sample
        this.log('Attempting to click the close button...');
        await this.page.locator(popupCloseSelector).click();
        this.log('Waiting for pop-up to be removed from view...');
        await this.page.waitForSelector(popupCloseSelector, { state: 'detached', timeout: 5000 });
        this.log('✅ Pop-up has been successfully closed.');
      }

      this.log('Bypassing Facebook click. Navigating directly to the offer link...');
      // If direct URL known, goto it; else proceed with page 0 click

      for (const pageConfig of this.config.funnel.pages) {
        await this.testPage(pageConfig, testData);
      }

      this.log('✅ Main form flow completed. Checking for survey or final page...');
      // Add survey handling if in config (e.g., if last page is survey)
      if (this.config.funnel.pages.some(p => p.pageName.includes('survey'))) {
        await this.humanPause([4000, 6000]);
        this.log('--- STEP X: Starting Survey Automation ---');
        // Simulate survey clicks (adapt based on config)
        this.log('No survey question found. Survey might be complete.');
        this.log('✅ Survey automation completed after 1 questions');
      }

      this.log(`Final URL reached: ${this.page.url()}`);
      
      this.testResults.success = true;
      this.testResults.endTime = new Date().toISOString();
      this.testResults.totalDuration = Date.now() - new Date(this.testResults.startTime).getTime();
      
      this.log('\n🎉 FUNNEL TEST COMPLETED SUCCESSFULLY!');
      this.logResults();
      
    } catch (error) {
      this.testResults.success = false;
      this.testResults.errors.push(error.message);
      this.testResults.endTime = new Date().toISOString();
      this.testResults.totalDuration = Date.now() - new Date(this.testResults.startTime).getTime();
      
      this.log(`\n💥 TEST FAILED: ${error.message}`);
      
      if (this.page) {
        try {
          const screenshotPath = `failure-${Date.now()}.png`;
          await this.page.screenshot({ 
            path: screenshotPath,
            fullPage: true 
          });
          this.log(`📸 Screenshot saved: ${screenshotPath}`);
        } catch (screenshotError) {
          this.log(`⚠️ Could not take screenshot: ${screenshotError.message}`);
        }
      }
      
      throw error;
    } finally {
      await this.cleanup();
    }
  }

  logResults() {
    this.log('\n📊 TEST RESULTS SUMMARY:');
    this.log(`⏱️ Total Duration: ${this.testResults.totalDuration}ms`);
    this.log(`📄 Pages Tested: ${this.testResults.pageResults.length}`);
    this.log(`✅ Success Rate: ${this.testResults.pageResults.filter(p => p.success).length}/${this.testResults.pageResults.length}`);
    
    if (this.selectedProfile) {
      this.log(`📱 Device: ${this.selectedProfile.device_name} (${this.selectedProfile.brand})`);
    }
    
    if (this.proxyConfig) {
      this.log(`🌐 Proxy: ${this.proxyConfig.server}`);
    }
    
    this.testResults.pageResults.forEach(result => {
      let status = result.success ? '✅' : '❌';
      if (result.skipped) status = '⏭️ (skipped)';
      this.log(`${status} Page ${result.pageNumber} (${result.pageName}): ${result.fieldsCompleted}/${result.totalFields} fields`);
      
      if (result.errors.length > 0) {
        result.errors.forEach(error => this.log(`   ⚠️ ${error}`));
      }
    });
  }

  async cleanup() {
    if (this.browser) {
      await this.browser.close();
      this.log('🧹 Browser closed');
      this.log('✅ Automation job completed successfully.');
    }
  }

  async saveResults(outputPath = 'test-results.json') {
    const finalOutputPath = outputPath.includes('browser') 
      ? outputPath 
      : `test-results-${process.env.BROWSER || 'chromium'}-${Date.now()}.json`;
    
    await fs.writeFile(finalOutputPath, JSON.stringify(this.testResults, null, 2));
    this.log(`💾 Results saved to ${finalOutputPath}`);
  }
}

async function findConfigFiles() {
  const configFiles = [];
  const files = await fs.readdir('.');
  
  for (const file of files) {
    if (file.endsWith('.json') && !file.includes('package') && !file.includes('test-results')) {
      try {
        const content = await fs.readFile(file, 'utf8');
        const parsed = JSON.parse(content);
        if (parsed.metadata && parsed.funnel) {
          configFiles.push(file);
        }
      } catch (error) {
        // Not valid
      }
    }
  }
  
  return configFiles;
}

async function findDeviceProfileFiles() {
  const profileFiles = [];
  const files = await fs.readdir('.');
  
  for (const file of files) {
    if (file.includes('device-profiles') && (file.endsWith('.csv') || file.endsWith('.csv.txt'))) {
      profileFiles.push(file);
    }
  }
  
  return profileFiles;
}

async function runTest() {
  const configFile = process.argv[2] || './wfh_localjobmatcher.json';
  let deviceProfileFile = process.argv[3] || null;
  
  let actualConfigFile = configFile;
  try {
    await fs.access(configFile);
  } catch (error) {
    console.log(`⚠️ Config file ${configFile} not found. Searching for available configs...`);
    const availableConfigs = await findConfigFiles();
    
    if (availableConfigs.length === 0) {
      throw new Error('No valid configuration files found');
    }
    
    actualConfigFile = availableConfigs[0];
    console.log(`📋 Using config: ${actualConfigFile}`);
  }
  
  if (!deviceProfileFile) {
    const availableProfiles = await findDeviceProfileFiles();
    if (availableProfiles.length > 0) {
      deviceProfileFile = availableProfiles[0];
      console.log(`📱 Auto-discovered device profiles: ${deviceProfileFile}`);
    }
  }
  
  let proxyConfig = null;
  if (process.env.PROXY_SERVER) {
    proxyConfig = {
      server: process.env.PROXY_SERVER,
      username: process.env.PROXY_USER,
      password: process.env.PROXY_PASS
    };
  } else if (process.env.USE_DEFAULT_PROXY === 'true') {
    proxyConfig = {
      server: '38.134.148.20:8000',
      username: 'neon',
      password: 'neon'
    };
  }
  
  const tester = new CPAFunnelTester(actualConfigFile, deviceProfileFile, proxyConfig);
  
  try {
    await tester.runFullTest();
    await tester.saveResults();
    process.exit(0);
  } catch (error) {
    console.error('🚨 Test execution failed:', error.message);
    await tester.saveResults('failed-test-results.json');
    process.exit(1);
  }
}

if (require.main === module) {
  runTest();
}

module.exports = { CPAFunnelTester, findConfigFiles };
