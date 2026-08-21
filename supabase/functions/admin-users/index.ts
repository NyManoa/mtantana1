import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") as string;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") as string;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") as string;

    if (!supabaseUrl || !serviceRoleKey || !anonKey) {
      return new Response(JSON.stringify({ error: "Configuration serveur manquante" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace("Bearer ", "");

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) {
      return new Response(JSON.stringify({ error: "Non authentifié" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const { data: callerProfile } = await adminClient
      .from("profiles")
      .select("role")
      .eq("id", userData.user.id)
      .maybeSingle();

    if (!callerProfile) {
      return new Response(JSON.stringify({ error: "Profil introuvable" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const callerRole = callerProfile.role as string;
    const isAdmin = callerRole === "admin";

    if (req.method === "GET") {
      if (!isAdmin) {
        return new Response(JSON.stringify({ error: "Accès refusé — admin uniquement" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      // Each admin only sees users who share at least one of their espaces.
      const { data: callerEspaces } = await adminClient
        .from("user_espaces")
        .select("espace_id")
        .eq("user_id", userData.user.id);

      const espaceIds = callerEspaces?.map((r: { espace_id: string }) => r.espace_id) ?? [];
      if (espaceIds.length === 0) {
        return new Response(JSON.stringify({ users: [] }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: sharedUserIds } = await adminClient
        .from("user_espaces")
        .select("user_id")
        .in("espace_id", espaceIds);

      const userIds = [...new Set(sharedUserIds?.map((r: { user_id: string }) => r.user_id) ?? [])];

      const { data: profiles, error: pErr } = await adminClient
        .from("profiles")
        .select("id, nom, email, role, langue, actif, cree_le, user_espaces(espace_id, role_dans_espace, espaces(id, nom))")
        .in("id", userIds)
        .order("cree_le", { ascending: false });

      if (pErr) throw pErr;
      return new Response(JSON.stringify({ users: profiles ?? [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (req.method === "POST") {
      if (!isAdmin) {
        return new Response(JSON.stringify({ error: "Accès refusé — admin uniquement" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const body = await req.json();
      const { email, password, nom, role, langue, espace_ids } = body as {
        email: string;
        password: string;
        nom: string;
        role: "operateur" | "admin" | "superviseur";
        langue: "fr" | "mg";
        espace_ids?: string[];
      };

      if (!email || !password || !nom) {
        return new Response(JSON.stringify({ error: "Champs manquants" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Determine which espaces the caller is admin of
      const { data: callerAdminEspaces } = await adminClient
        .from("user_espaces")
        .select("espace_id")
        .eq("user_id", userData.user.id)
        .eq("role_dans_espace", "admin");
      const callerEspaceIds = callerAdminEspaces?.map((r: { espace_id: string }) => r.espace_id) ?? [];

      // Filter requested espace_ids to only those the caller is admin of
      const targetEspaces = (espace_ids ?? []).filter((id) => callerEspaceIds.includes(id));

      if (targetEspaces.length === 0) {
        return new Response(JSON.stringify({ error: "Sélectionnez au moins un espace" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: created, error: createErr } = await adminClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { nom, role, langue },
      });

      if (createErr) throw createErr;
      const newUserId = created.user?.id as string;

      const { error: profileErr } = await adminClient.from("profiles").upsert({
        id: newUserId,
        nom,
        email,
        role: role || "operateur",
        langue: langue || "fr",
        actif: true,
      });
      if (profileErr) throw profileErr;

      // Assign to the selected espaces only
      for (const esId of targetEspaces) {
        await adminClient.from("user_espaces").upsert({
          user_id: newUserId,
          espace_id: esId,
          role_dans_espace: role || "operateur",
        }, { onConflict: "user_id,espace_id" });
      }

      return new Response(JSON.stringify({ id: newUserId, email, nom }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (req.method === "PUT") {
      if (!isAdmin) {
        return new Response(JSON.stringify({ error: "Accès refusé — admin uniquement" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const body = await req.json();
      const { user_id, role, actif, langue, nom, espace_ids, action: bodyAction } = body as {
        user_id: string;
        role?: "operateur" | "admin" | "superviseur";
        actif?: boolean;
        langue?: "fr" | "mg";
        nom?: string;
        espace_ids?: string[];
        action?: string;
      };

      if (!user_id) {
        return new Response(JSON.stringify({ error: "user_id manquant" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Handle espace assignment actions
      if (bodyAction === "assign_espace" && espace_ids && espace_ids.length > 0) {
        for (const esId of espace_ids) {
          await adminClient.from("user_espaces").upsert({
            user_id,
            espace_id: esId,
            role_dans_espace: role || "operateur",
          }, { onConflict: "user_id,espace_id" });
        }
        return new Response(JSON.stringify({ ok: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (bodyAction === "remove_espace" && espace_ids && espace_ids.length > 0) {
        for (const esId of espace_ids) {
          await adminClient.from("user_espaces")
            .delete().eq("user_id", user_id).eq("espace_id", esId);
        }
        if (ueErr) throw ueErr;
        return new Response(JSON.stringify({ ok: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const updates: Record<string, unknown> = {};
      if (role !== undefined) updates.role = role;
      if (actif !== undefined) updates.actif = actif;
      if (langue !== undefined) updates.langue = langue;
      if (nom !== undefined) updates.nom = nom;

      const { error: updErr } = await adminClient
        .from("profiles")
        .update(updates)
        .eq("id", user_id);
      if (updErr) throw updErr;

      if (actif === false) {
        await adminClient.auth.admin.updateUserById(user_id, { ban_duration: "876000h" });
      } else if (actif === true) {
        await adminClient.auth.admin.updateUserById(user_id, { ban_duration: "none" });
      }

      // Sync espace assignments if provided
      if (espace_ids !== undefined) {
        const { data: callerAdminEspaces } = await adminClient
          .from("user_espaces")
          .select("espace_id")
          .eq("user_id", userData.user.id)
          .eq("role_dans_espace", "admin");
        const callerEspaceIds = callerAdminEspaces?.map((r: { espace_id: string }) => r.espace_id) ?? [];
        const validEspaceIds = espace_ids.filter((id) => callerEspaceIds.includes(id));

        // Remove from espaces the caller controls but are no longer selected
        const { data: existingUE } = await adminClient
          .from("user_espaces")
          .select("espace_id")
          .eq("user_id", user_id)
          .in("espace_id", callerEspaceIds);
        const existingIds = existingUE?.map((r: { espace_id: string }) => r.espace_id) ?? [];
        const toRemove = existingIds.filter((id) => !validEspaceIds.includes(id));
        for (const esId of toRemove) {
          await adminClient.from("user_espaces").delete().eq("user_id", user_id).eq("espace_id", esId);
        }
        // Add new ones
        for (const esId of validEspaceIds) {
          await adminClient.from("user_espaces").upsert({
            user_id,
            espace_id: esId,
            role_dans_espace: role || "operateur",
          }, { onConflict: "user_id,espace_id" });
        }
      }

      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (req.method === "DELETE") {
      if (!isAdmin) {
        return new Response(JSON.stringify({ error: "Accès refusé — admin uniquement" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const url = new URL(req.url);
      const user_id = url.searchParams.get("user_id");
      if (!user_id) {
        return new Response(JSON.stringify({ error: "user_id manquant" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (user_id === userData.user.id) {
        return new Response(JSON.stringify({ error: "Impossible de supprimer votre propre compte" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Delete user_espaces entries, profile, and auth user
      await adminClient.from("user_espaces").delete().eq("user_id", user_id);
      await adminClient.from("transactions").delete().eq("auteur_id", user_id);
      await adminClient.from("transactions_recurrentes").delete().eq("auteur_id", user_id);
      await adminClient.from("transactions_planifiees").delete().eq("auteur_id", user_id);
      await adminClient.from("profiles").delete().eq("id", user_id);
      const { error: delErr } = await adminClient.auth.admin.deleteUser(user_id);
      if (delErr) throw delErr;

      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Méthode non supportée" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erreur serveur";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
