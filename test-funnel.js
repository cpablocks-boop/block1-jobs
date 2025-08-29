const { chromium, firefox, webkit } = require('playwright');
const fs = require('fs').promises;
const path = require('path');

class CPAFunnelTester {
  constructor(configPath, deviceProfilePath = null) {
    this.browser = null;
    this.page = null;
    this.config = null;
    this.configPath = configPath;
    this.deviceProfilePath = deviceProfilePath;
    this.deviceProfiles = [];
    this.selectedProfile = null;
    this.testResults = {
      startTime: new Date().toISOString(),
      success: false,
      errors: [],
      pageResults: [],
      metrics: {},
      configUsed: configPath,
      deviceProfile: null
    };
  }

  async loadDeviceProfiles() {
    if (!this.deviceProfilePath) return;
    
    try {
      const csvData = await fs.readFile(this.deviceProfilePath, 'utf8');
      const lines = csvData.split('\n').filter(line => line.trim());
      const headers = lines[0].split(',').map(h => h.replace(/"/g, '').trim());
      
      for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',').map(v => v.replace(/"/g, '').trim());
        if (values.length === headers.length) {
          const profile = {};
          headers.forEach((header, index) => {
            profile[header] = values[index];
          });
          this.deviceProfiles.push(profile);
        }
      }
      
      // Select random profile
      this.selectedProfile = this.deviceProfiles[Math.floor(Math.random() * this.deviceProfiles.length)];
      console.log(`📱 Selected device: ${this.selectedProfile?.device_name || 'Default'}`);
      this.testResults.deviceProfile = this.selectedProfile?.profile_id || null;
    } catch (error) {
      console.log(`⚠️ Could not load device profiles: ${error.message}`);
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
    
    this.browser = await BrowserType.launch({
      headless: process.env.HEADLESS !== 'false',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu'
      ]
    });

    // Create context with device profile if available
    const contextOptions = {};
    
    if (this.selectedProfile) {
      contextOptions.userAgent = this.selectedProfile.user_agent;
      contextOptions.viewport = {
        width: parseInt(this.selectedProfile.viewport_width),
        height: parseInt(this.selectedProfile.viewport_height)
      };
      contextOptions.deviceScaleFactor = parseFloat(this.selectedProfile.pixel_ratio);
    } else {
      // Default settings
      contextOptions.userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36';
      contextOptions.viewport = { width: 1366, height: 768 };
    }

    const context = await this.browser.newContext(contextOptions);
    this.page = await context.newPage();
    
    // Enable request/response monitoring
    this.page.on('request', request => {
      if (request.url().includes('facebook.com/tr') || request.url().includes('google-analytics.com')) {
        console.log(`📊 Tracking pixel fired: ${request.url()}`);
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

  async fillField(field, testData) {
    const { fieldType, selector, selectors, action, optional = false, required = true } = field;
    const actuallyRequired = required && !optional;
    
    try {
      // Handle both old and new selector formats
      const selectorsToTry = selectors || [selector];
      const foundSelector = await this.waitForElement(selectorsToTry, actuallyRequired ? 10000 : 3000);
      
      if (!foundSelector) {
        if (actuallyRequired) {
          throw new Error(`Required field not found: ${fieldType}`);
        } else {
          console.log(`⭐️ Optional field skipped: ${fieldType}`);
          return true;
        }
      }

      const element = await this.page.locator(foundSelector);
      
      // Get the correct test data value
      let dataValue = testData[fieldType];
      
      // Handle special cases for incorrect field type mappings
      if (fieldType === 'phone' && foundSelector.includes('zip')) {
        dataValue = testData.zipCode;
      }
      
      switch (action) {
        case 'clear_and_type':
          await element.clear();
          await element.fill(dataValue);
          break;
        case 'type':
          await element.fill(dataValue);
          break;
        case 'select':
          await element.selectOption(dataValue);
          break;
        case 'click':
          await element.click();
          break;
        default:
          throw new Error(`Unknown action: ${action}`);
      }
      
      console.log(`✅ ${fieldType}: ${dataValue || 'clicked'}`);
      
      // Brief delay to mimic human behavior
      const delay = this.config.settings?.delays?.betweenFields || [500, 1500];
      const randomDelay = Array.isArray(delay) 
        ? delay[0] + Math.random() * (delay[1] - delay[0])
        : delay;
      await this.page.waitForTimeout(randomDelay);
      
      return true;
    } catch (error) {
      console.log(`❌ Failed to fill ${fieldType}: ${error.message}`);
      if (actuallyRequired) throw error;
      return false;
    }
  }

  async navigateToNextPage(navigation, pageNumber) {
    const { selector, selectors, waitAfterClick = 2000, waitForUrlChange = false, retryIfNoNavigation = false } = navigation;
    
    try {
      const currentUrl = this.page.url();
      console.log(`🔄 Navigating from page ${pageNumber}...`);
      
      // Handle both old and new selector formats
      const selectorsToTry = selectors || [selector];
      const foundSelector = await this.waitForElement(selectorsToTry, 10000);
      
      if (!foundSelector) {
        throw new Error(`Navigation element not found`);
      }
      
      const element = await this.page.locator(foundSelector);
      await element.click();
      
      if (waitAfterClick) {
        await this.page.waitForTimeout(waitAfterClick);
      }
      
      if (waitForUrlChange) {
        let urlChanged = false;
        let retries = 0;
        const maxRetries = retryIfNoNavigation ? 3 : 1;
        
        while (!urlChanged && retries < maxRetries) {
          await this.page.waitForTimeout(2000);
          const newUrl = this.page.url();
          
          if (newUrl !== currentUrl) {
            urlChanged = true;
            console.log(`✅ URL changed: ${newUrl}`);
          } else if (retryIfNoNavigation && retries < maxRetries - 1) {
            console.log(`⚠️ No URL change detected, retrying click... (${retries + 1}/${maxRetries})`);
            await element.click();
            retries++;
          } else {
            retries++;
          }
        }
        
        if (!urlChanged && waitForUrlChange) {
          throw new Error('Expected URL change but none occurred');
        }
      }
      
      return true;
    } catch (error) {
      console.log(`❌ Navigation failed: ${error.message}`);
      throw error;
    }
  }

  async testPage(pageConfig, testData) {
    const { pageNumber, pageName, fields, navigation, pageDetection } = pageConfig;
    console.log(`\n🔄 Testing Page ${pageNumber}: ${pageName}`);
    
    const pageResult = {
      pageNumber,
      pageName,
      success: false,
      errors: [],
      fieldsCompleted: 0,
      totalFields: fields.length
    };

    try {
      // Check if we're on the right page
      if (pageDetection?.checkForElement) {
        const pageDetected = await this.waitForElement([pageDetection.checkForElement], 5000);
        if (!pageDetected) {
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
      
      // Navigate to entry point
      console.log(`🌐 Navigating to: ${this.config.metadata.entryPoint.startUrl}`);
      const startTime = Date.now();
      
      await this.page.goto(this.config.metadata.entryPoint.startUrl, {
        waitUntil: 'networkidle',
        timeout: 30000
      });
      
      this.testResults.metrics.initialPageLoad = Date.now() - startTime;
      
      // Test each page in sequence
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
          await this.page.screenshot({ 
            path: `failure-${Date.now()}.png`,
            fullPage: true 
          });
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

  // Export results for CI/CD
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

// Main execution function with multi-template support
async function runTest() {
  const configFile = process.argv[2] || './wfh_localjobmatcher.json';
  const deviceProfileFile = process.argv[3] || './android-device-profiles.csv.txt';
  
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
  
  const tester = new CPAFunnelTester(actualConfigFile, deviceProfileFile);
  
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
