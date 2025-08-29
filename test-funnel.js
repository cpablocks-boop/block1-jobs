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
  }

  async loadDeviceProfiles() {
    if (!this.deviceProfilePath) return;
    
    try {
      const csvData = await fs.readFile(this.deviceProfilePath, 'utf8');
      const lines = csvData.split('\n').filter(line => line.trim());
      
      // Improved CSV line parser that handles quoted fields with commas
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
              // Escaped quote (though not present in your CSV, handling for robustness)
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
      console.log(`📱 Selected device: ${this.selectedProfile.device_name} (${this.selectedProfile.profile_id})`);
      this.testResults.deviceProfile = this.selectedProfile.profile_id;
    } catch (error) {
      console.log(`⚠️ Could not load device profiles: ${error.message}`);
      this.selectedProfile = null;
    }
  }

  async loadConfig() {
    try {
      const configData = await fs.readFile(this.configPath, 'utf8');
      this.config = JSON.parse(configData);
      console.log(`✅ Loaded config: ${this.config.metadata.offerName} v${this.config.metadata.version}`);
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
      console.log(`🌐 Using proxy: ${this.proxyConfig.server}`);
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
      contextOptions.viewport = { width: 1366, height: 768 };
    }

    const context = await this.browser.newContext(contextOptions);
    
    // Add extra headers to appear more legitimate
    await context.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
    });

    this.page = await context.newPage();
    
    // Enable request/response monitoring
    this.page.on('request', request => {
      if (request.url().includes('facebook.com/tr') || request.url().includes('google-analytics.com')) {
        console.log(`📊 Tracking pixel fired: ${request.url()}`);
      }
    });

    // Monitor for navigation events
    this.page.on('framenavigated', frame => {
      if (frame === this.page.mainFrame()) {
        console.log(`🔄 Navigated to: ${frame.url()}`);
      }
    });
    
    console.log(`🚀 Browser initialized: ${browserName}`);
  }

  generateTestData() {
    const timestamp = Date.now();
    const testData = {
      zipCode: '10001',
      firstName: `Test${timestamp}`,
      lastName: `User${timestamp}`,
      email: `test${timestamp}@testdomain.com`,
      phone: '5551234567',
      dobMonth: '01',
      dobDay: '15',
      dobYear: '1990',
      address: '123 Test Street',
      city: 'New York',
      state: 'NY',
      gender: 'M'
    };

    // Use device profile location if available
    if (this.selectedProfile && this.selectedProfile.timezone) {
      const timezone = this.selectedProfile.timezone;
      if (timezone.includes('Los_Angeles')) {
        testData.zipCode = '90210';
        testData.city = 'Beverly Hills';
        testData.state = 'CA';
      } else if (timezone.includes('Chicago')) {
        testData.zipCode = '60601';
        testData.city = 'Chicago';
        testData.state = 'IL';
      } else if (timezone.includes('New_York')) {
        testData.zipCode = '10001';
        testData.city = 'New York';
        testData.state = 'NY';
      }
    }

    return testData;
  }

  async waitForElement(selectors, timeout = 10000) {
    const selectorArray = Array.isArray(selectors) ? selectors : [selectors];
    
    for (const selector of selectorArray) {
      try {
        await this.page.waitForSelector(selector, { timeout: timeout / selectorArray.length, state: 'visible' });
        return selector; // Return the successful selector
      } catch (error) {
        // Continue to next selector
      }
    }
    
    console.log(`⚠️ No elements found from selectors: ${JSON.stringify(selectorArray)}`);
    return null;
  }

  async handleFacebookRedirect() {
    console.log(`🔄 Handling Facebook redirect via click-through only...`);
    
    // Since we're now clicking the original link in navigateToNextPage,
    // we should already be on or navigating to the redirect page after click.
    // Wait for potential redirect page to load
    try {
      await this.page.waitForLoadState('domcontentloaded', { timeout: 15000 });
      await this.page.waitForTimeout(3000);
    } catch (error) {
      console.log(`⚠️ Waiting for redirect page: ${error.message}`);
    }
    
    // Check if we're on a Facebook redirect/confirmation page
    if (this.page.url().includes('facebook.com')) {
      console.log('📱 On Facebook redirect page - looking for continue/proceed elements...');
      
      const continueSelectors = [
        'a:has-text("Continue")',
        'button:has-text("Continue")',
        'a:has-text("Proceed")',
        'a[href*="opph3hftrk.com"]',
        'a[href*="HMLWQ96"]',
        'a:visible'  // Fallback, but be cautious as it might click wrong
      ];
      
      for (const selector of continueSelectors) {
        const foundSelector = await this.waitForElement(selector, 10000);
        if (foundSelector) {
          try {
            console.log(`🖱️ Clicking redirect element: ${foundSelector}`);
            await this.page.click(foundSelector);
            await this.page.waitForTimeout(5000);
            
            // Wait for navigation away from Facebook
            await this.page.waitForURL(url => !url.includes('facebook.com'), { timeout: 15000 });
            
            console.log(`✅ Successfully redirected to: ${this.page.url()}`);
            return true;
          } catch (clickError) {
            console.log(`⚠️ Click failed for ${selector}: ${clickError.message}`);
          }
        }
      }
      
      throw new Error('Failed to find and click continue element on Facebook redirect page');
    } else {
      console.log(`✅ Already navigated away from Facebook: ${this.page.url()}`);
      return true;
    }
  }

  async navigateToNextPage(navigation, pageNumber) {
    console.log(`🔄 Navigating from page ${pageNumber}...`);
    console.log(`📍 Current URL: ${this.page.url()}`);
    
    const foundSelector = await this.waitForElement(navigation.selectors);
    if (!foundSelector) {
      throw new Error('Navigation element not found');
    }
    
    try {
      // Always click the element directly
      console.log(`🖱️ Clicking navigation element: ${foundSelector}`);
      await this.page.click(foundSelector);
      
      // Wait for potential new tab if expected
      if (navigation.expectNewTab) {
        const [newPage] = await Promise.all([
          this.browser.contexts()[0].waitForEvent('page', { timeout: 15000 }),
          this.page.waitForTimeout(1000)  // Small delay
        ]);
        this.page = newPage;
        await this.page.bringToFront();
        console.log(`🔄 Switched to new tab: ${this.page.url()}`);
      }
      
      // Wait for navigation
      await this.page.waitForTimeout(navigation.waitAfterClick || 5000);
      
      if (navigation.waitForUrlChange) {
        await this.page.waitForURL(url => url !== this.page.url(), { timeout: 15000 });
      }
      
      // Now handle any Facebook redirect page if we land on one
      await this.handleFacebookRedirect();  // No need for targetUrl anymore
      
      console.log(`✅ Navigated successfully to: ${this.page.url()}`);
    } catch (error) {
      if (navigation.retryIfNoNavigation) {
        console.log('⚠️ Retry navigation...');
        // You could add retry logic here if needed
      }
      throw new Error(`Navigation failed: ${error.message}`);
    }
  }

  async fillField(field, testData) {
    const foundSelector = await this.waitForElement(field.selectors);
    if (!foundSelector) {
      throw new Error(`Field not found: ${field.fieldType}`);
    }

    const value = testData[field.fieldType];
    if (!value && !field.optional) {
      throw new Error(`No test data for required field: ${field.fieldType}`);
    }

    if (field.optional && !value) return false;

    switch (field.action) {
      case 'clear_and_type':
        await this.page.fill(foundSelector, '');
        await this.page.type(foundSelector, value, { delay: 100 });
        break;
      case 'type':
        await this.page.type(foundSelector, value, { delay: 100 });
        break;
      case 'select':
        await this.page.selectOption(foundSelector, value);
        break;
      case 'click':
        await this.page.click(foundSelector);
        break;
      default:
        await this.page.fill(foundSelector, value);
    }

    await this.page.waitForTimeout(Math.random() * (this.config.settings.delays.betweenFields[1] - this.config.settings.delays.betweenFields[0]) + this.config.settings.delays.betweenFields[0]);
    return true;
  }

  async inspectPageForAlternatives(expectedSelector) {
    try {
      const forms = await this.page.$$('form');
      const inputs = await this.page.$$('input');
      const buttons = await this.page.$$('button');
      
      return {
        onFacebook: this.page.url().includes('facebook.com'),
        formCount: forms.length,
        inputCount: inputs.length,
        buttonCount: buttons.length,
        pageTitle: await this.page.title(),
        currentUrl: this.page.url()
      };
    } catch (error) {
      return { error: error.message };
    }
  }

  async testPage(pageConfig, testData) {
    const { pageNumber, pageName, pageDetection, fields = [], navigation } = pageConfig;
    
    const pageResult = {
      pageNumber,
      pageName,
      success: false,
      fieldsCompleted: 0,
      totalFields: fields.length,
      errors: []
    };

    try {
      console.log(`\n📄 Testing Page ${pageNumber}: ${pageName}`);
      
      // Wait for page to fully load
      console.log('⏳ Waiting for page to fully load...');
      await this.page.waitForLoadState('domcontentloaded', { timeout: this.config.settings.navigationTimeout });
      try {
        await this.page.waitForLoadState('networkidle', { timeout: 15000 });
      } catch (networkError) {
        console.log('⚠️ NetworkIdle timeout, continuing with page detection...');
      }
      
      // Check if we're on the right page
      if (pageDetection?.checkForElement) {
        console.log(`🔍 Looking for page detection element: ${pageDetection.checkForElement}`);
        const pageDetected = await this.waitForElement([pageDetection.checkForElement], 15000);
        if (!pageDetected) {
          // Try to inspect the page to see what's actually there
          const inspection = await this.inspectPageForAlternatives(pageDetection.checkForElement);
          
          // If we're still on Facebook, this is likely the navigation issue
          if (inspection.onFacebook) {
            throw new Error(`Still on Facebook page - navigation from page ${pageNumber - 1} failed`);
          }
          
          throw new Error(`Page detection failed: ${pageDetection.checkForElement} not found`);
        }
        console.log(`✅ Page detected correctly`);
      }

      // Fill all fields on this page
      for (const field of fields) {
        try {
          const success = await this.fillField(field, testData);
          if (success) pageResult.fieldsCompleted++;
        } catch (error) {
          pageResult.errors.push(`${field.fieldType}: ${error.message}`);
          if (field.required && !field.optional) throw error;
        }
      }

      // Navigate to next page (if navigation is defined)
      if (navigation) {
        await this.navigateToNextPage(navigation, pageNumber);
      }

      pageResult.success = true;
      console.log(`✅ Page ${pageNumber} completed successfully`);
      
    } catch (error) {
      pageResult.errors.push(error.message);
      console.log(`❌ Page ${pageNumber} failed: ${error.message}`);
      throw error;
    }

    this.testResults.pageResults.push(pageResult);
    return pageResult;
  }

  async runFullTest() {
    try {
      await this.loadDeviceProfiles();
      await this.loadConfig();
      await this.initBrowser();
      
      const testData = this.generateTestData();
      console.log(`🧪 Generated test data for: ${testData.email}`);
      
      // Navigate to Facebook post (entry point)
      const startUrl = this.config.metadata.entryPoint.startUrl;
      console.log(`🌐 Navigating to Facebook post: ${startUrl}`);
      
      const startTime = Date.now();
      await this.page.goto(startUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });
      
      this.testResults.metrics.initialPageLoad = Date.now() - startTime;
      
      // Wait for Facebook page to load completely
      console.log('⏳ Waiting for Facebook page to load...');
      await this.page.waitForTimeout(5000);
      
      try {
        await this.page.waitForLoadState('networkidle', { timeout: 15000 });
      } catch (networkError) {
        console.log('⚠️ NetworkIdle timeout on Facebook, continuing...');
      }
      
      // Test each page in sequence (starting from Facebook)
      for (const pageConfig of this.config.funnel.pages) {
        await this.testPage(pageConfig, testData);
      }
      
      // Test completed successfully
      this.testResults.success = true;
      this.testResults.endTime = new Date().toISOString();
      this.testResults.totalDuration = Date.now() - new Date(this.testResults.startTime).getTime();
      
      console.log('\n🎉 FUNNEL TEST COMPLETED SUCCESSFULLY!');
      this.logResults();
      
    } catch (error) {
      this.testResults.success = false;
      this.testResults.errors.push(error.message);
      this.testResults.endTime = new Date().toISOString();
      this.testResults.totalDuration = Date.now() - new Date(this.testResults.startTime).getTime();
      
      console.log(`\n💥 TEST FAILED: ${error.message}`);
      
      // Take screenshot on failure
      if (this.page) {
        try {
          const screenshotPath = `failure-${Date.now()}.png`;
          await this.page.screenshot({ 
            path: screenshotPath,
            fullPage: true 
          });
          console.log(`📸 Screenshot saved: ${screenshotPath}`);
        } catch (screenshotError) {
          console.log(`⚠️ Could not take screenshot: ${screenshotError.message}`);
        }
      }
      
      throw error;
    } finally {
      await this.cleanup();
    }
  }

  logResults() {
    console.log('\n📊 TEST RESULTS SUMMARY:');
    console.log(`⏱️ Total Duration: ${this.testResults.totalDuration}ms`);
    console.log(`📄 Pages Tested: ${this.testResults.pageResults.length}`);
    console.log(`✅ Success Rate: ${this.testResults.pageResults.filter(p => p.success).length}/${this.testResults.pageResults.length}`);
    
    if (this.selectedProfile) {
      console.log(`📱 Device: ${this.selectedProfile.device_name} (${this.selectedProfile.brand})`);
    }
    
    if (this.proxyConfig) {
      console.log(`🌐 Proxy: ${this.proxyConfig.server}`);
    }
    
    this.testResults.pageResults.forEach(result => {
      const status = result.success ? '✅' : '❌';
      console.log(`${status} Page ${result.pageNumber} (${result.pageName}): ${result.fieldsCompleted}/${result.totalFields} fields`);
      
      if (result.errors.length > 0) {
        result.errors.forEach(error => console.log(`   ⚠️ ${error}`));
      }
    });
  }

  async cleanup() {
    if (this.browser) {
      await this.browser.close();
      console.log('🧹 Browser closed');
    }
  }

  async saveResults(outputPath = 'test-results.json') {
    const finalOutputPath = outputPath.includes('browser') 
      ? outputPath 
      : `test-results-${process.env.BROWSER || 'chromium'}-${Date.now()}.json`;
    
    await fs.writeFile(finalOutputPath, JSON.stringify(this.testResults, null, 2));
    console.log(`💾 Results saved to ${finalOutputPath}`);
  }
}

// Configuration discovery function
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
        // Not a valid config file
      }
    }
  }
  
  return configFiles;
}

// Device profile discovery function
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

// Main execution function
async function runTest() {
  const configFile = process.argv[2] || './wfh_localjobmatcher.json';
  let deviceProfileFile = process.argv[3] || null;
  
  // Check if config file exists
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
  
  // Auto-discover device profile files if not specified
  if (!deviceProfileFile) {
    const availableProfiles = await findDeviceProfileFiles();
    if (availableProfiles.length > 0) {
      deviceProfileFile = availableProfiles[0];
      console.log(`📱 Auto-discovered device profiles: ${deviceProfileFile}`);
    }
  }
  
  // Configure proxy if environment variables are set
  let proxyConfig = null;
  if (process.env.PROXY_SERVER) {
    proxyConfig = {
      server: process.env.PROXY_SERVER,
      username: process.env.PROXY_USER,
      password: process.env.PROXY_PASS
    };
  } else if (process.env.USE_DEFAULT_PROXY === 'true') {
    // Use the default proxy you provided
    proxyConfig = {
      server: '38.146.27.33:11000',
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

// Run if executed directly
if (require.main === module) {
  runTest();
}

module.exports = { CPAFunnelTester, findConfigFiles };
