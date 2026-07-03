import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus, Users, MessageSquare, FileText } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: Dashboard,
});

type StudyRow = {
  id: string; title: string; description: string | null; status: string;
  updated_at: string; share_token: string;
};

function Dashboard() {
  const { user } = Route.useRouteContext();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const studiesQ = useQuery({
    queryKey: ["studies", user.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("studies")
        .select("id, title, description, status, updated_at, share_token")
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return data as StudyRow[];
    },
  });

  const statsQ = useQuery({
    queryKey: ["study-stats", user.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sessions")
        .select("study_id, status");
      if (error) throw error;
      const acc: Record<string, { total: number; completed: number }> = {};
      for (const row of data as { study_id: string; status: string }[]) {
        const s = acc[row.study_id] ?? { total: 0, completed: 0 };
        s.total += 1;
        if (row.status === "completed") s.completed += 1;
        acc[row.study_id] = s;
      }
      return acc;
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase
        .from("studies")
        .insert({ owner_id: user.id, title: "Untitled study" })
        .select("id")
        .single();
      if (error) throw error;
      return data.id as string;
    },
    onSuccess: (id) => {
      qc.invalidateQueries({ queryKey: ["studies"] });
      navigate({ to: "/studies/$id", params: { id } });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not create study"),
  });

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-8 flex items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.24em] text-muted-foreground">Dashboard</p>
          <h1 className="mt-2 font-serif text-4xl tracking-tight">Your studies</h1>
        </div>
        <Button onClick={() => create.mutate()} disabled={create.isPending}>
          <Plus className="mr-2 h-4 w-4" /> New study
        </Button>
      </div>

      {studiesQ.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : studiesQ.data && studiesQ.data.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2">
          {studiesQ.data.map((s) => {
            const st = statsQ.data?.[s.id] ?? { total: 0, completed: 0 };
            const rate = st.total ? Math.round((st.completed / st.total) * 100) : 0;
            return (
              <Link key={s.id} to="/studies/$id" params={{ id: s.id }} className="block">
                <Card className="h-full transition-colors hover:border-primary/40">
                  <CardContent className="p-6">
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="font-serif text-xl leading-tight">{s.title}</h3>
                      <StatusBadge status={s.status} />
                    </div>
                    {s.description && (
                      <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{s.description}</p>
                    )}
                    <div className="mt-5 flex flex-wrap gap-4 text-sm text-muted-foreground">
                      <span className="inline-flex items-center gap-1.5"><Users className="h-3.5 w-3.5" /> {st.total} responses</span>
                      <span className="inline-flex items-center gap-1.5"><MessageSquare className="h-3.5 w-3.5" /> {rate}% completion</span>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      ) : (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
            <FileText className="h-8 w-8 text-muted-foreground" />
            <h3 className="font-serif text-xl">No studies yet</h3>
            <p className="max-w-sm text-sm text-muted-foreground">
              Create your first study to configure an AI-led interview and share a link with participants.
            </p>
            <Button onClick={() => create.mutate()} disabled={create.isPending}>
              <Plus className="mr-2 h-4 w-4" /> New study
            </Button>
          </CardContent>
        </Card>
      )}
    </main>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; variant: "default" | "secondary" | "outline" }> = {
    draft: { label: "Draft", variant: "outline" },
    live: { label: "Live", variant: "default" },
    closed: { label: "Closed", variant: "secondary" },
  };
  const s = map[status] ?? map.draft;
  return <Badge variant={s.variant}>{s.label}</Badge>;
}
