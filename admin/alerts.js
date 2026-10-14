/* ibis Tlemcen — alertes « nouvelle commande » du tableau de bord.
   Supabase Realtime (INSERT sur ibis.orders) + relève de secours toutes les 30 s.
   Son WebAudio, bannière, pastille rouge sur l'onglet Commandes, titre de l'onglet,
   notification du navigateur. Dépend de window.IBIS_SB (créé par admin.js). */
(function () {
  'use strict';
  var sb = window.IBIS_SB; if (!sb) return;
  var BASE_TITLE = document.title, unread = 0, maxId = null, seen = {}, chan = null, pollT = null, ac = null, running = false;

  function el(tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; }
  function MODE(o) { return o.fulfillment === 'chambre' ? ' · 🛎️ chambre ' + (o.address || '?') : o.fulfillment === 'sur_place' ? ' · 🍽️ sur place' + (o.address ? ' (table ' + o.address + ')' : '') : ' · 🥡 à emporter'; }
  function da(n) { return (Number(n) || 0).toLocaleString('fr-FR') + ' DA'; }

  /* — son (aucun fichier externe) — */
  function audio() { try { ac = ac || new (window.AudioContext || window.webkitAudioContext)(); if (ac.state === 'suspended') ac.resume(); } catch (e) {} return ac; }
  function beep() {
    var a = audio(); if (!a) return;
    [0, 0.18, 0.36].forEach(function (t, i) {
      var o = a.createOscillator(), g = a.createGain(), s = a.currentTime + t;
      o.type = 'triangle'; o.frequency.value = [880, 1175, 1568][i];
      g.gain.setValueAtTime(0.0001, s); g.gain.exponentialRampToValueAtTime(0.35, s + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, s + 0.16);
      o.connect(g).connect(a.destination); o.start(s); o.stop(s + 0.18);
    });
  }
  document.addEventListener('pointerdown', audio, { once: true });   // les navigateurs exigent un 1er clic pour le son

  /* — pastille + titre — */
  function badge() {
    var b = document.querySelector('.side button[data-tab="commandes"]'); if (!b) return;
    var x = b.querySelector('.al-badge');
    if (!unread) { if (x) x.remove(); document.title = BASE_TITLE; return; }
    if (!x) { x = el('span', 'al-badge'); b.appendChild(x); }
    x.textContent = unread > 99 ? '99+' : String(unread); x.setAttribute('aria-label', unread + ' nouvelle(s) commande(s)');
    document.title = '(' + unread + ') 🔔 Nouvelle commande — ' + BASE_TITLE;
  }
  function clearUnread() { if (unread && (location.hash === '#commandes' || location.hash === '') && document.visibilityState === 'visible') { unread = 0; badge(); } }
  window.addEventListener('hashchange', clearUnread);
  document.addEventListener('visibilitychange', clearUnread);
  document.addEventListener('click', function (e) { if (e.target.closest && e.target.closest('.side button[data-tab="commandes"]')) setTimeout(function () { unread = 0; badge(); }, 0); });

  /* — bannière — */
  function banner(o, name) {
    var box = document.getElementById('al-stack');
    if (!box) { box = el('div', 'al-stack'); box.id = 'al-stack'; box.setAttribute('role', 'alert'); document.body.appendChild(box); }
    var b = el('div', 'al-banner');
    b.appendChild(el('b', null, '🔔 Nouvelle commande n° ' + o.id));
    b.appendChild(el('span', null, (name || 'Client') + ' — ' + da(o.total) + MODE(o)));
    var v = el('button', 'btn btn-solid btn-sm', 'Voir'); v.type = 'button';
    v.onclick = function () { var t = document.querySelector('.side button[data-tab="commandes"]'); if (t) t.click(); b.remove(); };
    var x = el('button', 'al-x', '✕'); x.type = 'button'; x.setAttribute('aria-label', 'Fermer'); x.onclick = function () { b.remove(); };
    b.appendChild(v); b.appendChild(x); box.appendChild(b);
    setTimeout(function () { b.remove(); }, 60000);
  }

  /* — notification système — */
  function notify(o, name) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    try {
      var n = new Notification('ibis — nouvelle commande n° ' + o.id, { body: (name || 'Client') + ' — ' + da(o.total), tag: 'ibis-order-' + o.id, icon: '../icon-192.png' });
      n.onclick = function () { window.focus(); var t = document.querySelector('.side button[data-tab="commandes"]'); if (t) t.click(); n.close(); };
    } catch (e) {}
  }
  function permButton() {
    var top = document.querySelector('header.top'); if (!top || top.querySelector('.al-perm')) return;
    var need = ('Notification' in window) && Notification.permission === 'default';
    var b = el('button', 'btn btn-line btn-sm al-perm', '🔔'); b.type = 'button';
    b.appendChild(el('span', 'al-lbl', need ? ' Activer les alertes' : ' Tester le son')); b.setAttribute('aria-label', need ? 'Activer les alertes' : 'Tester le son');
    b.title = 'Son + notification à chaque nouvelle commande';
    b.onclick = function () {
      audio(); beep();
      if (need) Notification.requestPermission().then(function () { b.remove(); });
      else b.remove();
    };
    if (!need && ('Notification' in window) && Notification.permission === 'denied') b.title = 'Notifications bloquées dans le navigateur : seuls le son et la bannière fonctionnent.';
    top.insertBefore(b, top.querySelector('#status'));
  }

  /* — traitement d'une commande — */
  function handle(o) {
    if (!o || seen[o.id]) return; seen[o.id] = 1;
    if (maxId != null && o.id <= maxId && !o._rt) return;
    if (o.id > (maxId || 0)) maxId = o.id;
    var nameP = o.customers ? Promise.resolve(o.customers.name) :
      sb.from('customers').select('name').eq('id', o.customer_id).maybeSingle().then(function (r) { return r.data && r.data.name; }, function () { return null; });
    nameP.then(function (name) {
      unread++; badge(); beep(); banner(o, name); notify(o, name);
      var r = document.querySelector('.crm-bar .btn-line'); if (r && /Actualiser/.test(r.textContent)) r.click();   // rafraîchit la liste si elle est affichée
      document.dispatchEvent(new CustomEvent('ibis:new-order', { detail: { id: o.id, name: name, total: o.total } }));
    });
  }

  /* — relève de secours (si le temps réel décroche) — */
  function poll() {
    if (maxId == null) return;
    sb.from('orders').select('id,total,fulfillment,address,customer_id,customers(name)').gt('id', maxId).order('id').limit(20).then(function (r) {
      if (!r.error) (r.data || []).forEach(handle);
    });
  }

  function start() {
    if (running) return; running = true;
    sb.from('orders').select('id').order('id', { ascending: false }).limit(1).then(function (r) {
      if (r.error) { running = false; return; }   // pas patron / pas connecté
      maxId = r.data && r.data[0] ? r.data[0].id : 0;
      chan = sb.channel('ibis-orders')
        .on('postgres_changes', { event: 'INSERT', schema: 'ibis', table: 'orders' }, function (p) { var o = p.new; o._rt = 1; handle(o); })
        .subscribe(function (st) { document.documentElement.setAttribute('data-realtime', st); });
      pollT = setInterval(poll, 30000);
      var t = setInterval(function () { if (document.querySelector('header.top')) { permButton(); badge(); clearInterval(t); } }, 300);
    });
  }
  function stop() { running = false; if (chan) sb.removeChannel(chan); chan = null; clearInterval(pollT); }

  sb.auth.onAuthStateChange(function (ev, session) {
    if (session && session.access_token && sb.realtime && sb.realtime.setAuth) sb.realtime.setAuth(session.access_token);
    if (session) setTimeout(start, 0); else stop();
  });
  window.IBIS_ALERTS = { test: function () { handle({ id: (maxId || 0) + 1000 + Math.floor(Math.random() * 1000), total: 1234, fulfillment: 'chambre', address: '101', customers: { name: 'Test' } }); } };
})();
