const { chromium } = require('playwright');
const fs = require('fs').promises;

class CPAFunnelTester {
  constructor(configPath) {
    this.browser = null;
    this.page = null;
    this.config = null;
    this.configPath = configPath;
    this.testResults = {
      startTime: new Date().toISOString(),
      success: false,
      errors: [],
      pageResults: [],
      metrics: {}
    };
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

  async initBrowser() {
    this.browser = await chromium.launch({
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

    this.page = await this.browser.newPage();
    
    // Set realistic viewport and user agent
    await this.page.setViewportSize({ width: 1366, height: 768 });
    await this.page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
    
    // Enable request/response monitoring
    this.page.on('request', request => {
      if (request.url().includes('facebook.com/tr') || request.url().includes('google-analytics.com')) {
        console.log(`📊 Tracking pixel fired: ${request.url()}`);
      }
    });
    
    console.log('🚀 Browser initialized');
  }

  generateTestData() {
    const timestamp = Date.now();
    return {
      zipCode: '10001',
      firstName: `Test${timestamp}`,
      lastName: `User${timestamp}`,
      email: `test${timestamp}@testdomain.com`,
      phone: '5551234567',
      dobMonth: '01',
      dobDay: '15',
      dobYear: '1990'
    };
  }

  async waitForElement(selector, timeout = 10000) {
    try {
      await this.page.waitForSelector(selector, { timeout, state: 'visible' });
      return true;
    } catch (error) {
      console.log(`⚠️  Element not found: ${selector}`);
      return false;
    }
  }

  async fillField(field, testData) {
    const { fieldType, selector, action, optional = false } = field;
    
    try {
      const elementExists = await this.waitForElement(selector, optional ? 3000 : 10000);
      
      if (!elementExists) {
        if (optional) {
          console.log(`⏭️  Optional field skipped: ${fieldType}`);
          return true;
        }
        throw new Error(`Required field not found: ${fieldType} (${selector})`);
      }

      const element = await this.page.locator(selector);
      
      switch (action) {
        case 'clear_and_type':
          await element.clear();
          await element.fill(testData[fieldType]);
          break;
        case 'type':
          await element.fill(testData[fieldType]);
          break;
        case 'select':
          await element.selectOption(testData[fieldType]);
          break;
        case 'click':
          await element.click();
          break;
        default:
          throw new Error(`Unknown action: ${action}`);
      }
      
      console.log(`✅ ${fieldType}: ${testData[fieldType] || 'clicked'}`);
      
      // Brief delay to mimic human behavior
      await this.page.waitForTimeout(500 + Math.random() * 1000);
      
      return true;
    } catch (error) {
      console.log(`❌ Failed to fill ${fieldType}: ${error.message}`);
      if (!optional) throw error;
      return false;
    }
  }

  async navigateToNextPage(navigation, pageNumber) {
    const { selector, waitAfterClick = 2000, waitForUrlChange = false, retryIfNoNavigation = false } = navigation;
    
    try {
      const currentUrl = this.page.url();
      console.log(`🔄 Navigating from page ${pageNumber}...`);
      
      const element = await this.page.locator(selector);
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
            console.log(`⚠️  No URL change detected, retrying click... (${retries + 1}/${maxRetries})`);
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
      // Check if we're on the right page
      if (pageDetection?.checkForElement) {
        const pageDetected = await this.waitForElement(pageDetection.checkForElement, 5000);
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
          if (!field.optional) throw error;
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
      
      console.log(`\n💥 TEST FAILED: ${error.message}`);
      
      // Take screenshot on failure
      if (this.page) {
        await this.page.screenshot({ 
          path: `failure-${Date.now()}.png`,
          fullPage: true 
        });
      }
      
      throw error;
    } finally {
      await this.cleanup();
    }
  }

  logResults() {
    console.log('\n📊 TEST RESULTS SUMMARY:');
    console.log(`⏱️  Total Duration: ${this.testResults.totalDuration}ms`);
    console.log(`📄 Pages Tested: ${this.testResults.pageResults.length}`);
    console.log(`✅ Success Rate: ${this.testResults.pageResults.filter(p => p.success).length}/${this.testResults.pageResults.length}`);
    
    this.testResults.pageResults.forEach(result => {
      const status = result.success ? '✅' : '❌';
      console.log(`${status} Page ${result.pageNumber} (${result.pageName}): ${result.fieldsCompleted}/${result.totalFields} fields`);
      
      if (result.errors.length > 0) {
        result.errors.forEach(error => console.log(`   ⚠️  ${error}`));
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
    await fs.writeFile(outputPath, JSON.stringify(this.testResults, null, 2));
    console.log(`💾 Results saved to ${outputPath}`);
  }
}

// Main execution
async function runTest() {
  const tester = new CPAFunnelTester('./wfh_localjobmatcher.json');
  
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

module.exports = { CPAFunnelTester };
