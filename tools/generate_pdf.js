#!/usr/bin/env node
/**
 * Generate print-ready PDF from academic homepage HTML files.
 * Usage: node tools/generate_pdf.js [en|zh|both]
 * Output: tools/output/HuXu_CV_en.pdf, tools/output/HuXu_CV_zh.pdf
 */

const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const OUTPUT_DIR = path.join(__dirname, 'output');

const TARGETS = {
  en: {
    file: path.join(ROOT, 'index.html'),
    output: path.join(OUTPUT_DIR, 'HuXu_CV_en.pdf'),
    label: 'English',
  },
  zh: {
    file: path.join(ROOT, 'Chinese', 'index.html'),
    output: path.join(OUTPUT_DIR, 'HuXu_CV_zh.pdf'),
    label: 'Chinese',
  },
};

// Print-specific CSS injected at render time (not saved to source files)
const PRINT_CSS = `
  /* Hide interactive / decorative elements */
  #back_top,
  iframe,
  .menu { display: none !important; }

  /* Hide shields.io star-count badge images */
  img[src*="shields.io"] { display: none !important; }

  /* Reset page layout for print */
  body {
    font-family: "Times New Roman", Times, serif;
    font-size: 9pt;
    line-height: 1.2;
    color: #000;
    background: #fff;
    margin: 0;
    padding: 0;
  }

  #container, .container {
    width: 100% !important;
    max-width: 794px !important;
    margin: 0 !important;
    padding: 0 !important;
    box-sizing: border-box;
  }

  /* Profile table */
  table.imgtable {
    width: 100%;
    margin-bottom: 4pt;
  }

  table.imgtable img[alt] {
    height: 90px !important;
    width: auto !important;
  }

  /* Social icon links — shrink to 16px */
  p[style*="margin-top"] a img,
  p a img[height="32px"],
  p a img[height="30px"] {
    height: 16px !important;
    width: auto !important;
    vertical-align: middle;
  }

  /* jemdoc font tags add unwanted block margins — neutralize */
  font[size="3"] {
    display: block;
    margin: 0 !important;
    padding: 0 !important;
  }

  /* Section headings */
  h2 {
    font-size: 10.5pt;
    border-bottom: 1px solid #224B8D;
    padding-bottom: 1pt;
    margin-top: 6pt;
    margin-bottom: 2pt;
    color: #224B8D;
    page-break-after: avoid;
  }

  /* Tighten list spacing */
  ul {
    margin-top: 0;
    margin-bottom: 0;
    padding-left: 1.1em;
  }

  li {
    page-break-inside: auto;
    margin-bottom: 1pt;
    line-height: 1.2;
  }

  p {
    margin-top: 1pt;
    margin-bottom: 1pt;
  }

  /* Bold sub-labels like "Conferences", "Journals" */
  p > b {
    display: inline;
  }

  /* Avoid breaking a section heading from its content */
  h2 + ul, h2 + p, h2 + font {
    page-break-before: avoid;
  }

  a {
    color: #224B8D !important;
    text-decoration: none;
  }

  /* Page size and margins — preferCSSPageSize:true makes puppeteer use these */
  @page {
    size: A4;
  }
`;

async function generatePDF(target) {
  const fileUrl = 'file://' + target.file;
  console.log(`[${target.label}] Rendering: ${target.file}`);

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();

    // Set viewport exactly to A4 width at 96dpi so no scaling occurs in PDF output
    await page.setViewport({ width: 794, height: 1123, deviceScaleFactor: 1 });

    await page.goto(fileUrl, { waitUntil: 'networkidle0', timeout: 30000 });

    // Remove elements that bloat the page before measuring layout
    await page.evaluate(() => {
      // Revolvermaps script tags
      document.querySelectorAll('script[src*="revolvermaps"]').forEach(el => el.remove());
      // shields.io badges (remove the wrapping <a> so no empty link remains)
      document.querySelectorAll('img[src*="shields.io"]').forEach(el => {
        const a = el.closest('a');
        if (a) a.remove(); else el.remove();
      });

      // Move nav shortcut bar out of the table cell, place it after the table as its own block
      const navEl = document.querySelector('[class="staffshortcut"]');
      if (navEl) {
        const table = document.querySelector('table.imgtable');
        if (table && table.parentNode) {
          // Collect all nav link nodes (the <A> tags and text nodes between them)
          // They sit between the <class> tag and the next <br><br>
          const navLinks = [];
          let node = navEl.nextSibling;
          while (node) {
            const next = node.nextSibling;
            if (node.nodeName === 'BR') break; // stop at first <br>
            navLinks.push(node);
            node = next;
          }

          // Build a wrapper <p> after the table
          const wrapper = document.createElement('p');
          wrapper.style.cssText = 'margin: 4pt 0 4pt 0; border-bottom: 1px solid #ccc; padding-bottom: 4pt;';
          navLinks.forEach(n => wrapper.appendChild(n.cloneNode(true)));
          table.parentNode.insertBefore(wrapper, table.nextSibling);

          // Remove original nav content from inside the td
          navEl.remove();
          navLinks.forEach(n => n.remove());
        }
      }

      // Remove leftover <br> pairs in the table cell header area
      Array.from(document.querySelectorAll('td br')).forEach(br => br.remove());
    });

    // Inject print CSS
    await page.addStyleTag({ content: PRINT_CSS });

    // Brief pause for style recalc
    await new Promise(r => setTimeout(r, 500));

    await page.pdf({
      path: target.output,
      format: 'A4',
      printBackground: false,
      scale: 0.95,
      margin: { top: '10mm', right: '12mm', bottom: '10mm', left: '12mm' },
      displayHeaderFooter: false,
    });

    console.log(`[${target.label}] Saved: ${target.output}`);
  } finally {
    await browser.close();
  }
}

async function main() {
  const arg = process.argv[2] || 'both';
  const keys = arg === 'both' ? ['en', 'zh'] : [arg];

  for (const key of keys) {
    if (!TARGETS[key]) {
      console.error(`Unknown target "${key}". Use: en | zh | both`);
      process.exit(1);
    }
  }

  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  for (const key of keys) {
    await generatePDF(TARGETS[key]);
  }

  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
