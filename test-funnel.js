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

  // Improved page inspection with better debugging info
  async inspectPageForAlternatives(originalSelector) {
    try {
      console.log(`🔍 Inspecting page for alternatives to: ${originalSelector}`);
      
      // Get page title and URL for context
      const title = await this.page.title();
      const url = this.page.url();
      console.log(`📄 Current page: "${title}" at ${url}`);
      
      // Check if we're still on Facebook (redirect failed)
      if (url.includes('facebook.com')) {
        console.log(`🚨 WARNING: Still on Facebook page - redirect may have failed`);
        
        // Try to find and click any external links again
        const externalLinks = await this.page.$$eval('a[href*="opph3hftrk.com"], a[href*="HMLWQ96"]', links => 
          links.map(link => ({
            href: link.href,
            text: link.textContent?.trim(),
            visible: !link.hidden && link.offsetParent !== null
          }))
        );
        
        if (externalLinks.length > 0) {
          console.log(`🔗 Found ${externalLinks.length} potential external links:`);
          externalLinks.forEach((link, i) => {
            console.log(`  ${i + 1}. ${link.href} - "${link.text}" (visible: ${link.visible})`);
          });
        }
        
        return { inputs: [], buttons: [], externalLinks, onFacebook: true };
      }
      
      // Try to find input elements
      const inputs = await this.page.$$eval('input', elements => 
        elements.map(el => ({
          type: el.type,
          name: el.name,
          id: el.id,
          placeholder: el.placeholder,
          class: el.className,
          tagName: el.tagName,
          visible: !el.hidden && el.offsetParent !== null
        }))
      );
      
      if (inputs.length > 0) {
        console.log(`🔍 Found ${inputs.length} input elements:`);
        inputs.forEach((input, i) => {
          const visibility = input.visible ? '✅' : '❌';
          console.log(`  ${i + 1}. ${visibility} ${input.tagName} - type: ${input.type}, name: "${input.name}", id: "${input.id}", placeholder: "${input.placeholder}"`);
        });
      }
      
      // Try to find button elements
      const buttons = await this.page.$$eval('button, input[type="submit"], a[role="button"]', elements => 
        elements.map(el => ({
          text: el.textContent?.trim(),
          type: el.type,
          id: el.id,
          class: el.className,
          tagName: el.tagName,
          role: el.getAttribute('role'),
          visible: !el.hidden && el.offsetParent !== null
        }))
      );
      
      if (buttons.length > 0) {
        console.log(`🔍 Found ${buttons.length} clickable elements:`);
        buttons.forEach((button, i) => {
          const visibility = button.visible ? '✅' : '❌';
          console.log(`  ${i + 1}. ${visibility} ${button.tagName} - text: "${button.text}", id: "${button.id}", class: "${button.class}"`);
        });
      }
      
      return { inputs, buttons, onFacebook: false };
    } catch (error) {
      console.log(`⚠️ Page inspection failed: ${error.message}`);
      return { inputs: [], buttons: [], onFacebook: false };
    }
  }

  async fillField(field, testData) {
    const { fieldType, selector, selectors, action, optional = false, required = true } = field;
    const actuallyRequired = required && !optional;
    
    try {
      // Handle both old and new selector formats
      const selectorsToTry = selectors || [selector];
      const foundSelector = await this.waitForElement(selectorsToTry, actuallyRequired ? 10000 : 3000);
      
      if (!foundSelector) {
        // If required field not found, try to inspect the page
        if (actuallyRequired) {
          await this.inspectPageForAlternatives(selector);
          throw new Error(`Required field not found: ${fieldType}`);
        } else {
          console.log(`⭐ Optional field skipped: ${fieldType}`);
          return true;
        }
      }

      // Handle multiple elements by using .first() or .nth(0)
      const element = await this.page.locator(foundSelector).first();
      
      // Check if multiple elements exist and log it
      const count = await this.page.locator(foundSelector).count();
      if (count > 1) {
        console.log(`🔍 Found ${count} matching elements for ${fieldType}, using the first one`);
      }
      
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

  // Improved navigation with better Facebook link handling
  async navigateToNextPage(navigation, pageNumber) {
    const { selector, selectors, waitAfterClick = 2000, waitForUrlChange = false, retryIfNoNavigation = false, expectNewTab = false, maxWaitTime = 30000 } = navigation;
    
    try {
      const currentUrl = this.page.url();
      console.log(`🔄 Navigating from page ${pageNumber}...`);
      
      // Handle both old and new selector formats
      const selectorsToTry = selectors || [selector];
      const foundSelector = await this.waitForElement(selectorsToTry, 10000);
      
      if (!foundSelector) {
        // Inspect page for navigation alternatives
        const inspection = await this.inspectPageForAlternatives(selector);
        
        // If we're on Facebook and have external links, try one more attempt
        if (inspection.onFacebook && inspection.externalLinks && inspection.externalLinks.length > 0) {
          console.log(`🔄 Attempting to click external link directly...`);
          const visibleLink = inspection.externalLinks.find(link => link.visible);
          if (visibleLink) {
            await this.page.goto(visibleLink.href, { waitUntil: 'domcontentloaded', timeout: maxWaitTime });
            console.log(`🌐 Direct navigation to: ${this.page.url()}`);
            return true;
          }
        }
        
        throw new Error(`Navigation element not found`);
      }
      
      // Handle multiple elements by using .first() or .nth(0)
      const element = await this.page.locator(foundSelector).first();
      
      // Check if multiple elements exist and log it
      const count = await this.page.locator(foundSelector).count();
      if (count > 1) {
        console.log(`🔍 Found ${count} matching elements, clicking the first one`);
      }
      
      // Improved Facebook link handling
      if (currentUrl.includes('facebook.com') && expectNewTab) {
        console.log('📱 Detected Facebook page - attempting improved new tab navigation...');
        
        try {
          // Get the href attribute to navigate directly if needed
          const href = await element.getAttribute('href');
          console.log(`🔗 Link href: ${href}`);
          
          // Try clicking and handling new page
          const newPagePromise = this.page.context().waitForEvent('page');
          await element.click();
          
          try {
            const newPage = await Promise.race([
              newPagePromise,
              new Promise((_, reject) => setTimeout(() => reject(new Error('New tab timeout')), 15000))
            ]);
            
            console.log(`🔗 New tab opened: ${newPage.url()}`);
            
            // Wait for redirect chain to complete
            await this.handleFacebookRedirects(newPage, maxWaitTime);
            
            // Switch to the new page
            this.page = newPage;
            
            // Set up monitoring for new page
            this.page.on('request', request => {
              if (request.url().includes('facebook.com/tr') || request.url().includes('google-analytics.com')) {
                console.log(`📊 Tracking pixel fired: ${request.url()}`);
              }
            });
            
            return true;
            
          } catch (newTabError) {
            console.log(`⚠️ New tab failed: ${newTabError.message}`);
            
            // Fallback: try direct navigation if we have the href
            if (href && href.includes('opph3hftrk.com')) {
              console.log(`🔄 Fallback: Direct navigation to ${href}`);
              await this.page.goto(href, { waitUntil: 'domcontentloaded', timeout: maxWaitTime });
              return true;
            }
          }
        } catch (error) {
          console.log(`⚠️ Facebook navigation failed: ${error.message}`);
        }
      }
      
      // Regular click handling for non-Facebook pages
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
        
        if (!urlChanged && waitForUrlChange && !currentUrl.includes('facebook.com')) {
          throw new Error('Expected URL change but none occurred');
        }
      }
      
      return true;
    } catch (error) {
      console.log(`❌ Navigation failed: ${error.message}`);
      throw error;
    }
  }

  // New method to handle Facebook redirect chains more reliably
  async handleFacebookRedirects(page, maxWaitTime = 30000) {
    let finalUrl = page.url();
    let redirectCount = 0;
    const maxRedirects = 10;
    const startTime = Date.now();
    
    // Wait for initial load
    try {
      await page.waitForLoadState('domcontentloaded', { timeout: 10000 });
    } catch (error) {
      console.log(`⚠️ Initial load timeout: ${error.message}`);
    }
    
    while (finalUrl.includes('l.facebook.com') && redirectCount < maxRedirects && (Date.now() - startTime) < maxWaitTime) {
      console.log(`🔄 Waiting for Facebook redirect ${redirectCount + 1}/${maxRedirects}...`);
      await page.waitForTimeout(2000);
      
      const currentUrl = page.url();
      if (currentUrl !== finalUrl) {
        finalUrl = currentUrl;
        console.log(`🔗 Redirected to: ${finalUrl}`);
      }
      redirectCount++;
      
      // If we're no longer on a Facebook domain, we're probably at the destination
      if (!currentUrl.includes('facebook.com')) {
        console.log(`✅ Left Facebook domain, reached: ${currentUrl}`);
        break;
      }
    }
    
    // Final wait for page to be ready
    await page.waitForTimeout(3000);
    
    try {
      await page.waitForLoadState('networkidle', { timeout: 5000 });
    } catch (error) {
      console.log(`⚠️ Network idle timeout: ${error.message}`);
    }
    
    console.log(`✅ Final destination: ${page.url()}`);
  }

  async testPage(pageConfig, testData) {
    const { pageNumber, pageName, fields, navigation, pageDetection } = pageConfig;
    console.log(`\n📄 Testing Page ${pageNumber}: ${pageName}`);
    
    const pageResult = {
      pageNumber,
      pageName,
      success: false,
      errors: [],
      fieldsCompleted: 0,
      totalFields: fields.length
    };

    try {
      // Extra wait for page to settle after navigation
      if (pageNumber > 0) {
        console.log('⏳ Waiting for page to fully load...');
        await this.page.waitForTimeout(5000);
        
        try {
          await this.page.waitForLoadState('networkidle', { timeout: 10000 });
        } catch (networkError) {
          console.log('⚠️ NetworkIdle timeout, continuing with page detection...');
        }
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
      
      // Try direct navigation to landing page first
      let startUrl = this.config.metadata.entryPoint.startUrl;
      
      // If direct URL fails, fall back to Facebook
      console.log(`🌐 Attempting direct navigation to: ${startUrl}`);
      
      try {
        const startTime = Date.now();
        await this.page.goto(startUrl, {
          waitUntil: 'networkidle',
          timeout: 30000
        });
        
        this.testResults.metrics.initialPageLoad = Date.now() - startTime;
        
        // Check if we successfully reached the landing page
        const currentUrl = this.page.url();
        console.log(`📍 Current URL after navigation: ${currentUrl}`);
        
        if (currentUrl.includes('facebook.com')) {
          console.log(`⚠️ Redirected to Facebook, will handle via Facebook flow`);
        } else if (currentUrl.includes('opph3hftrk.com')) {
          console.log(`✅ Successfully reached landing page directly`);
          // Skip the Facebook page (page 0) and start from page 1
          const funnelPages = this.config.funnel.pages.slice(1);
          for (const pageConfig of funnelPages) {
            await this.testPage({ ...pageConfig, pageNumber: pageConfig.pageNumber - 1 }, testData);
          }
          
          this.testResults.success = true;
          this.testResults.endTime = new Date().toISOString();
          this.testResults.totalDuration = Date.now() - new Date(this.testResults.startTime).getTime();
          
          console.log('\n🎉 FUNNEL TEST COMPLETED SUCCESSFULLY (DIRECT)!');
          this.logResults();
          return;
        }
        
      } catch (directNavError) {
        console.log(`⚠️ Direct navigation failed: ${directNavError.message}`);
        
        // Try fallback URL if available
        if (this.config.metadata.entryPoint.fallbackUrl) {
          console.log(`🔄 Trying fallback URL: ${this.config.metadata.entryPoint.fallbackUrl}`);
          startUrl = this.config.metadata.entryPoint.fallbackUrl;
          await this.page.goto(startUrl, {
            waitUntil: 'networkidle',
            timeout: 30000
          });
        } else {
          throw directNavError;
        }
      }
      
      // Wait a bit more for dynamic content
      await this.page.waitForTimeout(3000);
      
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
          console.log(`📸 Screenshot saved: failure-${Date.now()}.png`);
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

// Main execution function with multi-template support
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
      deviceProfileFile = availableProfiles[0]; // Default to first found
      console.log(`📱 Auto-discovered device profiles: ${deviceProfileFile}`);
    }
  } else {
    // Check if specified device profile file exists
    try {
      await fs.access(deviceProfileFile);
    } catch (error) {
      console.log(`⚠️ Specified device profile ${deviceProfileFile} not found. Searching...`);
      const availableProfiles = await findDeviceProfileFiles();
      if (availableProfiles.length > 0) {
        deviceProfileFile = availableProfiles[0];
        console.log(`📱 Using alternative device profiles: ${deviceProfileFile}`);
      } else {
        deviceProfileFile = null;
        console.log(`⚠️ No device profile files found, proceeding with defaults`);
      }
    }
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
