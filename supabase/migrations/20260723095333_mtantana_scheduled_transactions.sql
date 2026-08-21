/*
# Transactions planifiées avec alerte

## Résumé
Ajoute une table `transactions_planifiees` pour programmer une transaction à une
date donnée. Une notification s'affiche le jour-J ou la veille (selon un délai
configurable en jours) pour rappeler à l'utilisateur de saisir la transaction.

## 1. Nouvelle table
- `transactions_planifiees`
  - `id` (uuid, PK)
  - `titre` (varchar) — libellé de la transaction prévue
  - `motif` (varchar) — motif libre
  - `categorie` (varchar, défaut 'autre')
  - `type_operation` (varchar, CHECK miditra/mivoaka)
  - `montant_prevu` (numeric)
  - `date_prevue` (date) — date à laquelle la transaction doit être saisie
  - `delai_alerte_jours` (int, défaut 1) — nombre de jours avant la date préue
    pour déclencher l'alerte (0 = le jour même, 1 = la veille, etc.)
  - `auteur_id` (uuid, FK profiles)
  - `statut` (varchar, CHECK dans {en_attente, realisee, annulee}, défaut en_attente)
  - `cree_le` (timestamptz)

## 2. Sécurité (RLS)
- SELECT : propriétaire ou admin/superviseur
- INSERT : propriétaire
- UPDATE : propriétaire ou admin
- DELETE : propriétaire ou admin
*/
CREATE TABLE IF NOT EXISTS public.transactions_planifiees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  titre varchar(255) NOT NULL,
  motif varchar(255) NOT NULL DEFAULT '',
  categorie varchar(40) NOT NULL DEFAULT 'autre',
  type_operation varchar(10) NOT NULL CHECK (type_operation IN ('miditra','mivoaka')),
  montant_prevu numeric(14,2) NOT NULL CHECK (montant_prevu >= 0),
  date_prevue date NOT NULL,
  delai_alerte_jours int NOT NULL DEFAULT 1,
  auteur_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  statut varchar(20) NOT NULL DEFAULT 'en_attente' CHECK (statut IN ('en_attente','realisee','annulee')),
  cree_le timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_planifiees_date ON public.transactions_planifiees(date_prevue);

ALTER TABLE public.transactions_planifiees ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_planifiees" ON public.transactions_planifiees;
CREATE POLICY "select_planifiees" ON public.transactions_planifiees FOR SELECT
  TO authenticated
  USING (
    auteur_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role IN ('admin','superviseur'))
  );

DROP POLICY IF EXISTS "insert_planifiees" ON public.transactions_planifiees;
CREATE POLICY "insert_planifiees" ON public.transactions_planifiees FOR INSERT
  TO authenticated WITH CHECK (auteur_id = auth.uid());

DROP POLICY IF EXISTS "update_planifiees" ON public.transactions_planifiees;
CREATE POLICY "update_planifiees" ON public.transactions_planifiees FOR UPDATE
  TO authenticated
  USING (auteur_id = auth.uid() OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'))
  WITH CHECK (auteur_id = auth.uid() OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));

DROP POLICY IF EXISTS "delete_planifiees" ON public.transactions_planifiees;
CREATE POLICY "delete_planifiees" ON public.transactions_planifiees FOR DELETE
  TO authenticated
  USING (auteur_id = auth.uid() OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));
