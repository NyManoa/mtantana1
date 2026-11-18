// Edge function : gestion des membres d'un espace.
//
// Toutes les actions sont limitées aux espaces dont l'appelant est ADMIN
// (user_espaces.role_dans_espace = 'admin'). Le rôle global du profil n'est
// jamais utilisé pour autoriser une action.
//
//   GET    ?espace_id=…                       → membres + invitations en attente
//   POST   { email, role, espace_id }
//            → compte existant : ajouté tout de suite à l'espace
//            → sinon : invitation en attente, acceptée automatiquement quand la
//              personne se connecte avec cette adresse (Google ou e-mail confirmé)
//   PUT    { user_id, espace_id, role?, nom?, langue?, actif? }
//   DELETE ?user_id=…&espace_id=…             → retire le membre de l'espace
//   DELETE ?invitation_id=…&espace_id=…       → annule une invitation
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.57.4";
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

type Role = "operateur" | "superviseur" | "admin";
const ROLES: Role[] = ["operateur", "superviseur", "admin"];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function corsHeaders(req: Request): Record<string, string> {
  const allowed = (Deno.env.get("ALLOWED_ORIGINS") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const origin = req.headers.get("Origin") ?? "";
  const allowOrigin = allowed.length === 0 ? "*" : allowed.includes(origin) ? origin : allowed[0];
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
    Vary: "Origin",
  };
}

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

async function assertEspaceAdmin(admin: SupabaseClient, callerId: string, espaceId: unknown) {
  if (!isUuid(espaceId)) throw new HttpError(400, "espace_id invalide");
  const { data } = await admin
    .from("user_espaces")
    .select("role_dans_espace")
    .eq("user_id", callerId)
    .eq("espace_id", espaceId)
    .maybeSingle();
  if (data?.role_dans_espace !== "admin") {
    throw new HttpError(403, "Accès refusé : vous n'êtes pas administrateur de cet espace");
  }
  return espaceId;
}

async function countAdmins(admin: SupabaseClient, espaceId: string) {
  const { count } = await admin
    .from("user_espaces")
    .select("user_id", { count: "exact", head: true })
    .eq("espace_id", espaceId)
    .eq("role_dans_espace", "admin");
  return count ?? 0;
}

Deno.serve(async (req: Request) => {
  const headers = { ...corsHeaders(req), "Content-Type": "application/json" };
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceRoleKey) throw new HttpError(500, "Configuration serveur manquante");

    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!token) throw new HttpError(401, "Non authentifié");

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userData.user) throw new HttpError(401, "Session invalide");
    const callerId = userData.user.id;

    const { data: callerProfile } = await admin.from("profiles").select("actif").eq("id", callerId).maybeSingle();
    if (!callerProfile || callerProfile.actif === false) throw new HttpError(403, "Compte désactivé");

    const url = new URL(req.url);

    // ------------------------------------------------------------------ GET
    if (req.method === "GET") {
      const espaceId = await assertEspaceAdmin(admin, callerId, url.searchParams.get("espace_id"));
      const { data: members, error } = await admin
        .from("user_espaces")
        .select("role_dans_espace, profiles(id, nom, email, langue, actif, cree_le)")
        .eq("espace_id", espaceId);
      if (error) throw error;
      const users = (members ?? [])
        .filter((m) => m.profiles)
        .map((m) => {
          const p = m.profiles as unknown as Record<string, unknown>;
          return { ...p, role: m.role_dans_espace };
        })
        .sort((a, b) => String(b.cree_le).localeCompare(String(a.cree_le)));
      const { data: invitations, error: invErr } = await admin
        .from("invitations_espace")
        .select("id, email, role_dans_espace, cree_le")
        .eq("espace_id", espaceId)
        .order("cree_le", { ascending: false });
      if (invErr) throw invErr;
      return json({
        users,
        invitations: (invitations ?? []).map((i) => ({ id: i.id, email: i.email, role: i.role_dans_espace, cree_le: i.cree_le })),
      });
    }

    const body = req.method === "DELETE" ? {} : await req.json().catch(() => ({}));

    // ----------------------------------------------------------------- POST
    if (req.method === "POST") {
      const espaceId = await assertEspaceAdmin(admin, callerId, body.espace_id);
      const email = String(body.email ?? "").trim().toLowerCase();
      const role: Role = ROLES.includes(body.role) ? body.role : "operateur";
      if (!EMAIL_RE.test(email) || email.length > 254) throw new HttpError(400, "Adresse e-mail invalide");

      // Compte déjà existant → ajouté tout de suite à l'espace.
      const { data: existing } = await admin.from("profiles").select("id, nom").eq("email", email).maybeSingle();
      if (existing?.id) {
        const { data: already } = await admin
          .from("user_espaces")
          .select("role_dans_espace")
          .eq("user_id", existing.id)
          .eq("espace_id", espaceId)
          .maybeSingle();
        if (already) throw new HttpError(409, "Cette personne est déjà membre de l'espace");
        const { error: ueErr } = await admin
          .from("user_espaces")
          .insert({ user_id: existing.id, espace_id: espaceId, role_dans_espace: role });
        if (ueErr) throw ueErr;
        return json({ status: "added", email, nom: existing.nom });
      }

      // Sinon → invitation en attente (une seule par adresse et par espace).
      const { count } = await admin
        .from("invitations_espace")
        .select("id", { count: "exact", head: true })
        .eq("espace_id", espaceId);
      if ((count ?? 0) >= 200) throw new HttpError(400, "Trop d'invitations en attente pour cet espace");
      const { error: invErr } = await admin
        .from("invitations_espace")
        .upsert({ espace_id: espaceId, email, role_dans_espace: role, invite_par: callerId }, { onConflict: "espace_id,email" });
      if (invErr) throw invErr;
      return json({ status: "invited", email });
    }

    // ------------------------------------------------------------------ PUT
    if (req.method === "PUT") {
      const espaceId = await assertEspaceAdmin(admin, callerId, body.espace_id);
      const userId = body.user_id;
      if (!isUuid(userId)) throw new HttpError(400, "user_id invalide");

      const { data: membership } = await admin
        .from("user_espaces")
        .select("role_dans_espace")
        .eq("user_id", userId)
        .eq("espace_id", espaceId)
        .maybeSingle();
      if (!membership) throw new HttpError(404, "Ce membre n'appartient pas à l'espace");

      if (body.role !== undefined) {
        if (!ROLES.includes(body.role)) throw new HttpError(400, "Rôle invalide");
        if (userId === callerId && body.role !== "admin") {
          throw new HttpError(400, "Vous ne pouvez pas retirer vos propres droits d'administrateur");
        }
        if (membership.role_dans_espace === "admin" && body.role !== "admin" && (await countAdmins(admin, espaceId)) <= 1) {
          throw new HttpError(400, "L'espace doit garder au moins un administrateur");
        }
        const { error } = await admin
          .from("user_espaces")
          .update({ role_dans_espace: body.role })
          .eq("user_id", userId)
          .eq("espace_id", espaceId);
        if (error) throw error;
      }

      const profileUpdates: Record<string, unknown> = {};
      if (typeof body.nom === "string" && body.nom.trim()) profileUpdates.nom = body.nom.trim().slice(0, 100);
      if (body.langue === "fr" || body.langue === "mg") profileUpdates.langue = body.langue;

      if (typeof body.actif === "boolean") {
        if (userId === callerId) throw new HttpError(400, "Vous ne pouvez pas désactiver votre propre compte");
        // La désactivation agit sur TOUS les espaces du membre : on ne l'autorise
        // que si l'appelant administre chacun de ces espaces.
        const { data: targetSpaces } = await admin.from("user_espaces").select("espace_id").eq("user_id", userId);
        const { data: callerAdminSpaces } = await admin
          .from("user_espaces")
          .select("espace_id")
          .eq("user_id", callerId)
          .eq("role_dans_espace", "admin");
        const adminSet = new Set((callerAdminSpaces ?? []).map((r) => r.espace_id));
        const controlsAll = (targetSpaces ?? []).every((r) => adminSet.has(r.espace_id));
        if (!controlsAll) {
          throw new HttpError(403, "Ce compte appartient aussi à d'autres espaces : retirez-le de votre espace à la place");
        }
        profileUpdates.actif = body.actif;
        const { error: banErr } = await admin.auth.admin.updateUserById(userId, {
          ban_duration: body.actif ? "none" : "876000h",
        });
        if (banErr) throw banErr;
      }

      if (Object.keys(profileUpdates).length > 0) {
        const { error } = await admin.from("profiles").update(profileUpdates).eq("id", userId);
        if (error) throw error;
      }
      return json({ ok: true });
    }

    // --------------------------------------------------------------- DELETE
    if (req.method === "DELETE") {
      const espaceId = await assertEspaceAdmin(admin, callerId, url.searchParams.get("espace_id"));

      const invitationId = url.searchParams.get("invitation_id");
      if (invitationId !== null) {
        if (!isUuid(invitationId)) throw new HttpError(400, "invitation_id invalide");
        const { error } = await admin.from("invitations_espace").delete().eq("id", invitationId).eq("espace_id", espaceId);
        if (error) throw error;
        return json({ ok: true });
      }

      const userId = url.searchParams.get("user_id");
      if (!isUuid(userId)) throw new HttpError(400, "user_id invalide");
      if (userId === callerId) throw new HttpError(400, "Vous ne pouvez pas vous retirer vous-même");

      const { data: membership } = await admin
        .from("user_espaces")
        .select("role_dans_espace")
        .eq("user_id", userId)
        .eq("espace_id", espaceId)
        .maybeSingle();
      if (!membership) throw new HttpError(404, "Ce membre n'appartient pas à l'espace");
      if (membership.role_dans_espace === "admin" && (await countAdmins(admin, espaceId)) <= 1) {
        throw new HttpError(400, "L'espace doit garder au moins un administrateur");
      }

      // On retire seulement l'accès : les transactions saisies restent dans
      // l'espace (traçabilité comptable).
      const { error } = await admin.from("user_espaces").delete().eq("user_id", userId).eq("espace_id", espaceId);
      if (error) throw error;
      return json({ ok: true });
    }

    throw new HttpError(405, "Méthode non supportée");
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status);
    console.error("[admin-users]", err);
    return json({ error: "Erreur serveur" }, 500);
  }
});
