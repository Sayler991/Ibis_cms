/* ibis Tlemcen — contenu en direct (Supabase ibis.site_content) + formulaire de commande */
(function () {
  'use strict';
  var C = window.IBIS_CONFIG || {}, sb = null, DATA = null, cart = {};
  try { sb = window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY, { db: { schema: C.SCHEMA || 'ibis' }, auth: { persistSession: false } }); } catch (e) {}
  var $ = function (s) { return document.querySelector(s); };
  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function rich(t) { return esc(t).replace(/\*([^*]+)\*/g, '<em>$1</em>'); }
  function get(o, path) { return path.split('.').reduce(function (a, k) { return a == null ? a : a[k]; }, o); }
  function tel(t) { return String(t || '').replace(/\{tel\}/g, (DATA && DATA.hotel && DATA.hotel.phone) || ''); }
  function price(p) { p = parseInt(p, 10); return p > 0 ? p.toLocaleString('fr-FR') + ' DA' : 'prix à définir'; }
  function items() { var a = []; ((DATA.menu || {}).categories || []).forEach(function (c) { (c.items || []).forEach(function (i) { a.push(i); }); }); return a; }
  function find(n) { return items().filter(function (i) { return i.name === n; })[0]; }

  function apply(d) {
    DATA = d; window.IBIS_CONTENT = d;
    document.querySelectorAll('[data-c]').forEach(function (el) { var v = get(d, el.getAttribute('data-c')); if (typeof v === 'string') el.innerHTML = rich(tel(v)); });
    var h = d.hotel || {};
    if (h.phone) {
      document.querySelectorAll('a[href^="tel:"]').forEach(function (a) {
        if (h.phone_intl) a.setAttribute('href', 'tel:' + h.phone_intl);
        a.childNodes.forEach(function (n) { if (n.nodeType === 3 && /\d\d/.test(n.nodeValue)) n.nodeValue = h.phone; });
      });
    }
    if (d.hero && d.hero.tagline) { var hp = document.querySelector('.hero-lead'); if (hp) hp.innerHTML = rich(d.hero.tagline); }
    if (d.restaurant && d.restaurant.note) { var n = document.querySelector('#table .note p'); if (n) n.textContent = d.restaurant.note; }
    Object.keys(d.photos || {}).forEach(function (k) {
      var p = d.photos[k]; if (!p || !p.src) return;
      document.querySelectorAll('img[src*="/' + k + '-"]').forEach(function (img) {
        var pic = img.closest('picture'); if (pic) pic.querySelectorAll('source').forEach(function (s) { s.remove(); });
        img.removeAttribute('srcset'); img.src = p.src; if (p.alt) img.alt = p.alt;
      });
    });
    renderMenu();
  }

  function renderMenu() {
    var box = $('#ord-menu'); if (!box || !DATA) return;
    var o = DATA.order || {};
    if (o.open === false) { box.innerHTML = '<p class="ord-closed">' + esc(tel(o.closed_text || 'Commandes fermées.')) + '</p>'; $('#ord-send').disabled = true; return; }
    var html = '';
    ((DATA.menu || {}).categories || []).forEach(function (c) {
      if (!(c.items || []).length) return;
      html += '<div class="ord-cat"><h3>' + esc(c.name) + '</h3>';
      c.items.forEach(function (i) {
        var off = i.available === false, q = cart[i.name] || 0;
        html += '<div class="ord-it' + (off ? ' off' : '') + '"><div><b>' + esc(i.name) + '</b>' + (i.desc ? '<small>' + esc(i.desc) + '</small>' : '') + '</div>' +
          '<div style="display:flex;gap:1rem;align-items:center"><span class="pr">' + (off ? 'indisponible' : price(i.price)) + '</span>' +
          (off ? '' : '<span class="qty"><button type="button" data-q="-1" data-n="' + esc(i.name) + '" aria-label="Retirer">−</button><span>' + q + '</span><button type="button" data-q="1" data-n="' + esc(i.name) + '" aria-label="Ajouter">+</button></span>') + '</div></div>';
      });
      html += '</div>';
    });
    box.innerHTML = html || '<p class="ord-closed">La carte est vide pour le moment.</p>';
    renderCart();
  }

  function renderCart() {
    var ul = $('#ord-cart'), tot = 0, unk = false, li = '';
    Object.keys(cart).forEach(function (n) {
      var it = find(n); if (!it || it.available === false) { delete cart[n]; return; }
      var p = parseInt(it.price, 10) || 0; if (!p) unk = true; tot += p * cart[n];
      li += '<li><span>' + cart[n] + ' × ' + esc(n) + '</span><span>' + (p ? (p * cart[n]).toLocaleString('fr-FR') + ' DA' : 'à définir') + '</span></li>';
    });
    ul.innerHTML = li || '<li>Aucun article pour l’instant.</li>';
    $('#ord-total').textContent = li ? (tot.toLocaleString('fr-FR') + ' DA' + (unk ? ' + articles à prix à définir' : '')) : '—';
  }

  function mode() { var r = document.querySelector('input[name="mode"]:checked'); return r ? r.value : 'chambre'; }
  function modeUI() {
    var m = mode(), l = $('#ord-room-l'), i = $('#ord-room');
    l.style.display = i.style.display = m === 'emporter' ? 'none' : '';
    l.textContent = m === 'chambre' ? 'Numéro de chambre *' : 'Table (facultatif)';
  }
  function msg(t, ok) { $('#ord-msg').innerHTML = t ? '<p class="ord-msg ' + (ok ? 'ok' : 'err') + '">' + esc(t) + '</p>' : ''; }

  function uuid() { return (crypto.randomUUID && crypto.randomUUID()) || 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, function () { return (Math.random() * 16 | 0).toString(16); }); }

  function submit(e) {
    e.preventDefault(); msg('');
    var lines = Object.keys(cart).map(function (n) { return { name: n, qty: cart[n] }; });
    var name = $('#ord-name').value.trim(), phone = $('#ord-phone').value.trim(), room = $('#ord-room').value.trim(), m = mode();
    if (!lines.length) return msg('Ajoutez au moins un article.');
    if (m === 'chambre' && !room) return msg('Indiquez votre numéro de chambre.');
    if (name.length < 2) return msg('Indiquez votre nom.');
    if (!/^\+?[0-9][0-9 .-]{7,18}[0-9]$/.test(phone)) return msg('Numéro de téléphone invalide.');
    if (!sb) return msg('Service indisponible, appelez la réception.');
    var btn = $('#ord-send'); btn.disabled = true; btn.textContent = 'Envoi…';
    var cid = uuid();
    sb.from('customers').insert({ id: cid, name: name, phone: phone }).then(function (r) {
      if (r.error) throw r.error;
      return sb.from('orders').insert({ customer_id: cid, items: lines, fulfillment: m, address: m === 'emporter' ? null : (room || null), notes: $('#ord-notes').value.trim() || null });
    }).then(function (r) {
      if (r.error) throw r.error;
      cart = {}; renderMenu(); $('#ord-notes').value = '';
      msg(tel(((DATA.order || {}).success) || 'Merci ! Commande transmise.'), true);
    }).catch(function (err) { msg((err && err.message) || 'Erreur, réessayez ou appelez la réception.'); })
      .then(function () { btn.disabled = false; btn.textContent = 'Envoyer la commande'; });
  }

  function init() {
    var f = $('#ord-form'); if (!f) return;
    document.addEventListener('click', function (e) {
      var b = e.target.closest('[data-q]'); if (!b) return;
      var n = b.getAttribute('data-n'), q = (cart[n] || 0) + parseInt(b.getAttribute('data-q'), 10);
      if (q <= 0) delete cart[n]; else cart[n] = Math.min(q, 20); renderMenu();
    });
    f.querySelectorAll('input[name="mode"]').forEach(function (r) { r.addEventListener('change', modeUI); });
    f.addEventListener('submit', submit); modeUI();
    var fallback = function () { return fetch('content.json', { cache: 'no-cache' }).then(function (r) { return r.json(); }).then(apply); };
    if (!sb) return fallback();
    sb.from('site_content').select('data').eq('id', 1).maybeSingle().then(function (r) {
      if (r.error || !r.data) throw r.error || new Error('vide'); apply(r.data.data); document.documentElement.setAttribute('data-live', 'supabase');
    }).catch(function () { fallback(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
