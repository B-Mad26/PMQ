import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const metadata = {
  title: "Verify credential — PM Sim Lab",
  robots: { index: false },
};

async function lookup(id) {
  if (!supabaseAdmin || !UUID_RE.test(id)) return { state: "invalid" };
  try {
    const { data, error } = await supabaseAdmin
      .from("certificates")
      .select("id,recipient,score,issued_at")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    return data ? { state: "valid", cert: data } : { state: "notfound" };
  } catch {
    return { state: "error" };
  }
}

function fmtDate(iso) {
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } catch {
    return "—";
  }
}

export default async function VerifyPage({ params }) {
  const { id } = await params;
  const { state, cert } = await lookup(id);

  return (
    <div className="min-h-screen flex flex-col items-center px-6 py-16">
      <div className="flex items-center gap-2.5 mb-10">
        <span className="grid place-items-center w-9 h-9 rounded-xl btn-primary text-base">◆</span>
        <span className="font-semibold text-[17px] tracking-tight">PM <span className="gradtext">Sim Lab</span></span>
      </div>

      {state === "valid" ? (
        <div className="card ring-soft p-10 max-w-lg w-full text-center">
          <div className="w-16 h-16 mx-auto rounded-full grid place-items-center text-2xl" style={{ background: "rgba(74,222,128,.15)", color: "#4ade80" }}>✓</div>
          <div className="mt-4 text-[11px] uppercase tracking-[.3em] text-good">Verified credential</div>
          <h1 className="display text-3xl mt-3">Certified PM Sim Lab Practitioner</h1>
          <p className="text-mute mt-5 text-[14px]">This certifies that</p>
          <div className="display text-3xl goldtext mt-1">{cert.recipient}</div>
          <p className="text-mute mt-4 text-[14px] max-w-sm mx-auto leading-relaxed">
            completed the PM Sim Lab program — situational scenarios, chart competencies, and a timed certification exam.
          </p>
          <div className="mt-8 flex items-center justify-center gap-8 text-[12px]">
            <div><div className="text-mute2">Exam score</div><div className="text-white font-semibold text-[15px]">{cert.score ?? "—"}%</div></div>
            <div><div className="text-mute2">Issued</div><div className="text-white font-semibold text-[15px]">{fmtDate(cert.issued_at)}</div></div>
          </div>
          <div className="divider my-7" />
          <div className="text-[11px] text-mute2">Credential ID</div>
          <div className="font-mono text-[12px] text-mute mt-1 break-all">{cert.id}</div>
        </div>
      ) : (
        <div className="card ring-soft p-10 max-w-lg w-full text-center">
          <div className="w-16 h-16 mx-auto rounded-full grid place-items-center text-2xl" style={{ background: "rgba(251,113,133,.12)", color: "#fb7185" }}>✕</div>
          <h1 className="display text-2xl mt-5">
            {state === "error" ? "Verification unavailable" : "Credential not found"}
          </h1>
          <p className="text-mute mt-3 text-[14px] max-w-sm mx-auto leading-relaxed">
            {state === "error"
              ? "We couldn't reach the credential registry. Please try again shortly."
              : "No PM Sim Lab certificate matches this ID. Check the link and try again."}
          </p>
          <a href="/" className="btn-ghost inline-block mt-7 px-6 py-3 rounded-2xl text-[14px] font-medium">Go to PM Sim Lab →</a>
        </div>
      )}

      <p className="text-mute2 text-[12px] mt-8">Issued by PM Sim Lab · verify any credential at /verify/&lt;id&gt;</p>
    </div>
  );
}
