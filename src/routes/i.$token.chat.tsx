import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { nextInterviewerTurn } from "@/lib/interview.functions";
import { transcribeAudio } from "@/lib/audio.functions";
import { synthesizeSpeech } from "@/lib/tts.functions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Send, CheckCircle2, Mic, Square, Loader2, Type, AudioLines, Radio } from "lucide-react";

const search = z.object({ s: z.string().uuid() });

export const Route = createFileRoute("/i/$token/chat")({
  ssr: false,
  validateSearch: search,
  head: () => ({ meta: [{ title: "Interview — Interview Companion" }, { name: "robots", content: "noindex" }] }),
  component: Chat,
});

type Msg = { id: string; role: string; text: string; audio_url: string | null; question_index: number | null; created_at: string };
type UIMode = "text" | "audio" | "voice";

function pickMime(): string {
  if (typeof MediaRecorder === "undefined") return "audio/webm";
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/mpeg"];
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported(c)) return c;
  }
  return "audio/webm";
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function Chat() {
  const { token } = Route.useParams();
  const { s: sessionId } = Route.useSearch();
  const qc = useQueryClient();
  const nextTurn = useServerFn(nextInterviewerTurn);
  const transcribe = useServerFn(transcribeAudio);

  const sessionQ = useQuery({
    queryKey: ["p-session", sessionId],
    queryFn: async () => {
      const { data, error } = await supabase.from("sessions")
        .select("id, study_id, status, withdrawn, current_question_index, mode").eq("id", sessionId).single();
      if (error) throw error; return data;
    },
  });

  const studyQ = useQuery({
    queryKey: ["p-study-max", sessionQ.data?.study_id],
    enabled: !!sessionQ.data?.study_id,
    queryFn: async () => {
      const { data, error } = await supabase.from("studies")
        .select("title, persona_name, max_questions, allow_withdrawal, participant_modes")
        .eq("id", sessionQ.data!.study_id).single();
      if (error) throw error; return data;
    },
  });

  const messagesQ = useQuery({
    queryKey: ["p-messages", sessionId],
    queryFn: async () => {
      const { data, error } = await supabase.from("messages")
        .select("id, role, text, audio_url, question_index, created_at")
        .eq("session_id", sessionId).order("created_at", { ascending: true });
      if (error) throw error;
      return data as Msg[];
    },
    refetchInterval: false,
  });

  const allowedModes = (studyQ.data?.participant_modes ?? ["text"]) as UIMode[];
  const [mode, setMode] = useState<UIMode>("text");
  useEffect(() => {
    // Initialise mode from session mode when it arrives
    const sm = (sessionQ.data?.mode as UIMode | undefined) ?? "text";
    if (allowedModes.includes(sm)) setMode(sm);
    else if (allowedModes.length > 0) setMode(allowedModes[0]);
  }, [sessionQ.data?.mode, studyQ.data?.participant_modes]);

  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [recState, setRecState] = useState<"idle" | "recording" | "processing">("idle");
  const [level, setLevel] = useState(0); // 0..1 for visual meter
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messagesQ.data, thinking, recState]);

  const ended = sessionQ.data?.status === "completed" || sessionQ.data?.withdrawn;

  // ---- AI turn ----
  const spokenIdsRef = useRef<Set<string>>(new Set());
  const askAI = useCallback(async () => {
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
  }, [nextTurn, qc, sessionId]);

  const startedRef = useRef(false);
  useEffect(() => {
    if (startedRef.current) return;
    if (!messagesQ.data || !sessionQ.data) return;
    if (messagesQ.data.length === 0 && sessionQ.data.status === "in_progress") {
      startedRef.current = true;
      askAI();
    }
  }, [messagesQ.data, sessionQ.data, askAI]);

  // ---- Recording (audio & voice modes) ----
  const mediaRecRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const mimeRef = useRef<string>("audio/webm");
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const silenceStartRef = useRef<number | null>(null);
  const heardSpeechRef = useRef(false);
  const autoStopEnabledRef = useRef(false);

  const cleanupAudio = useCallback(() => {
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    try { analyserRef.current?.disconnect(); } catch { /* noop */ }
    analyserRef.current = null;
    if (audioCtxRef.current && audioCtxRef.current.state !== "closed") {
      audioCtxRef.current.close().catch(() => {});
    }
    audioCtxRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    mediaRecRef.current = null;
    setLevel(0);
  }, []);

  const submitAudio = useCallback(async (blob: Blob) => {
    if (blob.size < 2000) {
      toast.error("That recording was too short. Please try again.");
      return;
    }
    setRecState("processing");
    try {
      const b64 = await blobToBase64(blob);
      const { text } = await transcribe({ data: { audio_base64: b64, mime: mimeRef.current } });
      const trimmed = text.trim();
      if (!trimmed) {
        toast.error("Couldn't hear anything — please try again.");
        return;
      }
      // Upload the audio to storage for the researcher's records
      const path = `${sessionId}/${crypto.randomUUID()}.${mimeRef.current.includes("mp4") ? "m4a" : "webm"}`;
      const up = await supabase.storage.from("interview-audio").upload(path, blob, {
        contentType: mimeRef.current, upsert: false,
      });
      let audioUrl: string | null = null;
      if (!up.error) {
        const { data } = supabase.storage.from("interview-audio").getPublicUrl(path);
        audioUrl = data.publicUrl;
      }
      const { error } = await supabase.from("messages").insert({
        session_id: sessionId, role: "participant", text: trimmed, audio_url: audioUrl,
      });
      if (error) throw error;
      await qc.invalidateQueries({ queryKey: ["p-messages", sessionId] });
      await askAI();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not process recording");
    } finally {
      setRecState("idle");
    }
  }, [transcribe, sessionId, qc, askAI]);

  const stopRecording = useCallback(() => {
    const rec = mediaRecRef.current;
    if (rec && rec.state !== "inactive") {
      try { rec.stop(); } catch { /* noop */ }
    }
  }, []);

  const startRecording = useCallback(async (autoStop = false) => {
    if (recState !== "idle") return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      streamRef.current = stream;
      const mime = pickMime();
      mimeRef.current = mime;
      chunksRef.current = [];
      const rec = new MediaRecorder(stream, { mimeType: mime });
      mediaRecRef.current = rec;
      rec.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      rec.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: mime });
        cleanupAudio();
        await submitAudio(blob);
      };
      rec.start();
      setRecState("recording");

      // Set up VU meter + optional silence detection
      autoStopEnabledRef.current = autoStop;
      heardSpeechRef.current = false;
      silenceStartRef.current = null;
      const ACtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new ACtx();
      audioCtxRef.current = ctx;
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      src.connect(analyser);
      analyserRef.current = analyser;
      const buf = new Uint8Array(analyser.fftSize);
      const SPEECH_THRESHOLD = 0.03; // rms
      const SILENCE_MS = 1500;
      const MAX_MS = 60_000;
      const startedAt = performance.now();
      const tick = () => {
        if (!analyserRef.current) return;
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = (buf[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / buf.length);
        setLevel(Math.min(1, rms * 4));
        if (autoStopEnabledRef.current) {
          const now = performance.now();
          if (rms > SPEECH_THRESHOLD) {
            heardSpeechRef.current = true;
            silenceStartRef.current = null;
          } else if (heardSpeechRef.current) {
            if (silenceStartRef.current == null) silenceStartRef.current = now;
            else if (now - silenceStartRef.current > SILENCE_MS) { stopRecording(); return; }
          }
          if (now - startedAt > MAX_MS) { stopRecording(); return; }
        }
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch (e) {
      cleanupAudio();
      setRecState("idle");
      toast.error(e instanceof Error ? e.message : "Microphone access was denied.");
    }
  }, [recState, cleanupAudio, submitAudio, stopRecording]);

  useEffect(() => () => { cleanupAudio(); try { window.speechSynthesis.cancel(); } catch { /* noop */ } }, [cleanupAudio]);

  // ---- Voice mode: TTS interviewer + auto-record participant ----
  const voiceModeRef = useRef(false);
  voiceModeRef.current = mode === "voice";

  const speak = useCallback((text: string): Promise<void> => {
    return new Promise((resolve) => {
      if (typeof window === "undefined" || !("speechSynthesis" in window) || !text) return resolve();
      try {
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text);
        u.rate = 1.0; u.pitch = 1.0;
        const voices = window.speechSynthesis.getVoices();
        const pref = voices.find((v) => /en(-|_)?(US|GB)/i.test(v.lang) && /female|samantha|karen|jenny|serena/i.test(v.name))
          ?? voices.find((v) => v.lang.startsWith("en"))
          ?? voices[0];
        if (pref) u.voice = pref;
        u.onend = () => resolve();
        u.onerror = () => resolve();
        window.speechSynthesis.speak(u);
      } catch { resolve(); }
    });
  }, []);

  // Auto-flow for voice mode: whenever a new AI message arrives, speak it, then auto-record participant answer
  useEffect(() => {
    if (mode !== "voice") return;
    const list = messagesQ.data ?? [];
    const last = list[list.length - 1];
    if (!last || last.role !== "ai") return;
    if (spokenIdsRef.current.has(last.id)) return;
    if (thinking || recState !== "idle" || ended) return;
    spokenIdsRef.current.add(last.id);
    (async () => {
      await speak(last.text);
      // small delay to avoid mic capturing tail of TTS
      await new Promise((r) => setTimeout(r, 250));
      if (voiceModeRef.current && !ended) {
        startRecording(true);
      }
    })();
  }, [mode, messagesQ.data, thinking, recState, ended, speak, startRecording]);

  // Stop speaking / recording when leaving voice mode
  useEffect(() => {
    if (mode !== "voice") {
      try { window.speechSynthesis.cancel(); } catch { /* noop */ }
      if (recState === "recording") stopRecording();
    }
  }, [mode, recState, stopRecording]);

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
    try { window.speechSynthesis.cancel(); } catch { /* noop */ }
    if (recState === "recording") stopRecording();
    await supabase.from("sessions").update({ withdrawn: true, status: "withdrawn" }).eq("id", sessionId);
    await qc.invalidateQueries({ queryKey: ["p-session", sessionId] });
    toast.success("Your responses will be removed.");
  };

  const visible = useMemo(() => (messagesQ.data ?? []).filter((m) => m.role !== "system"), [messagesQ.data]);
  const askedCount = visible.filter((m) => m.role === "ai").length;
  const maxQ = studyQ.data?.max_questions ?? 10;

  if (ended) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-6">
        <div className="max-w-md text-center">
          <CheckCircle2 className="mx-auto h-12 w-12 text-primary" />
          <h1 className="mt-4 font-serif text-3xl">
            {sessionQ.data?.withdrawn ? "Thank you" : "Interview complete"}
          </h1>
          <p className="mt-3 text-muted-foreground">
            {sessionQ.data?.withdrawn
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

  const showModeSwitcher = allowedModes.length > 1;
  const canRecord = allowedModes.includes("audio") || allowedModes.includes("voice");
  const canType = allowedModes.includes("text") || allowedModes.includes("audio"); // in audio-only mode we still let them type as fallback

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="border-b border-border/60 bg-paper/60">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-6 py-4">
          <div className="min-w-0">
            <div className="truncate font-serif text-lg tracking-tight">{studyQ.data?.title ?? "Interview"}</div>
            <div className="text-xs text-muted-foreground">
              with {studyQ.data?.persona_name ?? "your AI interviewer"} · Question {Math.min(askedCount, maxQ)} of {maxQ}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {showModeSwitcher && (
              <div className="hidden sm:flex rounded-full border border-border p-0.5 text-xs">
                {allowedModes.map((m) => (
                  <button key={m} type="button" onClick={() => setMode(m)}
                    className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 capitalize transition ${mode === m ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}>
                    {m === "text" && <Type className="h-3 w-3" />}
                    {m === "audio" && <AudioLines className="h-3 w-3" />}
                    {m === "voice" && <Radio className="h-3 w-3" />}
                    {m}
                  </button>
                ))}
              </div>
            )}
            {studyQ.data?.allow_withdrawal && (
              <Button variant="ghost" size="sm" onClick={withdraw}>Withdraw</Button>
            )}
          </div>
        </div>
        {showModeSwitcher && (
          <div className="mx-auto flex max-w-3xl gap-1 px-6 pb-3 sm:hidden">
            {allowedModes.map((m) => (
              <button key={m} type="button" onClick={() => setMode(m)}
                className={`flex-1 rounded-full border px-2 py-1 text-xs capitalize transition ${mode === m ? "border-primary bg-primary text-primary-foreground" : "border-border"}`}>
                {m}
              </button>
            ))}
          </div>
        )}
      </header>

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-6 py-6">
        <div className="flex-1 space-y-6 pb-4">
          {visible.map((m) => (
            <div key={m.id} className={`flex ${m.role === "ai" ? "" : "justify-end"}`}>
              <div className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-5 py-3 leading-relaxed
                ${m.role === "ai" ? "bg-card border border-border" : "bg-primary text-primary-foreground"}`}>
                {m.text}
                {m.audio_url && (
                  <audio controls src={m.audio_url} className="mt-2 block w-full max-w-xs" />
                )}
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
          {mode === "voice" ? (
            <VoicePanel
              recState={recState}
              thinking={thinking}
              level={level}
              onStart={() => startRecording(true)}
              onStop={stopRecording}
            />
          ) : (
            <div className="flex items-end gap-2">
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    if (!send.isPending && !thinking && canType) send.mutate();
                  }
                }}
                placeholder={mode === "audio" ? "Type or tap the mic to record…" : "Type your answer…"}
                rows={3}
                disabled={thinking || send.isPending || recState !== "idle"}
                className="resize-none"
              />
              {canRecord && (
                <Button
                  variant={recState === "recording" ? "destructive" : "outline"}
                  size="lg"
                  onClick={() => (recState === "recording" ? stopRecording() : startRecording(false))}
                  disabled={thinking || send.isPending || recState === "processing"}
                  title={recState === "recording" ? "Stop recording" : "Record answer"}
                >
                  {recState === "processing" ? <Loader2 className="h-4 w-4 animate-spin" />
                    : recState === "recording" ? <Square className="h-4 w-4" />
                    : <Mic className="h-4 w-4" />}
                </Button>
              )}
              <Button onClick={() => send.mutate()}
                disabled={!input.trim() || send.isPending || thinking || recState !== "idle"} size="lg">
                <Send className="h-4 w-4" />
              </Button>
            </div>
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            {mode === "voice"
              ? "Speak naturally. The interviewer will listen, then reply out loud."
              : recState === "recording" ? "Recording… tap the square to stop."
              : recState === "processing" ? "Transcribing your answer…"
              : "Press ⌘/Ctrl + Enter to send."}
          </p>
        </div>
      </main>
    </div>
  );
}

function VoicePanel({
  recState, thinking, level, onStart, onStop,
}: {
  recState: "idle" | "recording" | "processing";
  thinking: boolean; level: number;
  onStart: () => void; onStop: () => void;
}) {
  const scale = 1 + Math.min(0.6, level * 1.2);
  const active = recState === "recording";
  return (
    <div className="flex flex-col items-center gap-3 py-4">
      <button
        type="button"
        onClick={active ? onStop : onStart}
        disabled={thinking || recState === "processing"}
        className={`relative flex h-20 w-20 items-center justify-center rounded-full border-2 transition
          ${active ? "border-destructive bg-destructive/10" : "border-primary bg-primary/10 hover:bg-primary/20"}
          ${(thinking || recState === "processing") ? "opacity-60" : ""}`}
        aria-label={active ? "Stop recording" : "Start recording"}
      >
        {active && (
          <span
            aria-hidden
            className="absolute inset-0 rounded-full bg-destructive/20"
            style={{ transform: `scale(${scale})`, transition: "transform 60ms linear" }}
          />
        )}
        {recState === "processing"
          ? <Loader2 className="h-8 w-8 animate-spin text-primary" />
          : active
            ? <Square className="h-7 w-7 text-destructive" />
            : <Mic className="h-8 w-8 text-primary" />}
      </button>
      <div className="text-sm text-muted-foreground">
        {thinking ? "Interviewer is thinking…"
          : recState === "processing" ? "Transcribing…"
          : active ? "Listening — pause when you're done."
          : "Tap to speak."}
      </div>
    </div>
  );
}
