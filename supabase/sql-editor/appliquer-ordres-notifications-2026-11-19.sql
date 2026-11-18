-- ============================================================================
-- M'tantana — ordres, fonctions des membres, notifications (19/11/2026)
--
-- PRÉREQUIS : avoir exécuté appliquer-mises-a-jour-2026-11-18.sql.
-- Supabase → SQL Editor → New query → coller TOUT ce fichier → Run.
-- Transaction unique : en cas d'erreur, rien n'est modifié. Rejouable.
-- ============================================================================

BEGIN;

/*
# Ordres de transaction, fonctions des membres, notifications et traçabilité

Exemple : l'admin (fonction « Commissaire aux comptes ») émet un ORDRE de
débit de 250 000 Ar pour le 30/11, assigné au superviseur (fonction
« Trésorier »). Le trésorier reçoit la notification et n'a qu'à « Exécuter » :
la transaction est créée avec le montant fixé par l'admin, déjà validée au nom
de celui-ci. Le trésorier peut aussi refuser (motif obligatoire) ; il peut
toujours saisir librement, ses saisies passant alors par la validation.

1. `user_espaces.fonction` / `invitations_espace.fonction`
   Titre libre affiché (Trésorier, Commissaire aux comptes…). Les DROITS
   restent ceux du rôle (operateur / superviseur / admin).

2. `transactions_planifiees` devient un ordre :
   - `assigne_a` (exécutant désigné ; NULL = tout superviseur/admin)
   - `realisee_par`, `realisee_le`, `transaction_client_uuid`
   - `annulee_par`, `annulee_le`, `motif_annulation` (annulation ou refus)
   - statut `refusee` ajouté
   - visible aussi par l'exécutant désigné

3. `transactions` : `ordre_id`, `valide_par`, `valide_le`, `supprime_par`,
   `motif_refus` — renseignés par trigger uniquement.
   Exécution d'un ordre = INSERT d'une transaction avec `ordre_id` :
   le trigger vérifie (exécutant, montant, type, ordre en attente), clôt
   l'ordre, et valide d'office si l'ordre vient d'un admin.

4. `evenements` : fil d'activité / notifications de l'espace, écrit
   UNIQUEMENT par triggers (non falsifiable), diffusé en temps réel.
   Lecture : admins/superviseurs tout ; opérateurs ce qui les concerne.

5. `refuser_ordre(id, motif)` : refus par l'exécutant.

Idempotent : peut être rejouée sans erreur.
*/

-- ============================================================================
-- 1. FONCTIONS DES MEMBRES
-- ============================================================================

ALTER TABLE public.user_espaces ADD COLUMN IF NOT EXISTS fonction varchar(60);
ALTER TABLE public.invitations_espace ADD COLUMN IF NOT EXISTS fonction varchar(60);

CREATE OR REPLACE FUNCTION public.accept_pending_invitations()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_email text;
  v_confirmed timestamptz;
  v_count integer := 0;
BEGIN
  IF v_uid IS NULL THEN
    RETURN 0;
  END IF;

  SELECT lower(u.email), u.email_confirmed_at INTO v_email, v_confirmed
    FROM auth.users u WHERE u.id = v_uid;
  IF v_email IS NULL OR v_confirmed IS NULL THEN
    RETURN 0;
  END IF;
  IF EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = v_uid AND p.actif = false) THEN
    RETURN 0;
  END IF;

  WITH inv AS (
    DELETE FROM public.invitations_espace i
     WHERE i.email = v_email
     RETURNING i.espace_id, i.role_dans_espace, i.fonction
  ), ins AS (
    INSERT INTO public.user_espaces (user_id, espace_id, role_dans_espace, fonction)
    SELECT v_uid, inv.espace_id, inv.role_dans_espace, inv.fonction FROM inv
    ON CONFLICT (user_id, espace_id) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM ins;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.accept_pending_invitations() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_pending_invitations() TO authenticated;

-- ============================================================================
-- 2. ÉVÉNEMENTS (notifications + traçabilité)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.evenements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  espace_id uuid NOT NULL REFERENCES public.espaces(id) ON DELETE CASCADE,
  type varchar(40) NOT NULL,
  acteur_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  acteur_nom text,
  acteur_fonction text,
  cible_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  titre text NOT NULL DEFAULT '',
  montant numeric(14,2),
  type_operation varchar(10),
  ref_table varchar(40),
  ref_id uuid,
  details jsonb,
  cree_le timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_evenements_espace_date ON public.evenements (espace_id, cree_le DESC);

ALTER TABLE public.evenements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.evenements FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.evenements TO authenticated;

DROP POLICY IF EXISTS "select_evenements" ON public.evenements;
CREATE POLICY "select_evenements" ON public.evenements FOR SELECT
  TO authenticated
  USING (
    public.has_espace_role(espace_id, ARRAY['admin', 'superviseur'])
    OR (public.is_espace_member(espace_id) AND (acteur_id = auth.uid() OR cible_id = auth.uid()))
  );

-- Diffusion temps réel (Supabase Realtime respecte la policy ci-dessus).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'evenements'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.evenements;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.fn_emit_event(
  p_espace uuid,
  p_type text,
  p_cible uuid,
  p_titre text,
  p_montant numeric,
  p_type_op text,
  p_ref_table text,
  p_ref_id uuid,
  p_details jsonb,
  p_acteur uuid DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_acteur uuid := COALESCE(auth.uid(), p_acteur);
  v_nom text;
  v_fonction text;
BEGIN
  IF current_setting('mtantana.skip_audit', true) = 'on' THEN
    RETURN;
  END IF;
  SELECT p.nom INTO v_nom FROM public.profiles p WHERE p.id = v_acteur;
  SELECT ue.fonction INTO v_fonction FROM public.user_espaces ue WHERE ue.user_id = v_acteur AND ue.espace_id = p_espace;
  INSERT INTO public.evenements (espace_id, type, acteur_id, acteur_nom, acteur_fonction, cible_id, titre, montant, type_operation, ref_table, ref_id, details)
  VALUES (p_espace, p_type, v_acteur, v_nom, v_fonction, p_cible, left(COALESCE(p_titre, ''), 255), p_montant, p_type_op, p_ref_table, p_ref_id, p_details);
END;
$$;

REVOKE ALL ON FUNCTION public.fn_emit_event(uuid, text, uuid, text, numeric, text, text, uuid, jsonb, uuid) FROM PUBLIC, anon, authenticated;

-- ============================================================================
-- 3. ORDRES (transactions_planifiees)
-- ============================================================================

ALTER TABLE public.transactions_planifiees ADD COLUMN IF NOT EXISTS assigne_a uuid REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE public.transactions_planifiees ADD COLUMN IF NOT EXISTS realisee_par uuid REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE public.transactions_planifiees ADD COLUMN IF NOT EXISTS realisee_le timestamptz;
ALTER TABLE public.transactions_planifiees ADD COLUMN IF NOT EXISTS transaction_client_uuid uuid;
ALTER TABLE public.transactions_planifiees ADD COLUMN IF NOT EXISTS annulee_par uuid REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE public.transactions_planifiees ADD COLUMN IF NOT EXISTS annulee_le timestamptz;
ALTER TABLE public.transactions_planifiees ADD COLUMN IF NOT EXISTS motif_annulation varchar(500);

ALTER TABLE public.transactions_planifiees DROP CONSTRAINT IF EXISTS transactions_planifiees_statut_check;
ALTER TABLE public.transactions_planifiees ADD CONSTRAINT transactions_planifiees_statut_check
  CHECK (statut IN ('en_attente', 'realisee', 'annulee', 'refusee'));

CREATE INDEX IF NOT EXISTS idx_planifiees_assigne ON public.transactions_planifiees (assigne_a) WHERE statut = 'en_attente';

-- L'exécutant désigné voit l'ordre.
DROP POLICY IF EXISTS "select_planifiees" ON public.transactions_planifiees;
CREATE POLICY "select_planifiees" ON public.transactions_planifiees FOR SELECT
  TO authenticated
  USING (
    (auteur_id = auth.uid() AND public.is_espace_member(espace_id))
    OR (assigne_a = auth.uid() AND public.is_espace_member(espace_id))
    OR public.has_espace_role(espace_id, ARRAY['admin', 'superviseur'])
  );

CREATE OR REPLACE FUNCTION public.fn_planifiees_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_is_admin boolean;
BEGIN
  IF v_uid IS NULL OR current_setting('mtantana.ordre_systeme', true) = 'on' THEN
    RETURN NEW; -- service role, ou mise à jour faite par une fonction système
  END IF;
  v_is_admin := public.has_espace_role(NEW.espace_id, ARRAY['admin']);

  IF TG_OP = 'INSERT' THEN
    NEW.statut := 'en_attente';
    NEW.realisee_par := NULL;
    NEW.realisee_le := NULL;
    NEW.transaction_client_uuid := NULL;
    NEW.annulee_par := NULL;
    NEW.annulee_le := NULL;
    NEW.motif_annulation := NULL;
  ELSE
    NEW.id := OLD.id;
    NEW.auteur_id := OLD.auteur_id;
    NEW.espace_id := OLD.espace_id;
    NEW.cree_le := OLD.cree_le;
    NEW.realisee_par := OLD.realisee_par;
    NEW.realisee_le := OLD.realisee_le;
    NEW.transaction_client_uuid := OLD.transaction_client_uuid;

    -- Un ordre exécuté est figé.
    IF OLD.statut = 'realisee' THEN
      RETURN OLD;
    END IF;

    IF NEW.statut IS DISTINCT FROM OLD.statut THEN
      IF NEW.statut = 'realisee' THEN
        -- Sans transaction liée : seulement pour un rappel personnel.
        IF OLD.auteur_id <> v_uid OR (OLD.assigne_a IS NOT NULL AND OLD.assigne_a <> v_uid) THEN
          RAISE EXCEPTION 'Un ordre s''exécute en créant sa transaction' USING ERRCODE = '42501';
        END IF;
        NEW.realisee_par := v_uid;
        NEW.realisee_le := now();
      ELSIF NEW.statut = 'annulee' THEN
        NEW.annulee_par := v_uid;
        NEW.annulee_le := now();
        NEW.motif_annulation := left(NULLIF(trim(NEW.motif_annulation), ''), 500);
      ELSIF NEW.statut = 'refusee' THEN
        RAISE EXCEPTION 'Utilisez refuser_ordre()' USING ERRCODE = '42501';
      ELSIF NEW.statut = 'en_attente' THEN
        -- Réouverture d'un ordre annulé / refusé.
        NEW.annulee_par := NULL;
        NEW.annulee_le := NULL;
        NEW.motif_annulation := NULL;
      END IF;
    ELSE
      NEW.annulee_par := OLD.annulee_par;
      NEW.annulee_le := OLD.annulee_le;
      NEW.motif_annulation := OLD.motif_annulation;
    END IF;
  END IF;

  -- Seul un admin peut désigner quelqu'un d'autre comme exécutant.
  IF NEW.assigne_a IS NOT NULL AND NEW.assigne_a <> v_uid
     AND (TG_OP = 'INSERT' OR NEW.assigne_a IS DISTINCT FROM OLD.assigne_a) THEN
    IF NOT v_is_admin THEN
      RAISE EXCEPTION 'Seul un administrateur peut assigner un ordre' USING ERRCODE = '42501';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.user_espaces ue WHERE ue.user_id = NEW.assigne_a AND ue.espace_id = NEW.espace_id) THEN
      RAISE EXCEPTION 'L''exécutant doit être membre de l''espace' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS planifiees_guard ON public.transactions_planifiees;
CREATE TRIGGER planifiees_guard
BEFORE INSERT OR UPDATE ON public.transactions_planifiees
FOR EACH ROW EXECUTE FUNCTION public.fn_planifiees_guard();

-- Refus par l'exécutant (motif obligatoire).
CREATE OR REPLACE FUNCTION public.refuser_ordre(p_ordre_id uuid, p_motif text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  o public.transactions_planifiees%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Non authentifié' USING ERRCODE = '42501';
  END IF;
  IF NULLIF(trim(COALESCE(p_motif, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Motif du refus obligatoire' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO o FROM public.transactions_planifiees WHERE id = p_ordre_id FOR UPDATE;
  IF NOT FOUND OR NOT public.is_espace_member(o.espace_id) THEN
    RAISE EXCEPTION 'Ordre introuvable' USING ERRCODE = '42501';
  END IF;
  IF o.statut <> 'en_attente' THEN
    RAISE EXCEPTION 'Cet ordre a déjà été traité' USING ERRCODE = '23514';
  END IF;
  IF NOT (o.assigne_a = v_uid
          OR (o.assigne_a IS NULL AND public.has_espace_role(o.espace_id, ARRAY['admin', 'superviseur']))) THEN
    RAISE EXCEPTION 'Seul l''exécutant désigné peut refuser cet ordre' USING ERRCODE = '42501';
  END IF;

  PERFORM set_config('mtantana.ordre_systeme', 'on', true);
  UPDATE public.transactions_planifiees
     SET statut = 'refusee', annulee_par = v_uid, annulee_le = now(), motif_annulation = left(trim(p_motif), 500)
   WHERE id = p_ordre_id;
  PERFORM set_config('mtantana.ordre_systeme', 'off', true);
END;
$$;

REVOKE ALL ON FUNCTION public.refuser_ordre(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.refuser_ordre(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.fn_planifiees_events()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_type text;
  v_cible uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.fn_emit_event(NEW.espace_id, 'ordre_cree', NEW.assigne_a, NEW.titre, NEW.montant_prevu, NEW.type_operation,
      'transactions_planifiees', NEW.id, jsonb_build_object('date_prevue', NEW.date_prevue, 'motif', NEW.motif), NEW.auteur_id);
    RETURN NEW;
  END IF;

  IF NEW.statut IS DISTINCT FROM OLD.statut THEN
    v_type := CASE NEW.statut
      WHEN 'realisee' THEN 'ordre_execute'
      WHEN 'annulee' THEN 'ordre_annule'
      WHEN 'refusee' THEN 'ordre_refuse'
      ELSE 'ordre_rouvert' END;
    v_cible := CASE WHEN NEW.statut IN ('realisee', 'refusee') THEN NEW.auteur_id ELSE NEW.assigne_a END;
    PERFORM public.fn_emit_event(NEW.espace_id, v_type, v_cible, NEW.titre, NEW.montant_prevu, NEW.type_operation,
      'transactions_planifiees', NEW.id,
      jsonb_build_object('date_prevue', NEW.date_prevue, 'motif', NEW.motif_annulation, 'transaction_client_uuid', NEW.transaction_client_uuid));
  ELSIF (NEW.montant_prevu, NEW.date_prevue, NEW.type_operation, NEW.assigne_a, NEW.titre)
        IS DISTINCT FROM (OLD.montant_prevu, OLD.date_prevue, OLD.type_operation, OLD.assigne_a, OLD.titre) THEN
    PERFORM public.fn_emit_event(NEW.espace_id, 'ordre_modifie', NEW.assigne_a, NEW.titre, NEW.montant_prevu, NEW.type_operation,
      'transactions_planifiees', NEW.id,
      jsonb_build_object('date_prevue', NEW.date_prevue, 'ancien_montant', OLD.montant_prevu, 'ancienne_date', OLD.date_prevue));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS planifiees_events ON public.transactions_planifiees;
CREATE TRIGGER planifiees_events
AFTER INSERT OR UPDATE ON public.transactions_planifiees
FOR EACH ROW EXECUTE FUNCTION public.fn_planifiees_events();

REVOKE ALL ON FUNCTION public.fn_planifiees_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_planifiees_events() FROM PUBLIC, anon, authenticated;

-- ============================================================================
-- 4. TRANSACTIONS : exécution d'ordre, traces de validation et de refus
-- ============================================================================

ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS ordre_id uuid REFERENCES public.transactions_planifiees(id) ON DELETE SET NULL;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS valide_par uuid REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS valide_le timestamptz;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS supprime_par uuid REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS motif_refus varchar(500);

CREATE UNIQUE INDEX IF NOT EXISTS transactions_ordre_unique ON public.transactions (ordre_id) WHERE ordre_id IS NOT NULL;

-- Nommé « trace » : s'exécute APRÈS auto_validation / guard_update / set_espace
-- (ordre alphabétique des triggers BEFORE).
CREATE OR REPLACE FUNCTION public.fn_transactions_trace()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_is_admin boolean;
  o public.transactions_planifiees%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RETURN NEW;
  END IF;
  v_is_admin := public.has_espace_role(COALESCE(NEW.espace_id, OLD.espace_id), ARRAY['admin']);

  IF TG_OP = 'INSERT' THEN
    -- Upsert d'une ligne existante : la branche UPDATE s'en chargera.
    IF EXISTS (SELECT 1 FROM public.transactions t WHERE t.client_uuid = NEW.client_uuid) THEN
      RETURN NEW;
    END IF;
    NEW.valide_par := NULL;
    NEW.valide_le := NULL;
    NEW.supprime_par := NULL;
    NEW.motif_refus := NULL;

    IF NEW.ordre_id IS NOT NULL THEN
      SELECT * INTO o FROM public.transactions_planifiees WHERE id = NEW.ordre_id FOR UPDATE;
      IF NOT FOUND OR o.espace_id <> NEW.espace_id THEN
        RAISE EXCEPTION 'Ordre introuvable' USING ERRCODE = '23514';
      END IF;
      IF o.statut <> 'en_attente' THEN
        RAISE EXCEPTION 'Cet ordre a déjà été traité' USING ERRCODE = '23514';
      END IF;
      IF NOT (o.assigne_a = v_uid
              OR (o.assigne_a IS NULL AND (o.auteur_id = v_uid OR public.has_espace_role(o.espace_id, ARRAY['admin', 'superviseur'])))
              OR v_is_admin) THEN
        RAISE EXCEPTION 'Vous n''êtes pas l''exécutant de cet ordre' USING ERRCODE = '42501';
      END IF;
      IF NEW.montant <> o.montant_prevu OR NEW.type_operation <> o.type_operation THEN
        RAISE EXCEPTION 'Le montant et le type doivent être ceux de l''ordre' USING ERRCODE = '23514';
      END IF;

      -- Ordre émis par un admin = pré-autorisé : validé au nom de l'émetteur.
      IF EXISTS (SELECT 1 FROM public.user_espaces ue
                  WHERE ue.user_id = o.auteur_id AND ue.espace_id = o.espace_id AND ue.role_dans_espace = 'admin') THEN
        NEW.statut := 'validee';
        NEW.valide_par := o.auteur_id;
        NEW.valide_le := now();
      END IF;

      PERFORM set_config('mtantana.ordre_systeme', 'on', true);
      UPDATE public.transactions_planifiees
         SET statut = 'realisee', realisee_par = v_uid, realisee_le = now(), transaction_client_uuid = NEW.client_uuid
       WHERE id = o.id;
      PERFORM set_config('mtantana.ordre_systeme', 'off', true);
    ELSIF NEW.statut = 'validee' AND v_is_admin THEN
      NEW.valide_par := v_uid;
      NEW.valide_le := now();
    END IF;
    RETURN NEW;
  END IF;

  -- UPDATE
  NEW.ordre_id := OLD.ordre_id;

  -- Montant / type d'une transaction issue d'un ordre modifiés par un non-admin :
  -- elle perd sa pré-autorisation.
  IF OLD.ordre_id IS NOT NULL AND NOT v_is_admin
     AND (NEW.montant <> OLD.montant OR NEW.type_operation <> OLD.type_operation) THEN
    NEW.statut := 'en_attente_validation';
  END IF;

  IF NEW.statut = 'validee' AND OLD.statut <> 'validee' THEN
    NEW.valide_par := v_uid;
    NEW.valide_le := now();
  ELSIF NEW.statut <> 'validee' THEN
    NEW.valide_par := NULL;
    NEW.valide_le := NULL;
  ELSE
    NEW.valide_par := OLD.valide_par;
    NEW.valide_le := OLD.valide_le;
  END IF;

  IF NEW.supprime AND NOT OLD.supprime THEN
    NEW.supprime_par := v_uid;
    NEW.motif_refus := CASE WHEN v_uid <> OLD.auteur_id THEN left(NULLIF(trim(NEW.motif_refus), ''), 500) END;
  ELSIF NOT NEW.supprime THEN
    NEW.supprime_par := NULL;
    NEW.motif_refus := NULL;
  ELSE
    NEW.supprime_par := OLD.supprime_par;
    NEW.motif_refus := OLD.motif_refus;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS transactions_trace ON public.transactions;
CREATE TRIGGER transactions_trace
BEFORE INSERT OR UPDATE ON public.transactions
FOR EACH ROW EXECUTE FUNCTION public.fn_transactions_trace();

CREATE OR REPLACE FUNCTION public.fn_transactions_events()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- L'exécution d'un ordre est annoncée par l'événement « ordre_execute ».
    IF NEW.ordre_id IS NOT NULL THEN
      RETURN NEW;
    END IF;
    PERFORM public.fn_emit_event(NEW.espace_id,
      CASE WHEN NEW.statut = 'en_attente_validation' THEN 'saisie_a_valider' ELSE 'saisie' END,
      NULL, NEW.motif, NEW.montant, NEW.type_operation, 'transactions', NEW.id,
      jsonb_build_object('date', NEW.date_transaction, 'categorie', NEW.categorie, 'client_uuid', NEW.client_uuid), NEW.auteur_id);
    RETURN NEW;
  END IF;

  IF NEW.supprime AND NOT OLD.supprime THEN
    PERFORM public.fn_emit_event(NEW.espace_id,
      CASE WHEN v_uid IS DISTINCT FROM NEW.auteur_id THEN 'transaction_refusee' ELSE 'transaction_supprimee' END,
      NEW.auteur_id, NEW.motif, NEW.montant, NEW.type_operation, 'transactions', NEW.id,
      jsonb_build_object('motif', NEW.motif_refus, 'client_uuid', NEW.client_uuid));
  ELSIF NEW.statut = 'validee' AND OLD.statut <> 'validee' THEN
    PERFORM public.fn_emit_event(NEW.espace_id, 'transaction_validee', NEW.auteur_id, NEW.motif, NEW.montant, NEW.type_operation,
      'transactions', NEW.id, jsonb_build_object('client_uuid', NEW.client_uuid));
  ELSIF NEW.statut = 'en_attente_validation' AND OLD.statut = 'validee' THEN
    PERFORM public.fn_emit_event(NEW.espace_id, 'saisie_a_valider', NULL, NEW.motif, NEW.montant, NEW.type_operation,
      'transactions', NEW.id, jsonb_build_object('client_uuid', NEW.client_uuid, 'ancien_montant', OLD.montant));
  ELSIF (NEW.montant, NEW.type_operation, NEW.date_transaction, NEW.motif, NEW.categorie)
        IS DISTINCT FROM (OLD.montant, OLD.type_operation, OLD.date_transaction, OLD.motif, OLD.categorie) THEN
    PERFORM public.fn_emit_event(NEW.espace_id, 'transaction_modifiee',
      CASE WHEN v_uid IS DISTINCT FROM NEW.auteur_id THEN NEW.auteur_id END,
      NEW.motif, NEW.montant, NEW.type_operation, 'transactions', NEW.id,
      jsonb_build_object('client_uuid', NEW.client_uuid, 'ancien_montant', OLD.montant));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS transactions_events ON public.transactions;
CREATE TRIGGER transactions_events
AFTER INSERT OR UPDATE ON public.transactions
FOR EACH ROW EXECUTE FUNCTION public.fn_transactions_events();

REVOKE ALL ON FUNCTION public.fn_transactions_trace() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fn_transactions_events() FROM PUBLIC, anon, authenticated;

-- ============================================================================
-- 5. MEMBRES : arrivée dans l'espace
-- ============================================================================

CREATE OR REPLACE FUNCTION public.fn_user_espaces_events()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_nom text;
BEGIN
  SELECT p.nom INTO v_nom FROM public.profiles p WHERE p.id = NEW.user_id;
  IF TG_OP = 'INSERT' THEN
    PERFORM public.fn_emit_event(NEW.espace_id, 'membre_ajoute', NEW.user_id, v_nom, NULL, NULL, 'user_espaces', NULL,
      jsonb_build_object('role', NEW.role_dans_espace, 'fonction', NEW.fonction), NEW.user_id);
  ELSIF (NEW.role_dans_espace, NEW.fonction) IS DISTINCT FROM (OLD.role_dans_espace, OLD.fonction) THEN
    PERFORM public.fn_emit_event(NEW.espace_id, 'membre_modifie', NEW.user_id, v_nom, NULL, NULL, 'user_espaces', NULL,
      jsonb_build_object('role', NEW.role_dans_espace, 'fonction', NEW.fonction, 'ancien_role', OLD.role_dans_espace));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS user_espaces_events ON public.user_espaces;
CREATE TRIGGER user_espaces_events
AFTER INSERT OR UPDATE ON public.user_espaces
FOR EACH ROW EXECUTE FUNCTION public.fn_user_espaces_events();

REVOKE ALL ON FUNCTION public.fn_user_espaces_events() FROM PUBLIC, anon, authenticated;


COMMIT;

NOTIFY pgrst, 'reload schema';
