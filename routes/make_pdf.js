const express = require('express');
const rateLimit = require('express-rate-limit');
const pLimit = require('p-limit');
const { chromium } = require('playwright');
const router = express.Router();

// 1. Rate limiting per IP
const pdfLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many PDF requests, please try again shortly.' }
});

// 2. Hardware-tuned concurrency & queue settings (sized for ~2 vCPU / 4 GB RAM)
const MAX_CONCURRENT_RENDERS = 3;
const MAX_QUEUE_SIZE = 15;
const MAX_RENDERS_BEFORE_RECYCLE = 300;

const limit = pLimit(MAX_CONCURRENT_RENDERS);

// 3. Safe Browser Lifecycle & Recycling Manager
let activeBrowser = null;
let browserLaunchPromise = null;
let renderCount = 0;

async function acquireBrowser() {
  // Recycle if we hit the render threshold
  if (activeBrowser && renderCount >= MAX_RENDERS_BEFORE_RECYCLE) {
    const retiringBrowser = activeBrowser;
    activeBrowser = null;
    browserLaunchPromise = null;
    renderCount = 0;

    // Close the old browser gracefully once its remaining contexts finish
    setTimeout(async () => {
      try {
        while (retiringBrowser.contexts().length > 0) {
          await new Promise((r) => setTimeout(r, 500));
        }
        await retiringBrowser.close();
      } catch (err) {
        console.error('Error closing retired browser:', err);
      }
    }, 1000);
  }

  // Prevent race conditions if multiple requests arrive while Chromium is booting
  if (!activeBrowser || !activeBrowser.isConnected()) {
    if (!browserLaunchPromise) {
      browserLaunchPromise = chromium.launch({
        args: ['--no-sandbox', '--disable-dev-shm-usage']
      }).then((browser) => {
        activeBrowser = browser;
        browserLaunchPromise = null;
        return browser;
      }).catch((err) => {
        browserLaunchPromise = null;
        throw err;
      });
    }
    return browserLaunchPromise;
  }

  return activeBrowser;
}

router.get('/test', async (req, res) => {
    return res.send("success!!");
});

router.post('/generate', pdfLimiter, async (req, res) => {
  // const { html, css } = req.body;

  // if (!html || typeof html !== 'string') {
  //   return res.status(400).json({ error: 'Valid HTML string is required.' });
  // }

  if (limit.pendingCount >= MAX_QUEUE_SIZE) {
    res.set('Retry-After', '5');
    return res.status(503).json({ error: 'PDF service is at capacity. Retry shortly.' });
  }

  try {
    const pdfBuffer = await limit(async () => {
      const browser = await acquireBrowser();
      renderCount += 1;
      const context = await browser.newContext();

      try {
        await context.route('**/*', (route) => {
          const url = route.request().url();
          if (url.startsWith('data:') || url.startsWith('about:')) {
            return route.continue();
          }
          return route.abort();
        });

        const page = await context.newPage();
        await page.navigate('https://raymessinadesign.com/resume.php', { waitUntil: 'load', timeout: 10000 });
         
        // await page.setContent(html, { waitUntil: 'load', timeout: 10000 });

        // if (css && typeof css === 'string') {
        //   await page.addStyleTag({ content: css });
        // }

        return await page.pdf({
          format: 'Letter',
          printBackground: true,
          margin: { top: '36px', right: '36px', bottom: '36px', left: '36px' }
        });
      } finally {
        await context.close();
      }
    });

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Length': pdfBuffer.length
    });
    return res.send(pdfBuffer);

  } catch (error) {
    console.error('Error generating PDF:', error);
    return res.status(500).json({ error: 'Failed to generate PDF' });
  }
});

module.exports = router;
