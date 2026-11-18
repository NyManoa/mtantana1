/*
# M'tantana — durcissement de la sécurité (audit du 18/11/2026)

Cette migration est idempotente : elle peut être rejouée sans erreur.

## Failles corrigées

1. **Élévation de privilèges via `profiles`** : la policy `update_own_profile`
   permettait à n'importe quel utilisateur de passer son propre `role` à
   `admin` et de modifier `actif`. Désormais seules les colonnes `nom` et
   `langue` sont modifiables par le client (privilèges par colonne).
2. **`admin_update_user`** : fonction SECURITY DEFINER sans aucun contrôle,
   exécutable par tout utilisateur connecté → n'importe qui pouvait changer le
   rôle de n'importe qui. Supprimée (l'edge function `admin-users` la remplace).
3. **Rôle choisi à l'inscription** : `raw_user_meta_data.role` (modifiable par
   le client lors du signUp) était utilisé pour fixer le rôle. Le rôle ne vient
   plus que de `raw_app_meta_data` (écrit uniquement par le service role).
4. **Auto-ajout dans n'importe quel espace** : la policy INSERT de
   `user_espaces` acceptait `user_id = auth.uid()` → un utilisateur pouvait
   s'ajouter admin de n'importe quel espace. Les écritures sur `user_espaces`
   passent maintenant uniquement par des fonctions/edge functions contrôlées.
5. **Fuite de données entre espaces** : les RPC `get_solde_total`,
   `get_historique_solde`, `get_stats_mensuelles`… renvoyaient les données de
   TOUS les espaces quand `p_espace_id` était NULL. Supprimées et remplacées
   par `get_solde_espace(p_espace_id)` qui vérifie l'appartenance.
6. **Annuaire des e-mails** : `profiles` était lisible en entier par tout
   utilisateur connecté. Lecture limitée à soi-même et aux membres des mêmes
   espaces.
7. **Journal d'audit falsifiable** : les clients pouvaient insérer des lignes
   arbitraires. Seul le trigger écrit désormais dans `journal_audit`.
8. **Rôles globaux au lieu de rôles par espace** : toutes les policies se
   basent maintenant sur `user_espaces.role_dans_espace`.
9. **Usurpation d'auteur** : l'INSERT de transactions n'exigeait pas
   `auteur_id = auth.uid()`. Les champs auteur/espace/uuid deviennent immuables
   et seul un admin de l'espace peut valider une transaction en attente.

## Corrections fonctionnelles

- `settings` reçoit une colonne `espace_id` (seuil de validation par espace).
- Unicité de `budgets` par espace (avant : globale, collisions entre comptes).
- Unicité des catégories par utilisateur (avant : nom globalement unique).
- `cree_par` des budgets/alertes rempli automatiquement.
- `reset_espace` / `delete_espace` effacent proprement toutes les données.
*/

-- ============================================================================
-- 0. Fonctions d'aide (SECURITY DEFINER → pas de récursion RLS)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.is_espace_member(p_espace_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_espaces
    WHERE user_id = auth.uid() AND espace_id = p_espace_id
  );
$$;

CREATE OR REPLACE FUNCTION public.has_espace_role(p_espace_id uuid, p_roles text[])
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_espaces
    WHERE user_id = auth.uid()
      AND espace_id = p_espace_id
      AND role_dans_espace = ANY (p_roles)
  );
$$;

CREATE OR REPLACE FUNCTION public.shares_espace_with(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_user_id = auth.uid() OR EXISTS (
    SELECT 1
    FROM public.user_espaces me
    JOIN public.user_espaces other ON other.espace_id = me.espace_id
    WHERE me.user_id = auth.uid() AND other.user_id = p_user_id
  );
$$;

REVOKE ALL ON FUNCTION public.is_espace_member(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.has_espace_role(uuid, text[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.shares_espace_with(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_espace_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_espace_role(uuid, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.shares_espace_with(uuid) TO authenticated;

-- ============================================================================
-- 1. Suppression des RPC dangereuses ou qui fuient des données
-- ============================================================================

DROP FUNCTION IF EXISTS public.admin_update_user(uuid, varchar, boolean, varchar, varchar);
DROP FUNCTION IF EXISTS public.admin_list_users();
DROP FUNCTION IF EXISTS public.get_solde_total();
DROP FUNCTION IF EXISTS public.get_solde_total(uuid);
DROP FUNCTION IF EXISTS public.get_solde_utilisateur(uuid);
DROP FUNCTION IF EXISTS public.get_solde_utilisateur(uuid, uuid);
DROP FUNCTION IF EXISTS public.get_historique_solde(uuid);
DROP FUNCTION IF EXISTS public.get_historique_solde(uuid, uuid);
DROP FUNCTION IF EXISTS public.get_stats_mensuelles(varchar);
DROP FUNCTION IF EXISTS public.get_stats_mensuelles(varchar, uuid);
DROP FUNCTION IF EXISTS public._check_can_view_stats();

-- Solde calculé côté serveur, limité à un espace dont on est membre.
CREATE OR REPLACE FUNCTION public.get_solde_espace(p_espace_id uuid)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_espace_role(p_espace_id, ARRAY['admin', 'superviseur']) THEN
    RAISE EXCEPTION 'Accès refusé' USING ERRCODE = '42501';
  END IF;
  RETURN (
    SELECT COALESCE(SUM(CASE WHEN type_operation = 'miditra' THEN montant ELSE -montant END), 0)
    FROM public.transactions
    WHERE espace_id = p_espace_id AND supprime = false AND statut = 'validee'
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_solde_espace(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_solde_espace(uuid) TO authenticated;

-- ============================================================================
-- 2. PROFILES
-- ============================================================================

DROP POLICY IF EXISTS "select_profiles" ON public.profiles;
DROP POLICY IF EXISTS "insert_own_profile" ON public.profiles;
DROP POLICY IF EXISTS "update_own_profile" ON public.profiles;
DROP POLICY IF EXISTS "profiles_select" ON public.profiles;
DROP POLICY IF EXISTS "profiles_update_self" ON public.profiles;

CREATE POLICY "profiles_select" ON public.profiles FOR SELECT
  TO authenticated
  USING (public.shares_espace_with(id));

CREATE POLICY "profiles_update_self" ON public.profiles FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- Le client ne peut modifier que son nom et sa langue. Rôle, statut et e-mail
-- ne sont modifiables que par le service role (edge function admin-users).
REVOKE INSERT, UPDATE, DELETE ON public.profiles FROM anon, authenticated;
GRANT SELECT ON public.profiles TO authenticated;
GRANT UPDATE (nom, langue) ON public.profiles TO authenticated;

-- ============================================================================
-- 3. Création automatique du profil à l'inscription
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_nom text;
  v_langue text;
  v_role text;
  v_by_admin boolean;
  v_espace_id uuid;
BEGIN
  -- app_metadata n'est modifiable que par le service role : c'est la seule
  -- source de confiance pour savoir si le compte a été créé par un admin.
  v_by_admin := COALESCE((NEW.raw_app_meta_data ->> 'created_by_admin')::boolean, false);

  v_nom := left(COALESCE(NULLIF(trim(NEW.raw_user_meta_data ->> 'nom'), ''), split_part(NEW.email, '@', 1)), 100);
  v_langue := CASE WHEN NEW.raw_user_meta_data ->> 'langue' = 'mg' THEN 'mg' ELSE 'fr' END;

  IF v_by_admin THEN
    v_role := COALESCE(NEW.raw_app_meta_data ->> 'role', 'operateur');
    IF v_role NOT IN ('operateur', 'superviseur', 'admin') THEN
      v_role := 'operateur';
    END IF;
  ELSE
    -- Inscription libre : l'utilisateur est propriétaire (admin) de son propre espace.
    v_role := 'admin';
  END IF;

  INSERT INTO public.profiles (id, nom, email, role, langue, actif)
  VALUES (NEW.id, v_nom, lower(NEW.email), v_role, v_langue, true)
  ON CONFLICT (id) DO NOTHING;

  IF NOT v_by_admin THEN
    INSERT INTO public.espaces (nom, cree_par)
    VALUES ('Mon espace', NEW.id)
    RETURNING id INTO v_espace_id;

    INSERT INTO public.user_espaces (user_id, espace_id, role_dans_espace)
    VALUES (NEW.id, v_espace_id, 'admin')
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

DROP FUNCTION IF EXISTS public.handle_new_auth_user() CASCADE;
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.fn_handle_new_user();

REVOKE ALL ON FUNCTION public.fn_handle_new_user() FROM PUBLIC, anon, authenticated;

-- ============================================================================
-- 4. ESPACES
-- ============================================================================

DROP POLICY IF EXISTS "select_espaces" ON public.espaces;
DROP POLICY IF EXISTS "insert_espaces" ON public.espaces;
DROP POLICY IF EXISTS "update_espaces" ON public.espaces;
DROP POLICY IF EXISTS "delete_espaces" ON public.espaces;

CREATE POLICY "select_espaces" ON public.espaces FOR SELECT
  TO authenticated
  USING (public.is_espace_member(id));

CREATE POLICY "update_espaces" ON public.espaces FOR UPDATE
  TO authenticated
  USING (public.has_espace_role(id, ARRAY['admin']))
  WITH CHECK (public.has_espace_role(id, ARRAY['admin']));

-- Création / suppression uniquement via create_espace() / delete_espace().
REVOKE INSERT, DELETE ON public.espaces FROM anon, authenticated;
REVOKE UPDATE ON public.espaces FROM anon, authenticated;
GRANT SELECT ON public.espaces TO authenticated;
GRANT UPDATE (nom) ON public.espaces TO authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'espaces_nom_length' AND conrelid = 'public.espaces'::regclass
  ) THEN
    ALTER TABLE public.espaces
      ADD CONSTRAINT espaces_nom_length CHECK (char_length(trim(nom)) BETWEEN 1 AND 100) NOT VALID;
  END IF;
END $$;

-- ============================================================================
-- 5. USER_ESPACES (appartenance)
-- ============================================================================

DROP POLICY IF EXISTS "select_user_espaces" ON public.user_espaces;
DROP POLICY IF EXISTS "insert_user_espaces" ON public.user_espaces;
DROP POLICY IF EXISTS "update_user_espaces" ON public.user_espaces;
DROP POLICY IF EXISTS "delete_user_espaces" ON public.user_espaces;

CREATE POLICY "select_user_espaces" ON public.user_espaces FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR public.has_espace_role(espace_id, ARRAY['admin']));

-- Aucune écriture directe : create_espace() et l'edge function admin-users
-- (service role) sont les seuls chemins.
REVOKE INSERT, UPDATE, DELETE ON public.user_espaces FROM anon, authenticated;
GRANT SELECT ON public.user_espaces TO authenticated;

DROP FUNCTION IF EXISTS public.is_admin_in_espace(uuid, uuid);

-- ============================================================================
-- 6. RPC des espaces
-- ============================================================================

-- Recréée (l'ancienne version pouvait renvoyer jsonb selon l'historique de la base).
DROP FUNCTION IF EXISTS public.create_espace(text);
CREATE FUNCTION public.create_espace(p_nom text)
RETURNS TABLE(id uuid, nom text, cree_le timestamp with time zone, role_dans_espace character varying)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_nom text := left(trim(COALESCE(p_nom, '')), 100);
  v_espace_id uuid;
  v_cree_le timestamptz;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Non authentifié' USING ERRCODE = '42501';
  END IF;
  IF v_nom = '' THEN
    RAISE EXCEPTION 'Nom requis';
  END IF;
  IF (SELECT count(*) FROM public.espaces e WHERE e.cree_par = v_uid) >= 50 THEN
    RAISE EXCEPTION 'Nombre maximal d''espaces atteint';
  END IF;

  INSERT INTO public.espaces (nom, cree_par)
  VALUES (v_nom, v_uid)
  RETURNING espaces.id, espaces.cree_le INTO v_espace_id, v_cree_le;

  INSERT INTO public.user_espaces (user_id, espace_id, role_dans_espace)
  VALUES (v_uid, v_espace_id, 'admin');

  RETURN QUERY SELECT v_espace_id, v_nom, v_cree_le, 'admin'::varchar;
END;
$$;

-- Les deux fonctions suivantes changent de type de retour : on les recrée.
DROP FUNCTION IF EXISTS public.delete_espace(uuid);
DROP FUNCTION IF EXISTS public.reset_espace(uuid);

CREATE FUNCTION public.reset_espace(p_espace_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_espace_role(p_espace_id, ARRAY['admin']) THEN
    RAISE EXCEPTION 'Accès refusé' USING ERRCODE = '42501';
  END IF;

  PERFORM set_config('mtantana.skip_audit', 'on', true);
  DELETE FROM public.transactions WHERE espace_id = p_espace_id;
  DELETE FROM public.transactions_recurrentes WHERE espace_id = p_espace_id;
  DELETE FROM public.transactions_planifiees WHERE espace_id = p_espace_id;
  DELETE FROM public.budgets WHERE espace_id = p_espace_id;
  DELETE FROM public.alertes WHERE espace_id = p_espace_id;
  DELETE FROM public.journal_audit WHERE espace_id = p_espace_id;
  PERFORM set_config('mtantana.skip_audit', 'off', true);
END;
$$;

CREATE FUNCTION public.delete_espace(p_espace_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_espace_role(p_espace_id, ARRAY['admin']) THEN
    RAISE EXCEPTION 'Accès refusé' USING ERRCODE = '42501';
  END IF;
  IF (SELECT count(*) FROM public.user_espaces WHERE user_id = auth.uid()) <= 1 THEN
    RAISE EXCEPTION 'Impossible de supprimer votre dernier espace';
  END IF;

  PERFORM set_config('mtantana.skip_audit', 'on', true);
  DELETE FROM public.transactions WHERE espace_id = p_espace_id;
  DELETE FROM public.journal_audit WHERE espace_id = p_espace_id;
  DELETE FROM public.espaces WHERE id = p_espace_id; -- CASCADE pour le reste
  PERFORM set_config('mtantana.skip_audit', 'off', true);
END;
$$;

REVOKE ALL ON FUNCTION public.create_espace(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reset_espace(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.delete_espace(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_espace(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reset_espace(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_espace(uuid) TO authenticated;

-- ============================================================================
-- 7. SETTINGS par espace
-- ============================================================================

ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS espace_id uuid REFERENCES public.espaces(id) ON DELETE CASCADE;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS id uuid NOT NULL DEFAULT gen_random_uuid();

DO $$
DECLARE
  v_pk_cols text;
BEGIN
  SELECT string_agg(a.attname, ',') INTO v_pk_cols
  FROM pg_constraint c
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
  WHERE c.conrelid = 'public.settings'::regclass AND c.contype = 'p';

  IF v_pk_cols = 'cle' THEN
    EXECUTE 'ALTER TABLE public.settings DROP CONSTRAINT ' || (
      SELECT conname FROM pg_constraint WHERE conrelid = 'public.settings'::regclass AND contype = 'p'
    );
    v_pk_cols := NULL;
  END IF;

  IF v_pk_cols IS NULL THEN
    ALTER TABLE public.settings ADD PRIMARY KEY (id);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS settings_espace_cle_key ON public.settings (espace_id, cle);
CREATE UNIQUE INDEX IF NOT EXISTS settings_global_cle_key ON public.settings (cle) WHERE espace_id IS NULL;

DROP POLICY IF EXISTS "select_settings" ON public.settings;
DROP POLICY IF EXISTS "admin_write_settings" ON public.settings;

CREATE POLICY "select_settings" ON public.settings FOR SELECT
  TO authenticated
  USING (espace_id IS NULL OR public.is_espace_member(espace_id));

CREATE POLICY "admin_write_settings" ON public.settings FOR ALL
  TO authenticated
  USING (espace_id IS NOT NULL AND public.has_espace_role(espace_id, ARRAY['admin']))
  WITH CHECK (espace_id IS NOT NULL AND public.has_espace_role(espace_id, ARRAY['admin']));

-- ============================================================================
-- 8. TRANSACTIONS
-- ============================================================================

DROP POLICY IF EXISTS "select_transactions" ON public.transactions;
DROP POLICY IF EXISTS "insert_transactions" ON public.transactions;
DROP POLICY IF EXISTS "update_transactions" ON public.transactions;
DROP POLICY IF EXISTS "delete_transactions" ON public.transactions;

-- Opérateur : ses propres lignes. Admin / superviseur : tout l'espace.
CREATE POLICY "select_transactions" ON public.transactions FOR SELECT
  TO authenticated
  USING (
    public.has_espace_role(espace_id, ARRAY['admin', 'superviseur'])
    OR (auteur_id = auth.uid() AND public.is_espace_member(espace_id))
  );

CREATE POLICY "insert_transactions" ON public.transactions FOR INSERT
  TO authenticated
  WITH CHECK (auteur_id = auth.uid() AND public.is_espace_member(espace_id));

CREATE POLICY "update_transactions" ON public.transactions FOR UPDATE
  TO authenticated
  USING (
    public.has_espace_role(espace_id, ARRAY['admin'])
    OR (auteur_id = auth.uid() AND public.is_espace_member(espace_id))
  )
  WITH CHECK (public.is_espace_member(espace_id));

-- Suppression physique réservée aux admins (le client utilise `supprime = true`).
CREATE POLICY "delete_transactions" ON public.transactions FOR DELETE
  TO authenticated
  USING (public.has_espace_role(espace_id, ARRAY['admin']));

-- Pas de repli vers « un espace au hasard » si espace_id manque.
CREATE OR REPLACE FUNCTION public.fn_transactions_set_espace()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.espace_id IS NULL THEN
    RAISE EXCEPTION 'espace_id requis';
  END IF;
  RETURN NEW;
END;
$$;

-- Champs immuables + validation réservée aux admins de l'espace.
CREATE OR REPLACE FUNCTION public.fn_transactions_guard_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW; -- service role / maintenance
  END IF;
  NEW.id := OLD.id;
  NEW.client_uuid := OLD.client_uuid;
  NEW.auteur_id := OLD.auteur_id;
  NEW.espace_id := OLD.espace_id;
  NEW.cree_le := OLD.cree_le;
  -- Seul un admin peut faire passer une ligne à « validée ». La remise en
  -- attente (déclenchée par fn_auto_validation) reste toujours possible.
  IF NEW.statut = 'validee' AND OLD.statut IS DISTINCT FROM 'validee'
     AND NOT public.has_espace_role(OLD.espace_id, ARRAY['admin']) THEN
    NEW.statut := OLD.statut;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS transactions_guard_update ON public.transactions;
CREATE TRIGGER transactions_guard_update
BEFORE UPDATE ON public.transactions
FOR EACH ROW EXECUTE FUNCTION public.fn_transactions_guard_update();

-- Seuil de validation lu par espace ; rôle vérifié dans l'espace.
CREATE OR REPLACE FUNCTION public.fn_auto_validation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_seuil numeric;
BEGIN
  SELECT valeur::numeric INTO v_seuil
  FROM public.settings
  WHERE cle = 'seuil_validation' AND espace_id = NEW.espace_id;

  IF v_seuil IS NULL THEN
    SELECT valeur::numeric INTO v_seuil
    FROM public.settings
    WHERE cle = 'seuil_validation' AND espace_id IS NULL;
  END IF;
  IF v_seuil IS NULL THEN v_seuil := 100000; END IF;

  IF NEW.montant >= v_seuil AND NEW.statut = 'validee'
     AND auth.uid() IS NOT NULL
     AND NOT public.has_espace_role(NEW.espace_id, ARRAY['admin']) THEN
    NEW.statut := 'en_attente_validation';
  END IF;
  RETURN NEW;
END;
$$;

-- Audit : espace renseigné, désactivable pendant reset/suppression d'espace.
CREATE OR REPLACE FUNCTION public.fn_transactions_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_action varchar(20);
BEGIN
  IF current_setting('mtantana.skip_audit', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'DELETE' THEN
    INSERT INTO public.journal_audit (transaction_id, utilisateur_id, action, ancienne_valeur, nouvelle_valeur, espace_id)
    VALUES (NULL, COALESCE(auth.uid(), OLD.auteur_id), 'suppression', to_jsonb(OLD), NULL, OLD.espace_id);
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.supprime AND NOT OLD.supprime THEN
      v_action := 'suppression';
    ELSIF NEW.statut = 'validee' AND OLD.statut <> 'validee' THEN
      v_action := 'validation';
    ELSE
      v_action := 'modification';
    END IF;
    INSERT INTO public.journal_audit (transaction_id, utilisateur_id, action, ancienne_valeur, nouvelle_valeur, espace_id)
    VALUES (NEW.id, COALESCE(auth.uid(), NEW.auteur_id), v_action, to_jsonb(OLD), to_jsonb(NEW), NEW.espace_id);
    RETURN NEW;
  END IF;

  INSERT INTO public.journal_audit (transaction_id, utilisateur_id, action, ancienne_valeur, nouvelle_valeur, espace_id)
  VALUES (NEW.id, COALESCE(auth.uid(), NEW.auteur_id), 'creation', NULL, to_jsonb(NEW), NEW.espace_id);
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_transactions_set_espace() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_transactions_guard_update() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_auto_validation() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_transactions_audit() FROM PUBLIC, anon, authenticated;

-- ============================================================================
-- 9. JOURNAL D'AUDIT — lecture admin de l'espace, écriture trigger uniquement
-- ============================================================================

DROP POLICY IF EXISTS "select_journal_admin" ON public.journal_audit;
DROP POLICY IF EXISTS "select_audit" ON public.journal_audit;
DROP POLICY IF EXISTS "insert_audit" ON public.journal_audit;

CREATE POLICY "select_audit" ON public.journal_audit FOR SELECT
  TO authenticated
  USING (espace_id IS NOT NULL AND public.has_espace_role(espace_id, ARRAY['admin']));

REVOKE INSERT, UPDATE, DELETE ON public.journal_audit FROM anon, authenticated;
GRANT SELECT ON public.journal_audit TO authenticated;

-- ============================================================================
-- 10. BUDGETS
-- ============================================================================

ALTER TABLE public.budgets ALTER COLUMN cree_par DROP NOT NULL;
ALTER TABLE public.budgets ALTER COLUMN cree_par SET DEFAULT auth.uid();
ALTER TABLE public.budgets DROP CONSTRAINT IF EXISTS budgets_categorie_mois_annee_key;
CREATE UNIQUE INDEX IF NOT EXISTS budgets_espace_categorie_mois_key
  ON public.budgets (espace_id, categorie, mois_annee);

DROP POLICY IF EXISTS "select_budgets" ON public.budgets;
DROP POLICY IF EXISTS "admin_write_budgets" ON public.budgets;

CREATE POLICY "select_budgets" ON public.budgets FOR SELECT
  TO authenticated
  USING (public.has_espace_role(espace_id, ARRAY['admin', 'superviseur']));

CREATE POLICY "admin_write_budgets" ON public.budgets FOR ALL
  TO authenticated
  USING (public.has_espace_role(espace_id, ARRAY['admin']))
  WITH CHECK (public.has_espace_role(espace_id, ARRAY['admin']));

-- ============================================================================
-- 11. ALERTES
-- ============================================================================

ALTER TABLE public.alertes ALTER COLUMN cree_par DROP NOT NULL;
ALTER TABLE public.alertes ALTER COLUMN cree_par SET DEFAULT auth.uid();

DROP POLICY IF EXISTS "select_alertes" ON public.alertes;
DROP POLICY IF EXISTS "admin_write_alertes" ON public.alertes;

CREATE POLICY "select_alertes" ON public.alertes FOR SELECT
  TO authenticated
  USING (public.has_espace_role(espace_id, ARRAY['admin']));

CREATE POLICY "admin_write_alertes" ON public.alertes FOR ALL
  TO authenticated
  USING (public.has_espace_role(espace_id, ARRAY['admin']))
  WITH CHECK (public.has_espace_role(espace_id, ARRAY['admin']));

-- ============================================================================
-- 12. TRANSACTIONS RÉCURRENTES ET PLANIFIÉES
-- ============================================================================

DROP POLICY IF EXISTS "select_recurrentes" ON public.transactions_recurrentes;
DROP POLICY IF EXISTS "insert_recurrentes" ON public.transactions_recurrentes;
DROP POLICY IF EXISTS "update_recurrentes" ON public.transactions_recurrentes;
DROP POLICY IF EXISTS "delete_recurrentes" ON public.transactions_recurrentes;

CREATE POLICY "select_recurrentes" ON public.transactions_recurrentes FOR SELECT
  TO authenticated
  USING (
    (auteur_id = auth.uid() AND public.is_espace_member(espace_id))
    OR public.has_espace_role(espace_id, ARRAY['admin', 'superviseur'])
  );
CREATE POLICY "insert_recurrentes" ON public.transactions_recurrentes FOR INSERT
  TO authenticated
  WITH CHECK (auteur_id = auth.uid() AND public.is_espace_member(espace_id));
CREATE POLICY "update_recurrentes" ON public.transactions_recurrentes FOR UPDATE
  TO authenticated
  USING ((auteur_id = auth.uid() AND public.is_espace_member(espace_id)) OR public.has_espace_role(espace_id, ARRAY['admin']))
  WITH CHECK (public.is_espace_member(espace_id));
CREATE POLICY "delete_recurrentes" ON public.transactions_recurrentes FOR DELETE
  TO authenticated
  USING ((auteur_id = auth.uid() AND public.is_espace_member(espace_id)) OR public.has_espace_role(espace_id, ARRAY['admin']));

DROP POLICY IF EXISTS "select_planifiees" ON public.transactions_planifiees;
DROP POLICY IF EXISTS "insert_planifiees" ON public.transactions_planifiees;
DROP POLICY IF EXISTS "update_planifiees" ON public.transactions_planifiees;
DROP POLICY IF EXISTS "delete_planifiees" ON public.transactions_planifiees;

CREATE POLICY "select_planifiees" ON public.transactions_planifiees FOR SELECT
  TO authenticated
  USING (
    (auteur_id = auth.uid() AND public.is_espace_member(espace_id))
    OR public.has_espace_role(espace_id, ARRAY['admin', 'superviseur'])
  );
CREATE POLICY "insert_planifiees" ON public.transactions_planifiees FOR INSERT
  TO authenticated
  WITH CHECK (auteur_id = auth.uid() AND public.is_espace_member(espace_id));
CREATE POLICY "update_planifiees" ON public.transactions_planifiees FOR UPDATE
  TO authenticated
  USING ((auteur_id = auth.uid() AND public.is_espace_member(espace_id)) OR public.has_espace_role(espace_id, ARRAY['admin']))
  WITH CHECK (public.is_espace_member(espace_id));
CREATE POLICY "delete_planifiees" ON public.transactions_planifiees FOR DELETE
  TO authenticated
  USING ((auteur_id = auth.uid() AND public.is_espace_member(espace_id)) OR public.has_espace_role(espace_id, ARRAY['admin']));

-- ============================================================================
-- 13. CATÉGORIES (globales + personnelles)
-- ============================================================================

ALTER TABLE public.categories ALTER COLUMN user_id SET DEFAULT auth.uid();
ALTER TABLE public.categories DROP CONSTRAINT IF EXISTS categories_nom_key;
CREATE UNIQUE INDEX IF NOT EXISTS categories_user_nom_key ON public.categories (user_id, nom);
CREATE UNIQUE INDEX IF NOT EXISTS categories_global_nom_key ON public.categories (nom) WHERE user_id IS NULL;

DROP POLICY IF EXISTS "select_categories" ON public.categories;
DROP POLICY IF EXISTS "admin_write_categories" ON public.categories;
DROP POLICY IF EXISTS "insert_categories" ON public.categories;
DROP POLICY IF EXISTS "update_categories" ON public.categories;
DROP POLICY IF EXISTS "delete_categories" ON public.categories;

CREATE POLICY "select_categories" ON public.categories FOR SELECT
  TO authenticated USING (user_id IS NULL OR user_id = auth.uid());
CREATE POLICY "insert_categories" ON public.categories FOR INSERT
  TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "update_categories" ON public.categories FOR UPDATE
  TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "delete_categories" ON public.categories FOR DELETE
  TO authenticated USING (user_id = auth.uid());

-- ============================================================================
-- 14. Le rôle anon n'a rien à faire sur les tables métier
-- ============================================================================

REVOKE ALL ON public.profiles, public.espaces, public.user_espaces, public.transactions,
  public.journal_audit, public.settings, public.categories, public.budgets, public.alertes,
  public.transactions_recurrentes, public.transactions_planifiees FROM anon;
