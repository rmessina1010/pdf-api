const express = require('express');
const { chromium } = require('playwright');

const app = express();
app.use(express.json({ limit: '10mb' }));

app.post('/api/generate', async (req, res) => {
  const { html, css } = req.body;
  let browser;

  try {
    // Launch Chromium via Playwright (headless is true by default)
    browser = await chromium.launch();
    const page = await browser.newPage();

    // Load the HTML structure ('networkidle' replaces Puppeteer's 'networkidle0')
    await page.setContent(html, { waitUntil: 'networkidle' });

    // Inject the CSS styles
    if (css) {
      await page.addStyleTag({ content: css });
    }

    // Generate the PDF buffer in memory
    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '20px', right: '20px', bottom: '20px', left: '20px' }
    });

    // Send raw binary buffer with PDF headers
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Length': pdfBuffer.length
    });
    res.send(pdfBuffer);

  } catch (error) {
    console.error('Error generating PDF:', error);
    res.status(500).json({ error: 'Failed to generate PDF' });
  } finally {
    if (browser) await browser.close();
  }
});

app.listen(3000, () => console.log('Server running on port 3000'));
