import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Download } from "lucide-react";
import { format } from "date-fns";

export const Route = createFileRoute("/_authenticated/studies/$id/sessions/$sessionId")({
  component: Transcript,
});

type Msg = { id: string; role: string; text: string; audio_url: string | null; question_index: number | null; created_at: string };

function Transcript() {
  const { id, sessionId } = Route.useParams();

  const sessionQ = useQuery({
    queryKey: ["session", sessionId],
    queryFn: async () => {
      const { data, error } = await supabase.from("sessions").select("*").eq("id", sessionId).single();
      if (error) throw error; return data;
    },
  });

  const msgsQ = useQuery({
    queryKey: ["messages", sessionId],
    queryFn: async () => {
      const { data, error } = await supabase.from("messages")
        .select("id, role, text, audio_url, question_index, created_at")
        .eq("session_id", sessionId).order("created_at", { ascending: true });
      if (error) throw error;
      return data as Msg[];
    },
  });

  const download = (kind: "txt" | "json") => {
    if (!msgsQ.data || !sessionQ.data) return;
    if (kind === "txt") {
      const lines = msgsQ.data
        .filter((m) => m.role !== "system")
        .map((m) => `[${m.role === "ai" ? "AI" : "Participant"}] ${m.text}`)
        .join("\n\n");
      dl(lines, `transcript-${sessionId}.txt`, "text/plain");
    } else {
      dl(JSON.stringify({ session: sessionQ.data, messages: msgsQ.data }, null, 2),
         `transcript-${sessionId}.json`, "application/json");
    }
  };

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <Button variant="ghost" size="sm" asChild className="mb-4">
        <Link to="/studies/$id/responses" params={{ id }}><ArrowLeft className="mr-1 h-4 w-4" /> Back to responses</Link>
      </Button>

      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">Transcript</p>
          <h1 className="mt-2 font-serif text-3xl tracking-tight">
            {sessionQ.data?.participant_name || sessionQ.data?.participant_email || "Anonymous participant"}
          </h1>
          {sessionQ.data && (
            <p className="mt-1 text-sm text-muted-foreground">
              Started {format(new Date(sessionQ.data.started_at), "PPp")} ·{" "}
              <Badge variant="outline" className="ml-1">{sessionQ.data.status.replace("_", " ")}</Badge>
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => download("txt")}><Download className="mr-2 h-4 w-4" />Text</Button>
          <Button variant="outline" size="sm" onClick={() => download("json")}><Download className="mr-2 h-4 w-4" />JSON</Button>
        </div>
      </div>

      <Card>
        <CardContent className="space-y-6 p-6">
          {msgsQ.data?.filter((m) => m.role !== "system").map((m) => (
            <div key={m.id} className={m.role === "ai" ? "" : "border-l-2 border-primary pl-4"}>
              <div className="mb-1 text-xs uppercase tracking-wider text-muted-foreground">
                {m.role === "ai" ? "Interviewer" : "Participant"}
              </div>
              <p className="whitespace-pre-wrap leading-relaxed">{m.text}</p>
            </div>
          ))}
          {(!msgsQ.data || msgsQ.data.length === 0) && (
            <p className="text-sm text-muted-foreground">No messages recorded.</p>
          )}
        </CardContent>
      </Card>
    </main>
  );
}

function dl(content: string, filename: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
