/* Tableau de bord ibis Tlemcen — Supabase (schéma « ibis ») : commandes, clients, stats, carte, contenu, historique.
   Dépend de supabase-js (CDN) et de /config.js. Même compte patron que Whoopy (table public.owners). */
(function () {
  'use strict';
  var C = window.IBIS_CONFIG || {};
  var sb = (window.supabase && C.SUPABASE_URL) ? window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY, { db: { schema: C.SCHEMA || 'ibis' } }) : null;
  window.IBIS_SB = sb;
  var BUCKET = 'images', STATUSES = ['nouvelle', 'en préparation', 'prête', 'livrée', 'annulée'];
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var CONTENT = null, DIRTY = false, TAB = 'commandes';

  function h(tag, attrs) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k]; if (v == null || v === false) return;
      if (k === 'text') e.textContent = v; else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), v); else if (k === 'value') e.value = v; else e.setAttribute(k, v === true ? '' : v);
    });
    for (var i = 2; i < arguments.length; i++) { var c = arguments[i]; if (c == null) continue; (Array.isArray(c) ? c : [c]).forEach(function (x) { if (x != null) e.appendChild(typeof x === 'string' ? document.createTextNode(x) : x); }); }
    return e;
  }
  function toast(t, err) { var x = h('div', { class: 'toast' + (err ? ' err' : ''), text: t }); $('#toasts').appendChild(x); setTimeout(function () { x.remove(); }, err ? 7000 : 3500); }
  function da(n) { return (Number(n) || 0).toLocaleString('fr-FR') + ' DA'; }
  function dt(s) { return new Date(s).toLocaleString('fr-FR', { timeZone: 'Africa/Algiers', dateStyle: 'short', timeStyle: 'short' }); }
  function modeTxt(o) { return o.fulfillment === 'chambre' ? '🛎️ Livraison en chambre ' + (o.address || '?') : o.fulfillment === 'sur_place' ? '🍽️ Sur place' + (o.address ? ' — table ' + o.address : '') : '🥡 À emporter'; }
  function field(label, obj, key, opt) {
    opt = opt || {};
    var inp = opt.type === 'textarea' ? h('textarea', { rows: opt.rows || 2 }) : h('input', { type: opt.type || 'text' });
    if (opt.type === 'checkbox') { inp.checked = obj[key] !== false; inp.style.width = 'auto'; inp.onchange = function () { obj[key] = inp.checked; DIRTY = true; }; return h('label', { class: 'row' }, inp, label); }
    inp.value = obj[key] == null ? '' : obj[key];
    inp.oninput = function () { obj[key] = opt.type === 'number' ? (inp.value === '' ? 0 : parseInt(inp.value, 10) || 0) : inp.value; DIRTY = true; };
    return h('label', { class: 'f' }, h('span', { text: label }), inp, opt.hint ? h('small', { class: 'mut', text: opt.hint }) : null);
  }

  /* ---------- connexion ---------- */
  function showLogin(msg) {
    $('#boot').hidden = true; $('#app').hidden = true; $('#login').hidden = false;
    if (msg) { $('#login-err').textContent = msg; $('#login-err').hidden = false; }
  }
  $('#login-form').addEventListener('submit', function (e) {
    e.preventDefault(); $('#login-err').hidden = true;
    sb.auth.signInWithPassword({ email: $('#login-email').value.trim(), password: $('#login-pw').value }).then(function (r) {
      if (r.error) showLogin('Connexion refusée : ' + (r.error.message === 'Invalid login credentials' ? 'e-mail ou mot de passe incorrect.' : r.error.message));
    });
  });
  function checkOwner(session) {
    return sb.schema('public').from('owners').select('user_id').eq('user_id', session.user.id).maybeSingle().then(function (r) { return !!(r.data); });
  }

  /* ---------- squelette ---------- */
  var TABS = [['commandes', '🛎️ Commandes'], ['clients', '👥 Clients'], ['stats', '📊 Stats'], ['carte', '🍽️ Carte & prix'], ['contenu', '✏️ Textes & photos'], ['historique', '🕘 Historique']];
  function shell(session) {
    var app = $('#app'); app.innerHTML = '';
    var side = h('nav', { class: 'side' });
    TABS.forEach(function (t) { side.appendChild(h('button', { type: 'button', 'data-tab': t[0], text: t[1], onclick: function () { go(t[0]); } })); });
    app.appendChild(h('header', { class: 'top' },
      h('div', { class: 'brand' }, h('img', { src: '../assets/logo.svg', alt: 'ibis Tlemcen' }), h('b', { text: 'Tableau de bord' })),
      h('span', { id: 'status', text: session.user.email }),
      h('a', { class: 'btn btn-line btn-sm', href: '../', target: '_blank', text: 'Voir le site' }),
      h('button', { class: 'btn btn-line btn-sm', type: 'button', text: 'Déconnexion', onclick: function () { sb.auth.signOut(); } })));
    app.appendChild(h('div', { class: 'layout' }, side, h('main', { id: 'main' })));
    $('#boot').hidden = true; $('#login').hidden = true; app.hidden = false;
    go((location.hash || '#commandes').slice(1));
  }
  function go(tab) {
    if (DIRTY && !confirm('Modifications non enregistrées : les abandonner ?')) return;
    DIRTY = false; if (!TABS.some(function (t) { return t[0] === tab; })) tab = 'commandes'; TAB = tab;
    history.replaceState(null, '', '#' + tab);
    document.querySelectorAll('.side button').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-tab') === tab); });
    var m = $('#main'); m.innerHTML = '';
    ({ commandes: viewOrders, clients: viewClients, stats: viewStats, carte: viewMenu, contenu: viewContent, historique: viewHistory })[tab](m);
  }

  /* ---------- commandes ---------- */
  function viewOrders(m) {
    var filt = h('select', null, h('option', { value: '', text: 'Toutes' }), STATUSES.map(function (s) { return h('option', { value: s, text: s }); }));
    filt.value = 'actives'; filt.insertBefore(h('option', { value: 'actives', text: 'En cours (hors livrées/annulées)' }), filt.firstChild); filt.value = 'actives';
    var list = h('div');
    m.appendChild(h('h2', { text: 'Commandes' }));
    m.appendChild(h('div', { class: 'crm-bar' }, filt, h('button', { class: 'btn btn-line btn-sm', type: 'button', text: '↻ Actualiser', onclick: load })));
    m.appendChild(list); filt.onchange = load;
    function load() {
      var q = sb.from('orders').select('id,created_at,items,total,status,fulfillment,address,notes,customers(name,phone)').order('created_at', { ascending: false }).limit(200);
      if (filt.value === 'actives') q = q.not('status', 'in', '("livrée","annulée")'); else if (filt.value) q = q.eq('status', filt.value);
      q.then(function (r) {
        if (r.error) return toast(r.error.message, true);
        list.innerHTML = '';
        if (!r.data.length) list.appendChild(h('p', { class: 'mut', text: 'Aucune commande.' }));
        r.data.forEach(function (o) {
          var sel = h('select', { 'aria-label': 'Statut' }, STATUSES.map(function (s) { return h('option', { value: s, text: s }); })); sel.value = o.status; sel.style.width = 'auto';
          sel.onchange = function () {
            var v = sel.value;
            sb.from('orders').update({ status: v }).eq('id', o.id).select('id').single().then(function (r2) {
              if (r2.error) { toast(r2.error.message, true); sel.value = o.status; } else { o.status = v; toast('Commande n° ' + o.id + ' : ' + v); }
            });
          };
          var c = o.customers || {}, unknown = o.items.some(function (i) { return !i.price; });
          list.appendChild(h('section', { class: 'card ord' },
            h('div', null, h('b', { text: 'N° ' + o.id + ' — ' + (c.name || '?') }), ' ', h('a', { href: 'tel:' + (c.phone || '').replace(/[^0-9+]/g, ''), text: c.phone || '' }),
              h('p', { class: 'sm', text: dt(o.created_at) + ' · ' + modeTxt(o) }),
              h('ul', null, o.items.map(function (i) { return h('li', { text: i.qty + ' × ' + i.name + (i.price ? ' (' + da(i.price) + ')' : ' (prix à définir)') }); })),
              o.notes ? h('p', { class: 'sm', text: '📝 ' + o.notes }) : null),
            h('div', { style: 'text-align:right' }, h('b', { text: da(o.total) + (unknown ? ' + à définir' : '') }), h('div', { style: 'margin-top:.5rem' }, sel))));
        });
      });
    }
    load();
  }

  /* ---------- clients ---------- */
  function viewClients(m) {
    m.appendChild(h('h2', { text: 'Clients' }));
    var s = h('input', { type: 'search', placeholder: 'Rechercher nom ou téléphone' }), box = h('div');
    m.appendChild(h('div', { class: 'crm-bar' }, s)); m.appendChild(box);
    sb.from('customers').select('id,name,phone,notes,created_at,orders(total,status,created_at)').order('created_at', { ascending: false }).limit(1000).then(function (r) {
      if (r.error) return toast(r.error.message, true);
      function draw() {
        var q = s.value.toLowerCase(); box.innerHTML = '';
        r.data.filter(function (c) { return !q || (c.name + ' ' + c.phone).toLowerCase().indexOf(q) >= 0; }).forEach(function (c) {
          var valid = c.orders.filter(function (o) { return o.status !== 'annulée'; });
          var ta = h('textarea', { rows: 2, placeholder: 'Notes privées (allergies, préférences…)' }); ta.value = c.notes || '';
          box.appendChild(h('section', { class: 'card' }, h('b', { text: c.name }), ' · ', h('a', { href: 'tel:' + c.phone.replace(/[^0-9+]/g, ''), text: c.phone }),
            h('p', { class: 'mut', text: valid.length + ' commande(s) · ' + da(valid.reduce(function (a, o) { return a + o.total; }, 0)) + ' · client depuis ' + dt(c.created_at) }),
            ta, h('button', { class: 'btn btn-line btn-sm', type: 'button', text: 'Enregistrer la note', style: 'margin-top:.4rem', onclick: function () {
              sb.from('customers').update({ notes: ta.value.trim() || null }).eq('id', c.id).select('id').single().then(function (r2) { toast(r2.error ? r2.error.message : 'Note enregistrée', !!r2.error); });
            } })));
        });
        if (!box.childNodes.length) box.appendChild(h('p', { class: 'mut', text: 'Aucun client.' }));
      }
      s.oninput = draw; draw();
    });
  }

  /* ---------- stats ---------- */
  function viewStats(m) {
    m.appendChild(h('h2', { text: 'Statistiques (30 derniers jours)' }));
    var since = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
    sb.from('orders_daily').select('*').gte('day', since).order('day', { ascending: false }).then(function (r) {
      if (r.error) return toast(r.error.message, true);
      var n = 0, ca = 0; r.data.forEach(function (d) { n += d.orders_valid; ca += Number(d.revenue_da); });
      m.appendChild(h('section', { class: 'card' }, h('h3', { text: n + ' commande(s) valides · ' + da(ca) }), h('p', { class: 'mut', text: 'Hors commandes annulées. Les articles « prix à définir » comptent pour 0 DA.' })));
      m.appendChild(h('table', null, h('tr', null, h('th', { text: 'Jour' }), h('th', { text: 'Commandes' }), h('th', { text: 'Valides' }), h('th', { text: 'Chiffre' })),
        r.data.map(function (d) { return h('tr', null, h('td', { text: d.day }), h('td', { text: d.orders_count }), h('td', { text: d.orders_valid }), h('td', { text: da(d.revenue_da) })); })));
    });
  }

  /* ---------- contenu ---------- */
  function loadContent() { return sb.from('site_content').select('data').eq('id', 1).single().then(function (r) { if (r.error) throw r.error; CONTENT = r.data.data; return CONTENT; }); }
  function save() {
    var names = {}, err = null;
    (CONTENT.menu.categories || []).forEach(function (c) { (c.items || []).forEach(function (i) { i.name = String(i.name || '').trim(); if (!i.name) err = 'Un article n’a pas de nom.'; if (names[i.name]) err = 'Nom en double : « ' + i.name + ' » (chaque article doit avoir un nom unique).'; names[i.name] = 1; i.price = Math.max(0, parseInt(i.price, 10) || 0); }); });
    if (err) return toast(err, true);
    sb.from('site_content').update({ data: CONTENT }).eq('id', 1).select('data').single().then(function (r) {
      if (r.error) return toast('Échec : ' + r.error.message, true);
      CONTENT = r.data.data; DIRTY = false; toast('Enregistré — le site est à jour.');
    });
  }
  function saveBar() { return h('div', { class: 'savebar' }, h('button', { class: 'btn btn-line', type: 'button', text: 'Annuler', onclick: function () { DIRTY = false; go(TAB); } }), h('button', { class: 'btn btn-solid', type: 'button', text: 'Enregistrer', onclick: save })); }

  function viewMenu(m) {
    loadContent().then(function (d) {
      d.menu = d.menu || {}; d.menu.categories = d.menu.categories || [];
      m.appendChild(h('h2', { text: 'Carte & prix' }));
      m.appendChild(h('p', { class: 'mut', text: 'Prix en dinars (DA). Prix 0 = affiché « prix à définir ». Décochez « disponible » pour masquer temporairement un article à la commande.' }));
      var o = d.order = d.order || {};
      m.appendChild(h('section', { class: 'card' }, h('h3', { text: 'Commandes en ligne' }), field('Commandes ouvertes', o, 'open', { type: 'checkbox' })));
      var wrap = h('div'); m.appendChild(wrap);
      function draw() {
        wrap.innerHTML = '';
        d.menu.categories.forEach(function (c, ci) {
          var card = h('section', { class: 'card' }, h('div', { class: 'item-h' }, field('Catégorie', c, 'name'),
            h('button', { class: 'btn btn-danger btn-sm', type: 'button', text: 'Supprimer la catégorie', onclick: function () { if (confirm('Supprimer « ' + c.name + ' » et ses articles ?')) { d.menu.categories.splice(ci, 1); DIRTY = true; draw(); } } })));
          (c.items = c.items || []).forEach(function (it, ii) {
            card.appendChild(h('div', { class: 'item' },
              h('div', { class: 'grid2' }, field('Nom', it, 'name'), field('Prix (DA)', it, 'price', { type: 'number' })),
              field('Description', it, 'desc'),
              h('div', { class: 'row', style: 'justify-content:space-between;margin-top:.4rem' }, field('Disponible', it, 'available', { type: 'checkbox' }),
                h('span', { class: 'row' },
                  h('button', { class: 'btn btn-line btn-sm', type: 'button', text: '↑', disabled: ii === 0, onclick: function () { c.items.splice(ii - 1, 0, c.items.splice(ii, 1)[0]); DIRTY = true; draw(); } }),
                  h('button', { class: 'btn btn-danger btn-sm', type: 'button', text: 'Supprimer', onclick: function () { c.items.splice(ii, 1); DIRTY = true; draw(); } })))));
          });
          card.appendChild(h('button', { class: 'btn btn-line btn-sm', type: 'button', text: '+ Ajouter un article', onclick: function () { c.items.push({ name: '', desc: '', price: 0, available: true }); DIRTY = true; draw(); } }));
          wrap.appendChild(card);
        });
        wrap.appendChild(h('button', { class: 'btn btn-line', type: 'button', text: '+ Ajouter une catégorie', onclick: function () { d.menu.categories.push({ name: 'Nouvelle catégorie', items: [] }); DIRTY = true; draw(); } }));
      }
      draw(); m.appendChild(saveBar());
    }).catch(function (e) { toast(e.message, true); });
  }

  function viewContent(m) {
    loadContent().then(function (d) {
      var H = d.hotel = d.hotel || {}, O = d.order = d.order || {}, R = d.restaurant = d.restaurant || {}, HE = d.hero = d.hero || {};
      m.appendChild(h('h2', { text: 'Textes & photos' }));
      m.appendChild(h('section', { class: 'card' }, h('h3', { text: 'Hôtel' }),
        h('div', { class: 'grid2' }, field('Téléphone affiché', H, 'phone'), field('Téléphone international (lien d’appel)', H, 'phone_intl', { hint: 'ex. +21343981010' })),
        field('Phrase d’accueil (haut de page)', HE, 'tagline', { hint: '*texte* = en italique doré' })));
      m.appendChild(h('section', { class: 'card' }, h('h3', { text: 'Section « Commander »' }),
        field('Titre', O, 'title', { hint: '*texte* = italique' }), field('Introduction', O, 'lead', { type: 'textarea' }),
        field('Horaires du service', O, 'hours'), field('Note sous la carte', O, 'note', { type: 'textarea' }),
        field('Message si commandes fermées', O, 'closed_text', { hint: '{tel} = téléphone' }), field('Message après envoi', O, 'success', { hint: '{tel} = téléphone' })));
      m.appendChild(h('section', { class: 'card' }, h('h3', { text: 'Restaurant & bar' }), field('Note (horaires, carte…)', R, 'note', { type: 'textarea' })));
      var ph = h('section', { class: 'card' }, h('h3', { text: 'Photos (restaurant & bar)' }), h('p', { class: 'mut', text: 'JPG, PNG ou WebP, 6 Mo max. Remplace la photo d’origine sur le site après « Enregistrer ».' }));
      Object.keys(d.photos = d.photos || {}).forEach(function (k) {
        var p = d.photos[k], img = h('img', { class: 'thumb', alt: '', src: p.src || ('../assets/img/' + k + '-480.webp') });
        var f = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp' }); f.style.width = 'auto';
        f.onchange = function () {
          var file = f.files[0]; if (!file) return; if (file.size > 6291456) return toast('Image trop lourde (6 Mo max).', true);
          var ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[file.type]; if (!ext) return toast('Format non accepté.', true);
          var name = 'up-ibis_' + k + '-' + Math.random().toString(36).slice(2, 8) + '-' + Date.now() + '.' + ext;
          sb.storage.from(BUCKET).upload(name, file, { contentType: file.type, cacheControl: '31536000', upsert: false }).then(function (r) {
            if (r.error) return toast(r.error.message, true);
            p.src = sb.storage.from(BUCKET).getPublicUrl(name).data.publicUrl; img.src = p.src; DIRTY = true; toast('Photo envoyée — cliquez sur Enregistrer.');
          });
        };
        ph.appendChild(h('div', { class: 'item row' }, img, h('div', null, h('b', { text: p.label || k }), h('div', null, f), field('Texte alternatif', p, 'alt'),
          p.src ? h('button', { class: 'btn btn-line btn-sm', type: 'button', text: 'Revenir à la photo d’origine', onclick: function () { p.src = ''; DIRTY = true; img.src = '../assets/img/' + k + '-480.webp'; } }) : null)));
      });
      m.appendChild(ph); m.appendChild(saveBar());
    }).catch(function (e) { toast(e.message, true); });
  }

  function viewHistory(m) {
    m.appendChild(h('h2', { text: 'Historique' })); m.appendChild(h('p', { class: 'mut', text: 'Les 40 dernières versions du contenu. Restaurer remplace le contenu actuel (qui est lui-même archivé).' }));
    sb.from('site_content_history').select('id,saved_at').order('id', { ascending: false }).limit(40).then(function (r) {
      if (r.error) return toast(r.error.message, true);
      if (!r.data.length) m.appendChild(h('p', { class: 'mut', text: 'Aucune version précédente.' }));
      r.data.forEach(function (v) {
        m.appendChild(h('div', { class: 'card row', style: 'justify-content:space-between' }, h('span', { text: 'Version du ' + dt(v.saved_at) }),
          h('button', { class: 'btn btn-line btn-sm', type: 'button', text: 'Restaurer', onclick: function () {
            if (!confirm('Restaurer cette version ?')) return;
            sb.from('site_content_history').select('data').eq('id', v.id).single().then(function (hh) {
              if (hh.error) throw hh.error; return sb.from('site_content').update({ data: hh.data.data }).eq('id', 1).select('id').single();
            }).then(function (r2) { if (r2.error) throw r2.error; toast('Version restaurée.'); go('historique'); }).catch(function (e) { toast(e.message, true); });
          } })));
      });
    });
  }

  /* ---------- démarrage ---------- */
  if (!sb) { $('#boot').textContent = 'Configuration Supabase manquante (config.js).'; return; }
  var current;
  sb.auth.onAuthStateChange(function (ev, session) {
    var uid = session && session.user && session.user.id;
    if (uid === current) return; current = uid;
    if (!session) return showLogin();
    setTimeout(function () {
      checkOwner(session).then(function (ok) {
        if (!ok) { sb.auth.signOut(); return showLogin('Ce compte n’est pas autorisé (réservé au patron).'); }
        shell(session);
      });
    }, 0);
  });
  window.addEventListener('beforeunload', function (e) { if (DIRTY) { e.preventDefault(); e.returnValue = ''; } });
})();
