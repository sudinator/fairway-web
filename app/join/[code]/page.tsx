"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase";
import { C } from "@/lib/golf";
import { btn, Wordmark } from "@/components/ui";
import { Shell } from "@/components/auth";

export const dynamic = "force-dynamic";

const supabase = createClient();

type JoinState = "loading" | "login" | "joining" | "success" | "error";

export default function JoinGroupPage({ params }: { params: { code: string } }) {
  const router = useRouter();
  const code = useMemo(() => String(params.code || "").replace(/\D/g, "").slice(0, 6), [params.code]);
  const [state, setState] = useState<JoinState>("loading");
  const [message, setMessage] = useState("Checking your invite…");

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!/^\d{6}$/.test(code)) {
        setState("error");
        setMessage("This invite link is not valid. Ask the group admin for a new invite link.");
        return;
      }

      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        if (!cancelled) {
          setState("login");
          setMessage("Sign in with Google to join this group.");
        }
        return;
      }

      if (cancelled) return;
      setState("joining");
      setMessage("Joining your group…");

      const { data: groupId, error } = await supabase.rpc("redeem_group_invite", { code });
      if (error || !groupId) {
        if (!cancelled) {
          setState("error");
          setMessage(error?.message || "This invite code could not be redeemed. It may be expired or already used.");
        }
        return;
      }

      await supabase.from("profiles").update({ active_group_id: groupId }).eq("id", data.session.user.id);
      if (!cancelled) {
        setState("success");
        setMessage("You joined the group. Opening Birdie Num Num…");
        setTimeout(() => router.push("/"), 1200);
      }
    };
    run();
    return () => { cancelled = true; };
  }, [code, router]);

  const signIn = async () => {
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback?next=/join/${code}` },
    });
  };

  return (
    <Shell>
      <div style={{ maxWidth: 440, margin: "80px auto", padding: 24, textAlign: "center" }}>
        <div style={{ display: "flex", justifyContent: "center" }}><Wordmark width={300} /></div>
        <div style={{ background: C.greenLight, borderRadius: 16, padding: 28, marginTop: 30 }}>
          <div style={{ color: C.gold, fontSize: 11, letterSpacing: 3, fontWeight: 800 }}>GROUP INVITE</div>
          <div style={{ color: C.cream, fontFamily: "Georgia, serif", fontSize: 24, fontWeight: 800, marginTop: 10 }}>
            Invite code {code || "------"}
          </div>
          <div style={{ color: state === "error" ? "#E8A199" : C.sage, fontSize: 14, marginTop: 14, lineHeight: 1.5 }}>
            {message}
          </div>
          {state === "login" && (
            <button onClick={signIn} style={{ ...btn(true), width: "100%", marginTop: 20, padding: "14px" }}>
              Continue with Google
            </button>
          )}
          {state === "success" && (
            <button onClick={() => router.push("/")} style={{ ...btn(true), width: "100%", marginTop: 20 }}>
              Open app now
            </button>
          )}
          {state === "error" && (
            <button onClick={() => router.push("/")} style={{ ...btn(false), width: "100%", marginTop: 20 }}>
              Back to app
            </button>
          )}
        </div>
      </div>
    </Shell>
  );
}
