import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, Download, FileText } from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/studies/$id/responses")({
  component: Responses,
});

type Session = {
  id: string; started_at: string; completed_at: string | null; status: string;
  mode: string; participant_name: string | null; participant_email: string | null;
  withdrawn: boolean; current_question_index: number;
};

function Responses() {
  const { id } = Route.useParams();

  const studyQ = useQuery({
    queryKey: ["study", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("studies").select("id, title").eq("id", id).single();
      if (error) throw error; return data;
    },
  });

  const sessionsQ = useQuery({
    queryKey: ["sessions", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("sessions")
        .select("id, started_at, completed_at, status, mode, participant_name, participant_email, withdrawn, current_question_index")
        .eq("study_id", id)
        .order("started_at", { ascending: false });
      if (error) throw error;
      return data as Session[];
    },
  });

  const exportCsv = async () => {
    const { data: sessions, error: se } = await supabase.from("sessions")
      .select("*").eq("study_id", id).order("started_at", { ascending: false });
    if (se) return toast.error(se.message);
    const { data: msgs, error: me } = await supabase.from("messages")
      .select("session_id, role, text, question_index, created_at")
      .in("session_id", (sessions ?? []).map((s) => s.id))
      .order("created_at", { ascending: true });
    if (me) return toast.error(me.message);

    const rows: string[] = [];
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    rows.push(["session_id","started_at","completed_at","status","mode","participant_name","participant_email","question_index","role","text","message_at"].join(","));
    for (const s of sessions ?? []) {
      const sm = (msgs ?? []).filter((m) => m.session_id === s.id);
      if (sm.length === 0) {
        rows.push([s.id, s.started_at, s.completed_at, s.status, s.mode, s.participant_name, s.participant_email, "", "", "", ""].map(esc).join(","));
      } else {
        for (const m of sm) {
          rows.push([s.id, s.started_at, s.completed_at, s.status, s.mode, s.participant_name, s.participant_email, m.question_index, m.role, m.text, m.created_at].map(esc).join(","));
        }
      }
    }
    downloadFile(rows.join("\n"), `${studyQ.data?.title ?? "study"}-responses.csv`, "text/csv");
  };

  const total = sessionsQ.data?.length ?? 0;
  const completed = sessionsQ.data?.filter((s) => s.status === "completed").length ?? 0;

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <Button variant="ghost" size="sm" asChild className="mb-4">
        <Link to="/studies/$id" params={{ id }}><ArrowLeft className="mr-1 h-4 w-4" /> Back to study</Link>
      </Button>

      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">Responses</p>
          <h1 className="mt-2 font-serif text-4xl tracking-tight">{studyQ.data?.title ?? "—"}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {total} total · {completed} completed · {total ? Math.round((completed/total)*100) : 0}% completion
          </p>
        </div>
        <Button variant="outline" onClick={exportCsv} disabled={!total}>
          <Download className="mr-2 h-4 w-4" /> Export CSV
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {sessionsQ.isLoading ? (
            <p className="p-6 text-sm text-muted-foreground">Loading…</p>
          ) : total === 0 ? (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <FileText className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">No responses yet. Share your link to start collecting.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Started</TableHead>
                  <TableHead>Participant</TableHead>
                  <TableHead>Mode</TableHead>
                  <TableHead>Progress</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-24"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sessionsQ.data!.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="text-sm">
                      <div>{format(new Date(s.started_at), "MMM d, HH:mm")}</div>
                      <div className="text-xs text-muted-foreground">{formatDistanceToNow(new Date(s.started_at), { addSuffix: true })}</div>
                    </TableCell>
                    <TableCell className="text-sm">
                      {s.participant_name || s.participant_email || <span className="text-muted-foreground">Anonymous</span>}
                    </TableCell>
                    <TableCell className="text-sm capitalize">{s.mode}</TableCell>
                    <TableCell className="text-sm">Q{s.current_question_index}</TableCell>
                    <TableCell>
                      <Badge variant={s.status === "completed" ? "default" : s.withdrawn ? "destructive" : "outline"}>
                        {s.withdrawn ? "withdrawn" : s.status.replace("_", " ")}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="sm" asChild>
                        <Link to="/studies/$id/sessions/$sessionId" params={{ id, sessionId: s.id }}>View</Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </main>
  );
}

function downloadFile(content: string, filename: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
