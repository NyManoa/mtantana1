/*
# M'tantana — multi-tenant (espaces) + import Excel

## Étape 1 : créer les tables espaces et user_espaces AVANT tout le reste.
*/
CREATE TABLE IF NOT EXISTS public.espaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nom varchar(100) NOT NULL,
  cree_par uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  cree_le timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.user_espaces (
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  espace_id uuid NOT NULL REFERENCES public.espaces(id) ON DELETE CASCADE,
  role_dans_espace varchar(20) NOT NULL DEFAULT 'operateur' CHECK (role_dans_espace IN ('operateur','admin','superviseur')),
  PRIMARY KEY (user_id, espace_id)
);

ALTER TABLE public.espaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_espaces ENABLE ROW LEVEL SECURITY;

-- Backfill : créer l'espace par défaut
DO $$
DECLARE
  v_espace_id uuid;
  v_user record;
BEGIN
  SELECT id INTO v_espace_id FROM public.espaces WHERE nom = 'Principal' LIMIT 1;
  IF v_espace_id IS NULL THEN
    INSERT INTO public.espaces (nom, cree_par)
    SELECT 'Principal', id FROM public.profiles WHERE role = 'admin' ORDER BY cree_le LIMIT 1
    RETURNING id INTO v_espace_id;
  END IF;

  FOR v_user IN SELECT id, role FROM public.profiles LOOP
    INSERT INTO public.user_espaces (user_id, espace_id, role_dans_espace)
    VALUES (v_user.id, v_espace_id, v_user.role)
    ON CONFLICT DO NOTHING;
  END LOOP;
END $$;

-- RLS espaces
DROP POLICY IF EXISTS "select_espaces" ON public.espaces;
CREATE POLICY "select_espaces" ON public.espaces FOR SELECT
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_espaces ue WHERE ue.user_id = auth.uid() AND ue.espace_id = espaces.id));

DROP POLICY IF EXISTS "insert_espaces" ON public.espaces;
CREATE POLICY "insert_espaces" ON public.espaces FOR INSERT
  TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));

DROP POLICY IF EXISTS "delete_espaces" ON public.espaces;
CREATE POLICY "delete_espaces" ON public.espaces FOR DELETE
  TO authenticated
  USING (cree_par = auth.uid());

-- RLS user_espaces
DROP POLICY IF EXISTS "select_user_espaces" ON public.user_espaces;
CREATE POLICY "select_user_espaces" ON public.user_espaces FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.user_espaces ue2 WHERE ue2.user_id = auth.uid() AND ue2.espace_id = user_espaces.espace_id AND ue2.role_dans_espace = 'admin')
  );

DROP POLICY IF EXISTS "insert_user_espaces" ON public.user_espaces;
CREATE POLICY "insert_user_espaces" ON public.user_espaces FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.user_espaces ue2 WHERE ue2.user_id = auth.uid() AND ue2.espace_id = user_espaces.espace_id AND ue2.role_dans_espace = 'admin')
  );

DROP POLICY IF EXISTS "delete_user_espaces" ON public.user_espaces;
CREATE POLICY "delete_user_espaces" ON public.user_espaces FOR DELETE
  TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.user_espaces ue2 WHERE ue2.user_id = auth.uid() AND ue2.espace_id = user_espaces.espace_id AND ue2.role_dans_espace = 'admin')
  );
