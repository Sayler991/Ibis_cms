// E2E : node e2e.js BASE_URL  (puppeteer-core + Chrome)
const p = require('/workspace/terrasse/ibis_tlemcen_site/work/node_modules/puppeteer-core');
const BASE = (process.argv[2] || 'https://sayler991.github.io/Ibis_cms/').replace(/\/?$/, '/');
const OUT = process.argv[3] || '/workspace/ibis_cms_shots/';
const PREFIX = process.argv[4] || '';
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const b = await p.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'], headless: 'new' });
  const res = {};
  const pg = await b.newPage(); const errs = [];
  pg.on('pageerror', e => errs.push(e.message)); pg.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await pg.setViewport({ width: 1366, height: 860 });
  await pg.goto(BASE + '?e2e=' + Date.now(), { waitUntil: 'networkidle2' });
  await pg.waitForFunction(() => document.documentElement.getAttribute('data-live') === 'supabase', { timeout: 20000 });
  res.live = 'supabase'; res.menuItems = await pg.$$eval('.ord-it', e => e.length);
  await sleep(1500); await pg.screenshot({ path: OUT + PREFIX + 'site_desktop_hero.png' });
  await pg.evaluate(() => document.querySelector('#commander').scrollIntoView()); await sleep(1500);
  // panier : 2 × 1er article, 1 × dernier article
  const plus = async (i) => { await pg.evaluate(i => { const b = document.querySelectorAll('.ord-it [data-q="1"]'); (i < 0 ? b[b.length + i] : b[i]).click(); }, i); await sleep(150); };
  await plus(0); await plus(0); await plus(-1);
  await pg.type('#ord-room', '101'); await pg.type('#ord-name', 'TEST E2E ibis'); await pg.type('#ord-phone', '0550 00 00 01');
  await pg.type('#ord-notes', 'Commande de test automatique — à supprimer');
  await pg.screenshot({ path: OUT + PREFIX + 'site_desktop_order_form.png' });
  await pg.click('#ord-send');
  await pg.waitForSelector('#ord-msg .ord-msg', { timeout: 20000 });
  res.orderMsg = await pg.$eval('#ord-msg', e => e.textContent.trim());
  await pg.evaluate(() => document.querySelector('#ord-form').scrollIntoView({ block: 'center' })); await sleep(600);
  await pg.screenshot({ path: OUT + PREFIX + 'site_desktop_order_sent.png' });
  res.siteErrors = errs.slice();
  // mobile
  const m = await b.newPage();
  await m.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await m.goto(BASE, { waitUntil: 'networkidle2' }); await sleep(2000);
  await m.screenshot({ path: OUT + PREFIX + 'site_mobile_hero.png' });
  await m.evaluate(() => document.querySelector('#commander').scrollIntoView()); await sleep(1500);
  await m.screenshot({ path: OUT + PREFIX + 'site_mobile_order.png' });
  // admin
  const a = await b.newPage(); const aerr = [];
  a.on('pageerror', e => aerr.push(e.message));
  await a.setViewport({ width: 1280, height: 800 });
  await a.goto(BASE + 'admin/', { waitUntil: 'networkidle2' });
  await a.waitForSelector('#login:not([hidden])', { timeout: 15000 }); await sleep(500);
  await a.screenshot({ path: OUT + PREFIX + 'admin_login.png' });
  await a.type('#login-email', 'benduy0@gmail.com'); await a.type('#login-pw', 'mauvais-mot-de-passe-test');
  await a.click('#login-form button'); await a.waitForSelector('#login-err:not([hidden])', { timeout: 15000 });
  res.adminWrongPw = await a.$eval('#login-err', e => e.textContent); res.adminErrors = aerr;
  console.log(JSON.stringify(res, null, 1));
  await b.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
