import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { nextInterviewerTurn } from "@/lib/interview.functions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Send, CheckCircle2 } from "lucide-react";

const search = z.object({ s: z.string().uuid() });

export const Route = createFileRoute("/i/$token/chat")({
  ssr: false,
  validateSearch: search,
  head: () => ({ meta: [{ title: "Interview — Interview Companion" }, { name: "robots", content: "noindex" }] }),
  component: Chat,
});

type Msg = { id: string; role: string; text: string; question_index: number | null; created_at: string };

function Chat() {
  const { token } = Route.useParams();
  const { s: sessionId } = Route.useSearch();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const nextTurn = useServerFn(nextInterviewerTurn);

  const sessionQ = useQuery({
    queryKey: ["p-session", sessionId],
    queryFn: async () => {
      const { data, error } = await supabase.from("sessions")
        .select("id, study_id, status, withdrawn, current_question_index").eq("id", sessionId).single();
      if (error) throw error; return data;
    },
  });

  const studyQ = useQuery({
    queryKey: ["p-study-max", sessionQ.data?.study_id],
    enabled: !!sessionQ.data?.study_id,
    queryFn: async () => {
      const { data, error } = await supabase.from("studies")
        .select("title, persona_name, max_questions, allow_withdrawal")
        .eq("id", sessionQ.data!.study_id).single();
      if (error) throw error; return data;
    },
  });

  const messagesQ = useQuery({
    queryKey: ["p-messages", sessionId],
    queryFn: async () => {
      const { data, error } = await supabase.from("messages")
        .select("id, role, text, question_index, created_at")
        .eq("session_id", sessionId).order("created_at", { ascending: true });
      if (error) throw error;
      return data as Msg[];
    },
    refetchInterval: false,
  });

  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messagesQ.data, thinking]);

  const ended = sessionQ.data?.status === "completed" || sessionQ.data?.withdrawn;

  // Kick off first AI question if none exists
  const startedRef = useRef(false);
  useEffect(() => {
    if (startedRef.current) return;
    if (!messagesQ.data || !sessionQ.data) return;
    if (messagesQ.data.length === 0 && sessionQ.data.status === "in_progress") {
      startedRef.current = true;
      askAI();
    }
  }, [messagesQ.data, sessionQ.data]);

  const askAI = async () => {
    setThinking(true);
    try {
      await nextTurn({ data: { session_id: sessionId } });
      await qc.invalidateQueries({ queryKey: ["p-messages", sessionId] });
      await qc.invalidateQueries({ queryKey: ["p-session", sessionId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "The interviewer had trouble responding.");
    } finally {
      setThinking(false);
    }
  };

  const send = useMutation({
    mutationFn: async () => {
      const text = input.trim();
      if (!text) return;
      const { error } = await supabase.from("messages").insert({
        session_id: sessionId, role: "participant", text,
      });
      if (error) throw error;
      setInput("");
      await qc.invalidateQueries({ queryKey: ["p-messages", sessionId] });
      await askAI();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not send"),
  });

  const withdraw = async () => {
    if (!confirm("Withdraw and request deletion of your responses?")) return;
    await supabase.from("sessions").update({ withdrawn: true, status: "withdrawn" }).eq("id", sessionId);
    await qc.invalidateQueries({ queryKey: ["p-session", sessionId] });
    toast.success("Your responses will be removed.");
  };

  const visible = (messagesQ.data ?? []).filter((m) => m.role !== "system");
  const askedCount = visible.filter((m) => m.role === "ai").length;
  const maxQ = studyQ.data?.max_questions ?? 10;

  if (sessionQ.data?.status === "completed" || sessionQ.data?.withdrawn) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-6">
        <div className="max-w-md text-center">
          <CheckCircle2 className="mx-auto h-12 w-12 text-primary" />
          <h1 className="mt-4 font-serif text-3xl">
            {sessionQ.data.withdrawn ? "Thank you" : "Interview complete"}
          </h1>
          <p className="mt-3 text-muted-foreground">
            {sessionQ.data.withdrawn
              ? "Your responses have been marked for withdrawal."
              : "Thank you for sharing your time and reflections. Your responses have been recorded."}
          </p>
          <Button variant="outline" asChild className="mt-6">
            <Link to="/">Close</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="border-b border-border/60 bg-paper/60">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <div className="min-w-0">
            <div className="truncate font-serif text-lg tracking-tight">{studyQ.data?.title ?? "Interview"}</div>
            <div className="text-xs text-muted-foreground">
              with {studyQ.data?.persona_name ?? "your AI interviewer"} · Question {Math.min(askedCount, maxQ)} of {maxQ}
            </div>
          </div>
          {studyQ.data?.allow_withdrawal && (
            <Button variant="ghost" size="sm" onClick={withdraw}>Withdraw</Button>
          )}
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-6 py-6">
        <div className="flex-1 space-y-6 pb-4">
          {visible.map((m) => (
            <div key={m.id} className={`flex ${m.role === "ai" ? "" : "justify-end"}`}>
              <div className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-5 py-3 leading-relaxed
                ${m.role === "ai" ? "bg-card border border-border" : "bg-primary text-primary-foreground"}`}>
                {m.text}
              </div>
            </div>
          ))}
          {thinking && (
            <div className="flex">
              <div className="rounded-2xl border border-border bg-card px-5 py-3 text-sm text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current [animation-delay:150ms]" />
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current [animation-delay:300ms]" />
                </span>
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        <div className="sticky bottom-0 border-t border-border bg-background pt-4">
          <div className="flex items-end gap-2">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); if (!send.isPending && !thinking) send.mutate(); }
              }}
              placeholder="Type your answer…"
              rows={3}
              disabled={ended || thinking || send.isPending}
              className="resize-none"
            />
            <Button onClick={() => send.mutate()} disabled={!input.trim() || send.isPending || thinking || ended} size="lg">
              <Send className="h-4 w-4" />
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">Press ⌘/Ctrl + Enter to send.</p>
        </div>
      </main>
    </div>
  );
}
