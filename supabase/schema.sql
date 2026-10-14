-- =====================================================================
--  ibis Tlemcen — commandes en ligne (room service / restaurant / bar)
--  Isolé dans le schéma « ibis » du projet Supabase partagé avec Whoopy.
--  Ne touche à AUCUN objet du schéma public (sauf lecture de
--  public.is_owner() / public.owners : même compte patron).
--  Idempotent : peut être relancé sans perte de données.
--  Après exécution : ajouter « ibis » aux schémas exposés de l'API
--  (Settings → API → Exposed schemas, ou Management API PATCH /postgrest).
-- =====================================================================
create schema if not exists ibis;
grant usage on schema ibis to anon, authenticated, service_role;

-- 1. CONTENU ------------------------------------------------------------
create table if not exists ibis.site_content (
  id integer primary key default 1 check (id = 1),
  data jsonb not null check (jsonb_typeof(data) = 'object') check (octet_length(data::text) <= 1048576),
  updated_at timestamptz not null default now(),
  updated_by uuid
);
create table if not exists ibis.site_content_history (
  id bigint generated always as identity primary key,
  saved_at timestamptz not null default now(),
  saved_by uuid,
  data jsonb not null
);
create or replace function ibis.site_content_before_update()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.data is distinct from old.data then
    insert into ibis.site_content_history (saved_by, data) values (old.updated_by, old.data);
    delete from ibis.site_content_history
     where id not in (select id from ibis.site_content_history order by id desc limit 40);
  end if;
  new.updated_at := now(); new.updated_by := auth.uid(); new.id := old.id;
  return new;
end; $$;
drop trigger if exists trg_site_content_before_update on ibis.site_content;
create trigger trg_site_content_before_update before update on ibis.site_content
  for each row execute function ibis.site_content_before_update();

-- 2. CLIENTS / COMMANDES -------------------------------------------------
create table if not exists ibis.customers (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 80),
  phone text not null check (phone ~ '^\+?[0-9][0-9 .-]{7,18}[0-9]$'),
  notes text check (notes is null or char_length(notes) <= 2000),
  created_at timestamptz not null default now()
);
create index if not exists customers_phone_idx on ibis.customers (phone);

-- fulfillment : chambre (livraison en chambre, address = n° de chambre),
--               sur_place (restaurant/bar, address = table facultative), emporter
create table if not exists ibis.orders (
  id bigint generated always as identity primary key,
  customer_id uuid not null references ibis.customers (id) on delete restrict,
  items jsonb not null check (jsonb_typeof(items) = 'array')
    check (jsonb_array_length(items) between 1 and 30) check (octet_length(items::text) <= 8000),
  total integer not null default 0 check (total between 0 and 1000000),
  status text not null default 'nouvelle'
    check (status in ('nouvelle','en préparation','prête','livrée','annulée')),
  fulfillment text not null default 'chambre' check (fulfillment in ('chambre','sur_place','emporter')),
  address text check (address is null or char_length(address) <= 120),
  notes text check (notes is null or char_length(notes) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint orders_room_if_chambre check (fulfillment <> 'chambre' or char_length(btrim(coalesce(address,''))) >= 1)
);
create index if not exists orders_created_idx on ibis.orders (created_at desc);
create index if not exists orders_customer_idx on ibis.orders (customer_id);

create or replace function ibis.customers_before_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.name := btrim(new.name); new.phone := btrim(new.phone);
  if not public.is_owner() then
    new.notes := null; new.created_at := now();
    if (select count(*) from ibis.customers where created_at > now() - interval '1 minute') >= 30 then
      raise exception 'Trop de demandes en ce moment, réessayez dans une minute.' using errcode = 'P0001';
    end if;
  end if;
  return new;
end; $$;
drop trigger if exists trg_customers_before_insert on ibis.customers;
create trigger trg_customers_before_insert before insert on ibis.customers
  for each row execute function ibis.customers_before_insert();

-- Prix recalculés depuis la carte (data.menu.categories[].items[]), article
-- indisponible ou inconnu refusé, commandes fermées refusées, anti-abus.
create or replace function ibis.orders_before_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_phone text; v_keep uuid; v_data jsonb; v_menu jsonb; v_item jsonb; v_m jsonb;
        v_name text; v_qty integer; v_price integer; v_clean jsonb := '[]'::jsonb; v_total integer := 0;
begin
  if public.is_owner() then new.updated_at := now(); return new; end if;
  new.status := 'nouvelle'; new.created_at := now(); new.updated_at := now();
  new.address := nullif(btrim(coalesce(new.address,'')),'');
  new.notes := nullif(btrim(coalesce(new.notes,'')),'');
  if new.fulfillment = 'emporter' then new.address := null; end if;

  select data into v_data from ibis.site_content where id = 1;
  if v_data is null then raise exception 'La carte n''est pas encore en ligne.' using errcode = 'P0001'; end if;
  if coalesce((v_data -> 'order' ->> 'open')::boolean, true) = false then
    raise exception 'Les commandes en ligne sont momentanément fermées. Appelez la réception.' using errcode = 'P0001';
  end if;
  select coalesce(jsonb_agg(i), '[]'::jsonb) into v_menu
    from jsonb_array_elements(coalesce(v_data -> 'menu' -> 'categories','[]'::jsonb)) c,
         jsonb_array_elements(coalesce(c -> 'items','[]'::jsonb)) i;

  select c.phone into v_phone from ibis.customers c where c.id = new.customer_id;
  if v_phone is null then raise exception 'Client introuvable.' using errcode = 'P0001'; end if;
  if (select count(*) from ibis.orders where created_at > now() - interval '1 minute') >= 30 then
    raise exception 'Trop de commandes en ce moment, réessayez dans une minute.' using errcode = 'P0001';
  end if;
  if (select count(*) from ibis.orders o join ibis.customers c on c.id = o.customer_id
       where regexp_replace(c.phone,'[^0-9]','','g') = regexp_replace(v_phone,'[^0-9]','','g')
         and o.created_at > now() - interval '10 minutes') >= 3 then
    raise exception 'Vous avez déjà envoyé plusieurs commandes : merci de patienter ou d''appeler la réception.' using errcode = 'P0001';
  end if;
  select c.id into v_keep from ibis.customers c
   where regexp_replace(c.phone,'[^0-9]','','g') = regexp_replace(v_phone,'[^0-9]','','g')
   order by c.created_at, c.id limit 1;
  if v_keep is not null and v_keep <> new.customer_id then
    delete from ibis.customers c where c.id = new.customer_id
       and not exists (select 1 from ibis.orders o where o.customer_id = c.id);
    new.customer_id := v_keep;
  end if;

  for v_item in select * from jsonb_array_elements(new.items) loop
    if jsonb_typeof(v_item) <> 'object' then raise exception 'Article invalide.' using errcode = 'P0001'; end if;
    v_name := btrim(coalesce(v_item ->> 'name',''));
    begin v_qty := (v_item ->> 'qty')::integer;
    exception when others then raise exception 'Quantité invalide.' using errcode = 'P0001'; end;
    if v_qty is null or v_qty < 1 or v_qty > 20 then
      raise exception 'Quantité invalide pour « % » (1 à 20).', v_name using errcode = 'P0001';
    end if;
    v_m := null;
    select m into v_m from jsonb_array_elements(v_menu) m where m ->> 'name' = v_name limit 1;
    if v_m is null then raise exception 'Article inconnu : « % ». Rechargez la page.', v_name using errcode = 'P0001'; end if;
    if coalesce((v_m ->> 'available')::boolean, true) = false then
      raise exception '« % » n''est pas disponible pour le moment.', v_name using errcode = 'P0001';
    end if;
    v_price := coalesce(nullif(v_m ->> 'price','')::integer, 0);
    v_clean := v_clean || jsonb_build_array(jsonb_build_object('name', v_name, 'qty', v_qty, 'price', v_price));
    v_total := v_total + v_qty * v_price;
  end loop;
  new.items := v_clean; new.total := v_total;
  return new;
end; $$;
drop trigger if exists trg_orders_before_insert on ibis.orders;
create trigger trg_orders_before_insert before insert on ibis.orders
  for each row execute function ibis.orders_before_insert();

create or replace function ibis.orders_before_update()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end; $$;
drop trigger if exists trg_orders_before_update on ibis.orders;
create trigger trg_orders_before_update before update on ibis.orders
  for each row execute function ibis.orders_before_update();

create or replace view ibis.orders_daily with (security_invoker = true) as
select (o.created_at at time zone 'Africa/Algiers')::date as day,
       count(*) as orders_count,
       count(*) filter (where o.status <> 'annulée') as orders_valid,
       coalesce(sum(o.total) filter (where o.status <> 'annulée'),0)::bigint as revenue_da
from ibis.orders o group by 1;

-- 3. DROITS + RLS -------------------------------------------------------
revoke all on all tables in schema ibis from anon, authenticated;
revoke execute on all functions in schema ibis from public, anon, authenticated;
grant select on ibis.site_content to anon;
grant insert (id, name, phone) on ibis.customers to anon;
grant insert (customer_id, items, fulfillment, address, notes) on ibis.orders to anon;
grant select, insert, update on ibis.site_content to authenticated;
grant select on ibis.site_content_history to authenticated;
grant select, insert, update, delete on ibis.customers, ibis.orders to authenticated;
grant select on ibis.orders_daily to authenticated;
grant all on all tables in schema ibis to service_role;

alter table ibis.site_content enable row level security;
alter table ibis.site_content_history enable row level security;
alter table ibis.customers enable row level security;
alter table ibis.orders enable row level security;
do $$ declare r record; begin
  for r in select policyname, tablename from pg_policies where schemaname = 'ibis' loop
    execute format('drop policy if exists %I on ibis.%I', r.policyname, r.tablename);
  end loop; end $$;
create policy "contenu : lecture publique" on ibis.site_content for select to anon, authenticated using (true);
create policy "contenu : ajout patron" on ibis.site_content for insert to authenticated with check (id = 1 and public.is_owner());
create policy "contenu : modification patron" on ibis.site_content for update to authenticated
  using (id = 1 and public.is_owner()) with check (id = 1 and public.is_owner());
create policy "historique : lecture patron" on ibis.site_content_history for select to authenticated using (public.is_owner());
create policy "clients : envoi depuis le site" on ibis.customers for insert to anon with check (notes is null);
create policy "clients : patron" on ibis.customers for all to authenticated using (public.is_owner()) with check (public.is_owner());
create policy "commandes : envoi depuis le site" on ibis.orders for insert to anon with check (status = 'nouvelle');
create policy "commandes : patron" on ibis.orders for all to authenticated using (public.is_owner()) with check (public.is_owner());

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'ibis' and tablename = 'orders') then
    alter publication supabase_realtime add table ibis.orders;
  end if; end $$;

-- 4. Photos : bucket « images » existant (policies Whoopy : patron seul,
--    noms « up-… »). Les fichiers ibis sont préfixés « up-ibis_… ».
-- 5. Contenu initial : voir supabase/seed.sql (inséré seulement si vide).
