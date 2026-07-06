import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";

export const Route = createFileRoute("/i/$token/")({
  ssr: false,
  head: () => ({ meta: [{ title: "Research interview — Interview Companion" }] }),
  component: ParticipantIntro,
});

type StudyPublic = {
  id: string; title: string; description: string | null; status: string;
  share_active: boolean; consent_enabled: boolean; consent_text: string;
  collect_identity: boolean; data_use_notice: boolean; allow_withdrawal: boolean;
  persona_name: string; participant_modes: string[]; max_questions: number;
};

function ParticipantIntro() {
  const { token } = Route.useParams();
  const navigate = useNavigate();

  const studyQ = useQuery({
    queryKey: ["public-study", token],
    queryFn: async () => {
      const { data, error } = await supabase.from("studies")
        .select("id, title, description, status, share_active, consent_enabled, consent_text, collect_identity, data_use_notice, allow_withdrawal, persona_name, participant_modes, max_questions")
        .eq("share_token", token).maybeSingle();
      if (error) throw error;
      return data as StudyPublic | null;
    },
  });

  const [consent, setConsent] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [mode, setMode] = useState("text");

  const start = useMutation({
    mutationFn: async () => {
      if (!studyQ.data) throw new Error("Study unavailable");
      const study = studyQ.data;
      if (study.consent_enabled && !consent) throw new Error("Please agree to the consent statement.");
      const { data, error } = await supabase.from("sessions").insert({
        study_id: study.id,
        mode,
        participant_name: study.collect_identity ? name || null : null,
        participant_email: study.collect_identity ? email || null : null,
        consent_given: study.consent_enabled ? consent : true,
        consent_text_snapshot: study.consent_enabled ? study.consent_text : null,
      }).select("id, access_token").single();
      if (error) throw error;
      return { id: data.id as string, token: data.access_token as string };
    },
    onSuccess: ({ id, token }) => {
      navigate({ to: "/i/$token/chat", params: { token }, search: { s: id, t: token } });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not start interview"),
  });

  if (studyQ.isLoading) return <CenteredMessage title="Loading…" />;
  if (!studyQ.data) return <CenteredMessage title="This link is not available" body="The study may be closed or the link may be inactive." />;

  const study = studyQ.data;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border/60">
        <div className="mx-auto max-w-3xl px-6 py-5 text-center">
          <Link to="/" className="font-serif text-lg tracking-tight text-muted-foreground">
            Interview Companion
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-6 py-12">
        <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">Research interview</p>
        <h1 className="mt-3 font-serif text-4xl leading-tight tracking-tight">{study.title}</h1>
        {study.description && (
          <p className="mt-4 text-lg leading-relaxed text-muted-foreground">{study.description}</p>
        )}

        <Card className="mt-8">
          <CardContent className="space-y-6 p-6">
            <div className="rounded-md bg-accent/50 p-4 text-sm">
              <div className="font-medium">What to expect</div>
              <p className="mt-1 text-muted-foreground">
                You'll speak with <span className="font-medium text-foreground">{study.persona_name}</span>,
                an AI interviewer. Up to about {study.max_questions} short questions, one at a time.
                There are no right or wrong answers.
              </p>
            </div>

            {study.data_use_notice && (
              <div className="text-sm text-muted-foreground">
                Your responses are recorded and stored securely for research purposes.
                {study.allow_withdrawal && " You may withdraw at any time from the end screen."}
              </div>
            )}

            {study.collect_identity && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="name">Name (optional)</Label>
                  <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="email">Email (optional)</Label>
                  <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
              </div>
            )}

            {study.participant_modes.length > 1 && (
              <div className="space-y-2">
                <Label>How would you like to answer?</Label>
                <div className="flex flex-wrap gap-2">
                  {study.participant_modes.map((m) => (
                    <button key={m} type="button" onClick={() => setMode(m)}
                      className={`rounded-full border px-4 py-1.5 text-sm capitalize ${mode === m ? "border-primary bg-primary text-primary-foreground" : "border-border"}`}>
                      {m}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  {mode === "text" && "Type your answers in a chat window."}
                  {mode === "audio" && "Record your answers with the mic, or type — you can switch anytime."}
                  {mode === "voice" && "Hands-free conversation: the interviewer speaks and listens for your reply."}
                </p>
              </div>
            )}

            {study.consent_enabled && (
              <div className="space-y-3 rounded-md border border-border p-4">
                <div className="font-medium">Consent</div>
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
                  {study.consent_text}
                </p>
                <label className="flex items-start gap-3">
                  <Checkbox checked={consent} onCheckedChange={(v) => setConsent(v === true)} className="mt-0.5" />
                  <span className="text-sm">I have read and agree to take part in this interview.</span>
                </label>
              </div>
            )}

            <Button className="w-full" size="lg" onClick={() => start.mutate()}
              disabled={start.isPending || (study.consent_enabled && !consent)}>
              {start.isPending ? "Starting…" : "Begin interview"}
            </Button>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

function CenteredMessage({ title, body }: { title: string; body?: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6 text-center">
      <div>
        <h1 className="font-serif text-3xl">{title}</h1>
        {body && <p className="mt-2 text-muted-foreground">{body}</p>}
      </div>
    </div>
  );
}
