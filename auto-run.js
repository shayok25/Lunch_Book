const fs = require('fs');
const { chromium } = require('playwright');

/* =====================================================
   🇧🇩 HOLIDAY CHECK
   ===================================================== */

const holidayData = JSON.parse(
  fs.readFileSync('holidays.json', 'utf8')
);

const holidays = holidayData.holidays;

// Bangladesh time
const now = new Date(
  new Date().toLocaleString('en-US', {
    timeZone: 'Asia/Dhaka'
  })
);

const tomorrow = new Date(now);
tomorrow.setDate(now.getDate() + 1);

const tomorrowStr = tomorrow.toLocaleDateString('en-CA', {
  timeZone: 'Asia/Dhaka'
});

const tomorrowHoliday = holidays.find(h => {
  if (h.date === tomorrowStr) return true;

  if (h.start_date && h.end_date) {
    return (
      tomorrowStr >= h.start_date &&
      tomorrowStr <= h.end_date
    );
  }

  return false;
});

/* =====================================================
   🧹 CLEANUP
   ===================================================== */

function cleanupAuthFile() {
  try {
    if (fs.existsSync('ulka-auth.json')) {
      fs.unlinkSync('ulka-auth.json');
    }
  } catch (err) {
    console.error('Cleanup failed:', err.message);
  }
}

/* =====================================================
   🚀 MAIN
   ===================================================== */

(async () => {
  try {

    /* =====================================================
       🚫 HOLIDAY EXIT
       ===================================================== */

    if (tomorrowHoliday) {
      console.log(`🎉 Holiday: ${tomorrowHoliday.name}`);

      fs.writeFileSync(
        'booking-status.txt',
        `SKIPPED_HOLIDAY|${tomorrowStr}|${tomorrowHoliday.name}`
      );

      console.log('🍱 Lunch booking skipped (holiday).');
      process.exit(0);
    }

    /* =====================================================
       🔐 AUTH
       ===================================================== */

    if (!process.env.ULKA_AUTH_JSON) {
      throw new Error('ULKA_AUTH_JSON missing');
    }

    fs.writeFileSync(
      'ulka-auth.json',
      Buffer.from(process.env.ULKA_AUTH_JSON, 'base64')
    );

    /* =====================================================
       🍱 BOOKING LOGIC
       ===================================================== */

    const MAX_RETRIES = 3;
    const RETRY_DELAY_MS = 5000;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      let browser;

      try {
        console.log(`🔁 Attempt ${attempt}`);

        browser = await chromium.launch({
          headless: true,
          args: ['--disable-dev-shm-usage', '--no-sandbox']
        });

        const context = await browser.newContext({
          storageState: 'ulka-auth.json'
        });

        const page = await context.newPage();

        await page.goto(
          'https://www.ulka.autos/lunch-booking',
          {
            timeout: 60000,
            waitUntil: 'networkidle'
          }
        );

        await page.waitForSelector('[role="switch"]', {
          timeout: 60000
        });

        await page.waitForTimeout(5000);

        const result = await page.evaluate(async () => {
          const sw = document.querySelector('[role="switch"]');

          if (!sw) return 'NO_SWITCH_FOUND';

          const aria = sw.getAttribute('aria-checked');

          const disabled =
            sw.classList.contains('ant-switch-disabled') ||
            sw.hasAttribute('disabled');

          if (aria === 'true' || disabled) {
            return 'ALREADY_BOOKED';
          }

          sw.click();

          await new Promise(r => setTimeout(r, 1500));

          return sw.getAttribute('aria-checked') === 'true'
            ? 'CLICKED_TO_BOOK'
            : 'CLICK_FAILED';
        });

        console.log('Result:', result);

        await page.waitForTimeout(2000);

        await page.screenshot({
          path: 'final-state.png',
          fullPage: true
        });

        if (result === 'CLICKED_TO_BOOK') {
          fs.writeFileSync('booking-status.txt', 'BOOKED');
          console.log('✅ Booking successful');
        } 
        else if (result === 'ALREADY_BOOKED') {
          fs.writeFileSync('booking-status.txt', 'ALREADY_BOOKED');
          console.log('ℹ️ Already booked');
        } 
        else {
          throw new Error(`Unexpected result: ${result}`);
        }

        await browser.close();
        cleanupAuthFile();
        process.exit(0);

      } catch (err) {
        console.error(`❌ Attempt ${attempt} failed`);
        console.error(err);

        if (browser) {
          await browser.close().catch(() => {});
        }

        if (attempt === MAX_RETRIES) {
          fs.writeFileSync('booking-status.txt', 'FAILED');
          console.error('❌ Booking failed after retries');
          cleanupAuthFile();
          process.exit(1);
        }

        console.log(`⏳ Retrying in ${RETRY_DELAY_MS / 1000}s...`);

        await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
      }
    }

  } catch (err) {
    console.error(err);
    cleanupAuthFile();
    process.exit(1);
  }
})();