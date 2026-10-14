const p = require('/workspace/terrasse/ibis_tlemcen_site/work/node_modules/puppeteer-core');
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const b = await p.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'], headless: 'new' });
  const ctx = b.defaultBrowserContext(); await ctx.overridePermissions('http://127.0.0.1:8797', ['notifications']);
  const pg = await b.newPage(); await pg.setViewport({ width: 1280, height: 720 });
  await pg.evaluateOnNewDocument(() => { window.NOTIFS = []; const N = function (t, o) { NOTIFS.push(t + ' | ' + o.body); }; N.permission = 'granted'; N.requestPermission = () => Promise.resolve('granted'); window.Notification = N;
    const AC = window.AudioContext; window.BEEPS = 0; window.AudioContext = function () { const a = new AC(); const o = a.createOscillator.bind(a); a.createOscillator = function () { window.BEEPS++; return o(); }; return a; }; });
  await pg.goto('http://127.0.0.1:8797/harness.html', { waitUntil: 'networkidle0' }); await sleep(800);
  await pg.evaluate(() => location.hash = '#clients');
  // 1) commande via Realtime
  await pg.evaluate(() => rtHandler({ new: { id: 42, total: 0, fulfillment: 'chambre', address: '101', customer_id: 'c1' } })); await sleep(600);
  // 2) commande via relève 30 s
  await pg.evaluate(() => { pollRows.push({ id: 43, total: 1500, fulfillment: 'sur_place', address: 'T4', customers: { name: 'Client relève' } }); window.__poll(); }); await sleep(600);
  const r = await pg.evaluate(() => ({ title: document.title, badge: (document.querySelector('.al-badge') || {}).textContent, banners: [...document.querySelectorAll('.al-banner')].map(e => e.textContent), notifs: NOTIFS, beeps: BEEPS, log: LOG, perm: !!document.querySelector('.al-perm'), rt: document.documentElement.getAttribute('data-realtime') }));
  await pg.screenshot({ path: '/workspace/ibis_cms_shots/admin_alert_mock.png' });
  console.log(JSON.stringify(r, null, 1)); await b.close();
})();
