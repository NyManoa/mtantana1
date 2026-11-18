/*
# Invitations par e-mail, superviseur en lecture seule, anti-pause

1. Invitations (`invitations_espace`)
   - Un admin d'espace invite une adresse e-mail avec un rôle (via l'edge
     function `admin-users`, jamais directement depuis le client).
   - Dès que la personne se connecte avec cette adresse (Google, ou compte
     e-mail CONFIRMÉ), `accept_pending_invitations()` l'ajoute à l'espace.
   - Lecture réservée aux admins de l'espace ; aucune écriture côté client.

2. Superviseur = « saisie + consultation »
   - Peut déjà saisir et voir toutes les transactions, budgets, tableau de bord.
   - Ajout : lecture des alertes (la modification reste réservée aux admins).

3. Anti-pause
   - `keepalive()` : appelée par une tâche planifiée (GitHub Actions) pour
     générer une activité réelle en base et éviter la mise en pause du projet
     gratuit. N'expose aucune donnée.

Idempotent : peut être rejouée sans erreur.
*/

-- ============================================================================
-- 1. INVITATIONS
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.invitations_espace (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  espace_id uuid NOT NULL REFERENCES public.espaces(id) ON DELETE CASCADE,
  email text NOT NULL CHECK (email = lower(email) AND length(email) BETWEEN 3 AND 254),
  role_dans_espace varchar(20) NOT NULL DEFAULT 'operateur'
    CHECK (role_dans_espace IN ('operateur', 'superviseur', 'admin')),
  invite_par uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  cree_le timestamptz NOT NULL DEFAULT now(),
  UNIQUE (espace_id, email)
);

CREATE INDEX IF NOT EXISTS idx_invitations_email ON public.invitations_espace (email);

ALTER TABLE public.invitations_espace ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.invitations_espace FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.invitations_espace TO authenticated;

DROP POLICY IF EXISTS "select_invitations" ON public.invitations_espace;
CREATE POLICY "select_invitations" ON public.invitations_espace FOR SELECT
  TO authenticated
  USING (public.has_espace_role(espace_id, ARRAY['admin']));

-- Appelée par l'application après chaque connexion / synchronisation.
-- N'accepte que les invitations adressées à l'e-mail VÉRIFIÉ de l'appelant :
-- impossible de « réclamer » l'invitation d'un autre en s'inscrivant avec son
-- adresse sans y avoir accès.
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

  SELECT lower(u.email), u.email_confirmed_at
    INTO v_email, v_confirmed
    FROM auth.users u
   WHERE u.id = v_uid;

  IF v_email IS NULL OR v_confirmed IS NULL THEN
    RETURN 0;
  END IF;

  IF EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = v_uid AND p.actif = false) THEN
    RETURN 0;
  END IF;

  WITH inv AS (
    DELETE FROM public.invitations_espace i
     WHERE i.email = v_email
     RETURNING i.espace_id, i.role_dans_espace
  ), ins AS (
    INSERT INTO public.user_espaces (user_id, espace_id, role_dans_espace)
    SELECT v_uid, inv.espace_id, inv.role_dans_espace FROM inv
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
-- 2. SUPERVISEUR : alertes en lecture seule
-- ============================================================================

DROP POLICY IF EXISTS "select_alertes" ON public.alertes;
CREATE POLICY "select_alertes" ON public.alertes FOR SELECT
  TO authenticated
  USING (public.has_espace_role(espace_id, ARRAY['admin', 'superviseur']));

-- ============================================================================
-- 3. ANTI-PAUSE
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.app_keepalive (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  derniere_activite timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.app_keepalive ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.app_keepalive FROM PUBLIC, anon, authenticated;
INSERT INTO public.app_keepalive (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.keepalive()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Une écriture au plus par minute, même si l'URL est appelée en boucle.
  UPDATE public.app_keepalive
     SET derniere_activite = now()
   WHERE id = 1 AND derniere_activite < now() - interval '1 minute';
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.keepalive() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.keepalive() TO anon, authenticated;
