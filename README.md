# 🍱 LUNCH_BOOK – Automated Lunch Booking  
**Playwright + GitHub Actions**

Automates lunch booking on  
👉 https://www.ulka.autos/lunch-booking  

Login **once manually**, then let GitHub Actions handle booking automatically on schedule.

---

## 📌 Features

- One-time manual login (OTP supported)
- Secure session storage using GitHub Secrets
- Automatic booking via cron schedule
- Retry logic for reliability
- Full-page screenshot proof committed to repo

---

## 📁 Project Structure

```text
.
├── .github/
│   └── workflows/
│       └── lunch.yml
├── auto-run.js
├── package.json
├── package-lock.json
├── README.md
```

> ⚠️ `ulka-auth.json` is **NOT committed**. It is stored securely in GitHub Secrets.

---

## 1️⃣ Prerequisites

- Windows (no admin access required)
- Node.js ≥ 18
- GitHub account
- Internet access

---

## 2️⃣ Install Node.js (No Admin)

Download ZIP from:
https://nodejs.org/dist/

Choose:
```powershell
node-v20.x.x-win-x64.zip
```

Extract to:
```powershell
C:\Users\<YOUR_USER>\nodejs
```

Add to PATH:
```powershell
setx PATH "$env:PATH;C:\Users\<YOUR_USER>\nodejs"
```

Verify:
```powershell
node -v
npm -v
```

---

## 3️⃣ Create Playwright Project

```powershell
mkdir LUNCH_BOOK
cd LUNCH_BOOK
npm init -y
npm i playwright
npx playwright install chromium
```

---

## 4️⃣ One-Time Manual Login

### login-once.js

```js
const { chromium } = require('playwright');
const readline = require('readline');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto('https://www.ulka.autos/lunch-booking');

  console.log(`
========================================
 LOGIN MANUALLY IN THE BROWSER
 After login is COMPLETE, press ENTER
========================================
`);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  await new Promise(resolve => rl.question('', resolve));
  rl.close();

  await context.storageState({ path: 'ulka-auth.json' });
  console.log('✅ Session saved to ulka-auth.json');

  await browser.close();
})();
```

Run:
```powershell
node login-once.js
```

---

## 5️⃣ Convert Session File to Secret

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("ulka-auth.json")) | Set-Clipboard
```

GitHub → Repo → Settings → Secrets → Actions

```
Name: ULKA_AUTH_JSON
Value: (paste clipboard)
```

---

## 6️⃣ Auto Booking Script

### auto-run.js

```js
const fs = require('fs');
const { chromium } = require('playwright');
const nodemailer = require('nodemailer');

/* =====================================================
   📧 MAIL SETUP
   ===================================================== */

async function sendMail({ subject, text, attachments = [] }) {
  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: {
      user: process.env.MAIL_USER,
      pass: process.env.MAIL_PASS
    }
  });

  await transporter.sendMail({
    from: `Lunch Bot 🍱 <${process.env.MAIL_USER}>`,
    to: process.env.MAIL_TO,
    subject,
    text,
    attachments
  });
}

/* =====================================================
   🇧🇩 HOLIDAY CHECK
   ===================================================== */

const holidayData = JSON.parse(fs.readFileSync('holidays.json', 'utf8'));
const holidays = holidayData.holidays;

// Bangladesh time
const now = new Date(
  new Date().toLocaleString('en-US', { timeZone: 'Asia/Dhaka' })
);

const tomorrow = new Date(now);
tomorrow.setDate(now.getDate() + 1);

const tomorrowStr = tomorrow.toLocaleDateString('en-CA', {
  timeZone: 'Asia/Dhaka'
});

// Holiday detection
const tomorrowHoliday = holidays.find(h => {
  if (h.date === tomorrowStr) return true;

  if (h.start_date && h.end_date) {
    return tomorrowStr >= h.start_date && tomorrowStr <= h.end_date;
  }

  return false;
});

/* =====================================================
   🚫 HOLIDAY EXIT
   ===================================================== */

(async () => {

if (tomorrowHoliday) {
  console.log(`🎉 Holiday: ${tomorrowHoliday.name}`);

  fs.writeFileSync(
    'booking-status.txt',
    `SKIPPED_HOLIDAY|${tomorrowStr}|${tomorrowHoliday.name}`
  );

  await sendMail({
    subject: "📅 Lunch Booking Skipped — Holiday",
    text: `📅 Tomorrow is a holiday.

🗓 Date: ${tomorrowStr}
🎉 Reason: ${tomorrowHoliday.name}

🍱 Lunch booking skipped automatically.`
  });

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

    browser = await chromium.launch({ headless: true });

    const context = await browser.newContext({
      storageState: 'ulka-auth.json'
    });

    const page = await context.newPage();

    await page.goto('https://www.ulka.autos/lunch-booking', {
      timeout: 60000
    });

    await page.waitForSelector('[role="switch"]', { timeout: 60000 });
    await page.waitForTimeout(5000);

    const result = await page.evaluate(() => {
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
      return 'CLICKED_TO_BOOK';
    });

    await page.waitForTimeout(2000);
    await page.screenshot({ path: 'final-state.png', fullPage: true });

    console.log('Result:', result);

    if (result === 'CLICKED_TO_BOOK') {
      fs.writeFileSync('booking-status.txt', 'BOOKED');

      await sendMail({
        subject: "✅ Lunch Booking Successful",
        text: "🍱 Lunch booking completed.\n\nScreenshot attached.",
        attachments: [
          { filename: 'final-state.png', path: 'final-state.png' }
        ]
      });

    } else {
      fs.writeFileSync('booking-status.txt', 'ALREADY_BOOKED');

      await sendMail({
        subject: "ℹ️ Lunch Already Booked",
        text: "Lunch was already booked. No action taken."
      });
    }

    await browser.close();
    process.exit(0);

  } catch (err) {
    console.error(`❌ Attempt ${attempt} failed`);
    console.error(err);

    if (browser) await browser.close().catch(() => {});

    if (attempt === MAX_RETRIES) {
      fs.writeFileSync('booking-status.txt', 'FAILED');

      await sendMail({
        subject: "❌ Lunch Booking Failed",
        text: "Booking failed after multiple attempts."
      });

      process.exit(1);
    }

    console.log(`⏳ Retrying in ${RETRY_DELAY_MS / 1000}s...`);
    await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
  }
}

})();
```

---

## 7️⃣ GitHub Actions Workflow

### .github/workflows/lunch.yml

```yml
name: Auto Lunch Booking

on:
  schedule:
    # Sunday → Thursday at 08:00 AM Bangladesh time (UTC+6)
    - cron: '0 2 * * 0,1,2,3,4'
  workflow_dispatch:

permissions:
  contents: write

jobs:
  book-lunch:
    runs-on: ubuntu-latest

    env:
      MAIL_USER: ${{ secrets.MAIL_USER }}
      MAIL_PASS: ${{ secrets.MAIL_PASS }}
      MAIL_TO: ${{ secrets.MAIL_TO }}
      ULKA_AUTH_JSON: ${{ secrets.ULKA_AUTH_JSON }}

    steps:
      - name: Checkout repository
        uses: actions/checkout@v5

      - name: Setup Node.js
        uses: actions/setup-node@v5
        with:
          node-version: 24

      - name: Install dependencies
        run: npm ci

      - name: Install Playwright Chromium
        run: npx playwright install chromium

      - name: Clean old artifacts
        run: rm -f final-state.png booking-status.txt

      - name: Run lunch booking bot
        run: node auto-run.js

      - name: Commit screenshot (only if booked)
        run: |
          if [ -f booking-status.txt ]; then
            STATUS=$(cat booking-status.txt)
            if [ "$STATUS" = "BOOKED" ]; then
              git config user.name "github-actions"
              git config user.email "github-actions@github.com"
              git add final-state.png
              git commit -m "📸 Update lunch booking screenshot [auto]" || echo "No changes"
              git push origin main
            fi
          fi
```
## Upload following file in repo:

- `package.json`
- `package-lock.json`
  
---
## If skiping holidays lunch book then add a `holidays.json` to the main

- `holidays.json`
### Add holidays such json format

```json
{
  "country": "Bangladesh",
  "year": 2026,
  "source": "ULKA Holiday Calendar 2026",
  "holidays": [
    {
      "date": "2026-02-04",
      "name": "Shab-e-Barat",
      "type": "Executive Order",
      "remarks": "Subject to moon sighting"
    },
    {
      "date": "2026-02-21",
      "name": "International Mother Language Day",
      "type": "General"
    },
    {
      "date": "2026-03-17",
      "name": "Laylat al-Qadr",
      "type": "Executive Order",
      "remarks": "Subject to moon sighting"
    },
    {
      "date": "2026-03-19",
      "name": "Eid ul-Fitr Holiday",
      "type": "Executive Order"
    },
    {
      "date": "2026-03-20",
      "name": "Jumatul Bidah + Eid ul-Fitr Holiday",
      "type": "General + Executive Order"
    },
    {
      "date": "2026-03-21",
      "name": "Eid ul-Fitr Holiday",
      "type": "General",
      "remarks": "Subject to moon sighting"
    },
    {
      "date": "2026-03-22",
      "name": "Eid ul-Fitr Holiday",
      "type": "Executive Order",
      "remarks": "Subject to moon sighting"
    },
    {
      "date": "2026-03-23",
      "name": "Eid ul-Fitr Holiday",
      "type": "Executive Order",
      "remarks": "Subject to moon sighting"
    },
    {
      "date": "2026-03-26",
      "name": "Independence Day",
      "type": "General"
    },
    {
      "date": "2026-04-14",
      "name": "Bengali New Year",
      "type": "Executive Order"
    },
    {
      "date": "2026-05-01",
      "name": "May Day + Buddha Purnima",
      "type": "General",
      "remarks": "Subject to moon sighting"
    },
    {
      "date": "2026-05-26",
      "name": "Eid ul-Adha Holiday",
      "type": "Executive Order",
      "remarks": "Subject to moon sighting"
    },
    {
      "date": "2026-05-27",
      "name": "Eid ul-Adha Holiday",
      "type": "Executive Order",
      "remarks": "Subject to moon sighting"
    },
    {
      "date": "2026-05-28",
      "name": "Eid ul-Adha Holiday",
      "type": "General",
      "remarks": "Subject to moon sighting"
    },
    {
      "date": "2026-05-29",
      "name": "Eid ul-Adha Holiday",
      "type": "Executive Order",
      "remarks": "Subject to moon sighting"
    },
    {
      "date": "2026-05-30",
      "name": "Eid ul-Adha Holiday",
      "type": "Executive Order",
      "remarks": "Subject to moon sighting"
    },
    {
      "date": "2026-05-31",
      "name": "Eid ul-Adha Holiday",
      "type": "Executive Order",
      "remarks": "Subject to moon sighting"
    },
    {
      "date": "2026-06-26",
      "name": "Ashura",
      "type": "Executive Order",
      "remarks": "Subject to moon sighting"
    },
    {
      "date": "2026-08-05",
      "name": "July Uprising Day",
      "type": "General"
    },
    {
      "date": "2026-08-26",
      "name": "Eid-e-Milad un-Nabi",
      "type": "General",
      "remarks": "Subject to moon sighting"
    },
    {
      "date": "2026-09-04",
      "name": "Shuba Janmashtami",
      "type": "General"
    },
    {
      "date": "2026-10-20",
      "name": "Durga Puja (Nabami)",
      "type": "Executive Order"
    },
    {
      "date": "2026-10-21",
      "name": "Durga Puja (Vijaya Dashami)",
      "type": "General"
    },
    {
      "date": "2026-12-16",
      "name": "Victory Day",
      "type": "General"
    },
    {
      "date": "2026-12-25",
      "name": "Christmas Day",
      "type": "General"
    }
  ]
}
```
---

## 🔐 Security Notes

- Repository must be **PRIVATE**
- Never commit `ulka-auth.json`
- Rotate session if login expires

---

## ✅ Done

Lunch booking will now run automatically via GitHub Actions.
