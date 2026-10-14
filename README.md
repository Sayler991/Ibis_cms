# ibis Tlemcen — site + commandes en ligne + tableau de bord (Supabase)

Réplique du système Whoopy CMS (Sayler991/Whoopy_cms) adaptée à l’hôtel ibis Tlemcen :
site one-page (Boulevard El Kiffane, 043 98 10 10) avec **commande en ligne** room service / restaurant / bar,
et tableau de bord `/admin/` (commandes + statuts, clients, stats, carte & prix, textes & photos, historique,
alertes temps réel « nouvelle commande »).

## Structure
- `site/` — site public (publié). `config.js` = URL + clé publishable Supabase (+ schéma `ibis`). `assets/js/live.js` = contenu en direct + formulaire de commande. `content.json` = secours hors-ligne.
- `admin/` — tableau de bord (copié dans `site/admin/` au déploiement). `alerts.js/.css` = alertes (Realtime + relève 30 s, son, bannière, pastille, titre, notification).
- `supabase/schema.sql` — schéma `ibis` (site_content, site_content_history, customers, orders, vue orders_daily, RLS, Realtime). `supabase/seed.sql` — contenu initial.
- `netlify.toml` — publication Netlify (dossier `site`, admin copié dans `/admin`).

## Supabase
Projet partagé avec Whoopy (`rvreusugrtiubqtafgbk`), données **isolées dans le schéma `ibis`** (exposé dans l’API :
`public,graphql_public,ibis`). Patron = même compte que Whoopy (table `public.owners`, fonction `public.is_owner()`).
Photos : bucket `images` existant, fichiers préfixés `up-ibis_`.

## Modes de commande
`chambre` (livraison en chambre, n° de chambre obligatoire), `sur_place` (table facultative), `emporter`.
Statuts : nouvelle → en préparation → prête → livrée / annulée. Les prix sont recalculés côté serveur depuis la carte.

## À faire par l’hôtel
La carte livrée est une **carte de démonstration** (articles d’exemple, prix 0 = « prix à définir ») :
à remplacer dans `/admin/` → Carte & prix. Horaires du service : à renseigner (Textes & photos).
Photos du site : © Accor/ibis (fiche officielle) — à faire valider par l’hôtel ou remplacer via l’admin.
