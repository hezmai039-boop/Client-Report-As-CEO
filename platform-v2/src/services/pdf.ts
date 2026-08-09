import puppeteer, { type Browser } from 'puppeteer';

/**
 * توليد PDF من HTML التقرير (المهمة 4 من README) — puppeteer يعرض
 * HTML بمحرك Chromium فيدعم العربية RTL كاملة بلا أي معالجة خاصة،
 * بعكس pdfkit الذي يتطلب خطوطاً وتشكيلاً يدوياً.
 *
 * المتصفح يُفتح مرة واحدة ويُعاد استخدامه — عند 1000 تقرير لا نفتح
 * 1000 متصفح، بل صفحة واحدة لكل تقرير تُغلق فوراً.
 */

let browserPromise: Promise<Browser> | null = null;

function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
  }
  return browserPromise;
}

export async function htmlToPdf(html: string): Promise<Buffer> {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: 'load' });
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '20mm', bottom: '20mm', left: '15mm', right: '15mm' },
    });
    return Buffer.from(pdf);
  } finally {
    await page.close();
  }
}

export async function closePdfBrowser(): Promise<void> {
  if (browserPromise) {
    const b = await browserPromise;
    await b.close();
    browserPromise = null;
  }
}
