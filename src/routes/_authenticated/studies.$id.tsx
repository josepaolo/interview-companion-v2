import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import { QRCodeSVG } from "qrcode.react";
import {
  ArrowLeft, Copy, Trash2, ExternalLink, Save, Users as UsersIcon,
  Radio, Check, RefreshCcw, Upload,
} from "lucide-react";
import { useRef } from "react";

export const Route = createFileRoute("/_authenticated/studies/$id")({
  component: StudyBuilder,
});

const PERSONAS = [
  { name: "Warm empathetic clinician", tone: "warm empathetic clinician", background: "You are a caring clinical researcher. You listen carefully, validate feelings, and gently probe for depth without leading." },
  { name: "Neutral academic researcher", tone: "neutral academic researcher", background: "You are a rigorous academic interviewer. You keep a professional distance, ask open questions, and avoid steering answers." },
  { name: "Curious peer", tone: "curious peer", background: "You are a friendly peer researcher, conversational and genuinely curious. You use plain language and follow the participant's lead." },
  { name: "Concise journalist", tone: "concise journalist", background: "You are a focused journalist. You ask sharp, concrete follow-ups and keep the interview moving." },
  { name: "Custom", tone: "", background: "" },
];

export type SurveyItem = {
  id: string;
  kind: "survey" | "probe";
  prompt: string;
  question_type?: "open" | "single" | "multi" | "scale" | "boolean";
  options?: string[];
  scale_min?: number; scale_max?: number;
  scale_min_label?: string; scale_max_label?: string;
};

type Study = {
  id: string; title: string; description: string; research_questions: string;
  interview_guide: string; structure_type: string; persona_name: string;
  persona_tone: string; persona_background: string; participant_modes: string[];
  consent_enabled: boolean; consent_text: string; collect_identity: boolean;
  data_use_notice: boolean; allow_withdrawal: boolean; max_questions: number;
  max_duration_minutes: number; target_sample_size: number; share_token: string;
  share_active: boolean; status: string; survey_items: SurveyItem[];
};

function StudyBuilder() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const studyQ = useQuery({
    queryKey: ["study", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("studies").select("*").eq("id", id).single();
      if (error) throw error;
      const raw = data as unknown as Record<string, unknown>;
      return {
        ...(raw as unknown as Study),
        survey_items: Array.isArray(raw.survey_items) ? (raw.survey_items as SurveyItem[]) : [],
      } as Study;
    },
  });

  const [form, setForm] = useState<Study | null>(null);
  useEffect(() => { if (studyQ.data) setForm(studyQ.data); }, [studyQ.data]);

  const save = useMutation({
    mutationFn: async (patch: Partial<Study>) => {
      const { error } = await supabase.from("studies").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["study", id] });
      qc.invalidateQueries({ queryKey: ["studies"] });
      toast.success("Saved");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Save failed"),
  });

  const del = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("studies").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Study deleted"); navigate({ to: "/dashboard" }); },
  });

  if (!form) return <main className="mx-auto max-w-5xl px-6 py-10 text-muted-foreground">Loading…</main>;

  const patch = <K extends keyof Study>(k: K, v: Study[K]) => setForm({ ...form, [k]: v });
  const toggleMode = (m: string) => {
    const has = form.participant_modes.includes(m);
    patch("participant_modes", has ? form.participant_modes.filter((x) => x !== m) : [...form.participant_modes, m]);
  };

  const participantUrl = typeof window !== "undefined"
    ? `${window.location.origin}/i/${form.share_token}` : `/i/${form.share_token}`;

  const setStatus = (status: string) => save.mutate({ status });
  const regenToken = async () => {
    const token = Array.from(crypto.getRandomValues(new Uint8Array(12))).map((b) => b.toString(16).padStart(2, "0")).join("");
    await save.mutateAsync({ share_token: token });
  };

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <div className="mb-6 flex items-center justify-between">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/dashboard"><ArrowLeft className="mr-1 h-4 w-4" /> Dashboard</Link>
        </Button>
        <div className="flex items-center gap-2">
          <Badge variant={form.status === "live" ? "default" : "outline"}>{form.status}</Badge>
          <Button variant="outline" size="sm" asChild>
            <Link to="/studies/$id/responses" params={{ id }}>
              <UsersIcon className="mr-2 h-4 w-4" /> Responses
            </Link>
          </Button>
        </div>
      </div>

      <div className="mb-8">
        <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">Study builder</p>
        <input
          className="mt-2 w-full bg-transparent font-serif text-4xl tracking-tight outline-none focus:ring-0"
          value={form.title}
          onChange={(e) => patch("title", e.target.value)}
          placeholder="Untitled study"
        />
      </div>

      <Tabs defaultValue="design" className="space-y-6">
        <TabsList>
          <TabsTrigger value="design">Design</TabsTrigger>
          <TabsTrigger value="persona">Persona</TabsTrigger>
          <TabsTrigger value="consent">Consent &amp; ethics</TabsTrigger>
          <TabsTrigger value="share">Share &amp; publish</TabsTrigger>
        </TabsList>

        {/* DESIGN */}
        <TabsContent value="design" className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="font-serif">Overview</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label>Description</Label>
                <Textarea value={form.description} onChange={(e) => patch("description", e.target.value)}
                  placeholder="A short description of what this study is about." rows={3} />
              </div>
              <div className="space-y-1.5">
                <Label>Research questions</Label>
                <Textarea value={form.research_questions} onChange={(e) => patch("research_questions", e.target.value)}
                  placeholder="What are the underlying research questions? One per line." rows={4} />
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <Label>Interview guide</Label>
                  <GuideUpload
                    onLoaded={(text, append) =>
                      patch("interview_guide", append && form.interview_guide ? `${form.interview_guide}\n\n${text}` : text)
                    }
                  />
                </div>
                <Textarea value={form.interview_guide} onChange={(e) => patch("interview_guide", e.target.value)}
                  placeholder={"Topics or questions the AI should cover.\nExample:\n1. Warm-up: tell me about your role.\n2. Walk me through a recent challenge.\n3. How did you decide what to do?\n\nOr upload a .txt / .md file with your guide."} rows={8} />
                <p className="text-xs text-muted-foreground">
                  Upload accepts plain text (.txt, .md). For PDF or Word documents, copy the questions into a .txt file first.
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="font-serif">Interview structure</CardTitle>
              <CardDescription>How closely should the AI follow your guide?</CardDescription>
            </CardHeader>
            <CardContent>
              <RadioGroup value={form.structure_type} onValueChange={(v) => patch("structure_type", v)}>
                {[
                  { v: "structured", t: "Structured", d: "AI asks guide questions verbatim, in order." },
                  { v: "semi_structured", t: "Semi-structured", d: "AI follows the guide, adds adaptive follow-up probes." },
                  { v: "unstructured", t: "Unstructured", d: "AI explores research questions conversationally, no fixed script." },
                ].map((o) => (
                  <label key={o.v} className="flex items-start gap-3 rounded-md border border-border p-4 hover:bg-accent/40">
                    <RadioGroupItem value={o.v} id={o.v} className="mt-1" />
                    <div>
                      <div className="font-medium">{o.t}</div>
                      <div className="text-sm text-muted-foreground">{o.d}</div>
                    </div>
                  </label>
                ))}
              </RadioGroup>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="font-serif">Participant modes &amp; limits</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <div>
                <Label className="mb-2 block">How can participants answer?</Label>
                <div className="flex flex-wrap gap-2">
                  {[["text", "Text chat"], ["audio", "Audio (record & type)"], ["voice", "Real-time voice"]].map(([v, t]) => {
                    const on = form.participant_modes.includes(v);
                    return (
                      <button key={v} type="button" onClick={() => toggleMode(v)}
                        className={`rounded-full border px-4 py-1.5 text-sm transition ${on ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background hover:bg-accent"}`}>
                        {on && <Check className="mr-1 inline h-3.5 w-3.5" />}{t}
                      </button>
                    );
                  })}
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  Enable more than one to let participants choose. Voice mode uses the browser to speak the interviewer's questions and listens for pauses to end each answer.
                </p>
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label>Max questions</Label>
                  <Input type="number" min={1} max={50} value={form.max_questions}
                    onChange={(e) => patch("max_questions", parseInt(e.target.value) || 1)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Max duration (min)</Label>
                  <Input type="number" min={1} max={180} value={form.max_duration_minutes}
                    onChange={(e) => patch("max_duration_minutes", parseInt(e.target.value) || 1)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Target sample size</Label>
                  <Input type="number" min={1} value={form.target_sample_size}
                    onChange={(e) => patch("target_sample_size", parseInt(e.target.value) || 1)} />
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* PERSONA */}
        <TabsContent value="persona" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="font-serif">Interviewer persona</CardTitle>
              <CardDescription>The voice the AI adopts when talking to participants.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label>Preset</Label>
                <Select
                  value={PERSONAS.find((p) => p.tone === form.persona_tone)?.name ?? "Custom"}
                  onValueChange={(name) => {
                    const p = PERSONAS.find((x) => x.name === name)!;
                    if (name !== "Custom") setForm({ ...form, persona_tone: p.tone, persona_background: p.background });
                  }}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PERSONAS.map((p) => <SelectItem key={p.name} value={p.name}>{p.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Interviewer name</Label>
                  <Input value={form.persona_name} onChange={(e) => patch("persona_name", e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label>Tone (short phrase)</Label>
                  <Input value={form.persona_tone} onChange={(e) => patch("persona_tone", e.target.value)}
                    placeholder="e.g. warm empathetic clinician" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Background &amp; style notes</Label>
                <Textarea rows={5} value={form.persona_background}
                  onChange={(e) => patch("persona_background", e.target.value)}
                  placeholder="How does this interviewer speak? What do they emphasize?" />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* CONSENT */}
        <TabsContent value="consent" className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="font-serif">Consent &amp; ethics</CardTitle></CardHeader>
            <CardContent className="space-y-5">
              <ToggleRow label="Show consent screen before interview"
                checked={form.consent_enabled} onChange={(v) => patch("consent_enabled", v)} />
              <ToggleRow label="Collect participant name and email"
                description="If off, sessions are fully anonymous."
                checked={form.collect_identity} onChange={(v) => patch("collect_identity", v)} />
              <ToggleRow label="Show a data-use notice"
                checked={form.data_use_notice} onChange={(v) => patch("data_use_notice", v)} />
              <ToggleRow label="Allow participants to withdraw and delete their data"
                checked={form.allow_withdrawal} onChange={(v) => patch("allow_withdrawal", v)} />
              <div className="space-y-1.5">
                <Label>Consent text shown to participants</Label>
                <Textarea rows={7} value={form.consent_text}
                  onChange={(e) => patch("consent_text", e.target.value)} />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* SHARE */}
        <TabsContent value="share" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="font-serif">Publish &amp; share</CardTitle>
              <CardDescription>Make your study live to accept responses.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex flex-wrap items-center gap-2">
                {form.status !== "live" ? (
                  <Button onClick={() => setStatus("live")}>
                    <Radio className="mr-2 h-4 w-4" /> Go live
                  </Button>
                ) : (
                  <Button variant="outline" onClick={() => setStatus("closed")}>Close study</Button>
                )}
                {form.status === "closed" && (
                  <Button variant="outline" onClick={() => setStatus("draft")}>Move to draft</Button>
                )}
              </div>

              <div className="flex items-center justify-between rounded-md border border-border p-4">
                <div>
                  <div className="font-medium">Share link is {form.share_active ? "active" : "inactive"}</div>
                  <p className="text-sm text-muted-foreground">
                    Turn off to temporarily block new participants without closing the study.
                  </p>
                </div>
                <Switch checked={form.share_active} onCheckedChange={(v) => patch("share_active", v)} />
              </div>

              <div className="grid gap-6 md:grid-cols-[1fr_auto]">
                <div className="space-y-3">
                  <Label>Participant link</Label>
                  <div className="flex gap-2">
                    <Input readOnly value={participantUrl} className="font-mono text-xs" />
                    <Button variant="outline" onClick={() => { navigator.clipboard.writeText(participantUrl); toast.success("Link copied"); }}>
                      <Copy className="h-4 w-4" />
                    </Button>
                    <Button variant="outline" asChild>
                      <a href={participantUrl} target="_blank" rel="noreferrer"><ExternalLink className="h-4 w-4" /></a>
                    </Button>
                  </div>
                  <Button variant="ghost" size="sm" onClick={regenToken}>
                    <RefreshCcw className="mr-2 h-3.5 w-3.5" /> Regenerate token
                  </Button>
                  {form.status !== "live" && (
                    <p className="text-xs text-muted-foreground">
                      The link only accepts responses when the study is live.
                    </p>
                  )}
                </div>
                <div className="flex flex-col items-center gap-2 rounded-md border border-border bg-paper p-4">
                  <QRCodeSVG value={participantUrl} size={140} bgColor="transparent" fgColor="currentColor" />
                  <span className="text-xs text-muted-foreground">Scan to open</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <div className="mt-8 flex items-center justify-between border-t border-border pt-6">
        <Button variant="ghost" className="text-destructive" onClick={() => {
          if (confirm("Delete this study and all its responses? This cannot be undone.")) del.mutate();
        }}>
          <Trash2 className="mr-2 h-4 w-4" /> Delete study
        </Button>
        <Button onClick={() => save.mutate(form)} disabled={save.isPending}>
          <Save className="mr-2 h-4 w-4" /> {save.isPending ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </main>
  );
}

function ToggleRow({ label, description, checked, onChange }: {
  label: string; description?: string; checked: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-md border border-border p-4">
      <div>
        <div className="font-medium">{label}</div>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

function GuideUpload({ onLoaded }: { onLoaded: (text: string, append: boolean) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const handle = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 500_000) { toast.error("File too large (max 500KB)."); return; }
    const name = file.name.toLowerCase();
    if (!name.endsWith(".txt") && !name.endsWith(".md") && file.type && !file.type.startsWith("text/")) {
      toast.error("Please upload a .txt or .md file.");
      return;
    }
    try {
      const text = (await file.text()).trim();
      if (!text) { toast.error("File is empty."); return; }
      const append = confirm("Append to existing guide? Click Cancel to replace it.");
      onLoaded(text, append);
      toast.success("Guide loaded — remember to Save changes.");
    } catch {
      toast.error("Could not read file.");
    }
  };
  return (
    <>
      <input ref={inputRef} type="file" accept=".txt,.md,text/plain,text/markdown" className="hidden" onChange={handle} />
      <Button type="button" variant="outline" size="sm" onClick={() => inputRef.current?.click()}>
        <Upload className="mr-2 h-3.5 w-3.5" /> Upload file
      </Button>
    </>
  );
}
