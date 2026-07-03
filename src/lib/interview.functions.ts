import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

const Input = z.object({
  session_id: z.string().uuid(),
});

type StudyRow = {
  id: string; title: string; description: string | null;
  research_questions: string | null; interview_guide: string | null;
  structure_type: string; persona_name: string; persona_tone: string;
  persona_background: string | null; max_questions: number;
  status: string; share_active: boolean;
};

type MsgRow = { role: string; text: string; question_index: number | null };
type SessRow = { id: string; study_id: string; current_question_index: number; status: string };

function serverSupabase() {
  return createClient<Database>(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_PUBLISHABLE_KEY!,
    { auth: { storage: undefined, persistSession: false, autoRefreshToken: false } }
  );
}

function buildSystemPrompt(study: StudyRow) {
  const structureRule = study.structure_type === "structured"
    ? "Ask the guide questions verbatim, in order, with minimal deviation. Do not add follow-ups unless the participant is unclear."
    : study.structure_type === "unstructured"
    ? "Explore the research questions conversationally. No fixed script. Follow the participant's lead."
    : "Follow the interview guide as a loose sequence. Ask adaptive follow-up probes when answers are shallow or intriguing.";

  return [
    `You are ${study.persona_name}, an AI research interviewer.`,
    `Tone and manner: ${study.persona_tone}.`,
    study.persona_background ? `Background: ${study.persona_background}` : "",
    `You are conducting a qualitative research interview titled "${study.title}".`,
    study.description ? `Study context: ${study.description}` : "",
    study.research_questions ? `Underlying research questions:\n${study.research_questions}` : "",
    study.interview_guide ? `Interview guide:\n${study.interview_guide}` : "",
    `Interview style: ${structureRule}`,
    `Rules:`,
    `- Ask ONE question at a time. Keep questions short and open.`,
    `- Do not lead the participant, do not put words in their mouth.`,
    `- Acknowledge briefly (one short sentence) before the next question when it feels natural.`,
    `- Never invent facts about the participant.`,
    `- Hard cap: no more than ${study.max_questions} interviewer questions total.`,
    `- When you have covered the topics or reached the cap, output on a final line exactly: [END_OF_INTERVIEW]`,
    `- Output plain conversational text. No markdown headings, no numbered lists in your reply.`,
  ].filter(Boolean).join("\n");
}

export const nextInterviewerTurn = createServerFn({ method: "POST" })
  .inputValidator((v: unknown) => Input.parse(v))
  .handler(async ({ data }) => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("Missing LOVABLE_API_KEY");
    const sb = serverSupabase();

    const { data: sess, error: se } = await sb.from("sessions")
      .select("id, study_id, current_question_index, status")
      .eq("id", data.session_id).single();
    if (se || !sess) throw new Error("Session not found");
    const session = sess as SessRow;

    const { data: study, error: st } = await sb.from("studies")
      .select("id, title, description, research_questions, interview_guide, structure_type, persona_name, persona_tone, persona_background, max_questions, status, share_active")
      .eq("id", session.study_id).single();
    if (st || !study) throw new Error("Study not found");
    if (study.status !== "live" || !study.share_active) throw new Error("Study is not accepting responses");

    const { data: msgs, error: me } = await sb.from("messages")
      .select("role, text, question_index").eq("session_id", session.id)
      .order("created_at", { ascending: true });
    if (me) throw new Error(me.message);

    const history = (msgs as MsgRow[]).map((m) => ({
      role: m.role === "ai" ? "assistant" : m.role === "participant" ? "user" : "system",
      content: m.text,
    }));

    const messages = [
      { role: "system" as const, content: buildSystemPrompt(study as StudyRow) },
      ...history,
    ];

    // If the last participant answer would push past the cap, ask the model to end.
    const askedSoFar = (msgs as MsgRow[]).filter((m) => m.role === "ai").length;
    if (askedSoFar >= (study as StudyRow).max_questions) {
      messages.push({
        role: "system" as const,
        content: "You have reached the maximum number of questions. Thank the participant warmly in 1-2 sentences and end with [END_OF_INTERVIEW] on its own line.",
      });
    }

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages,
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      if (res.status === 429) throw new Error("Rate limit reached, please retry in a moment.");
      if (res.status === 402) throw new Error("AI credits exhausted for this workspace.");
      throw new Error(`AI gateway error ${res.status}: ${text}`);
    }
    const json = await res.json() as { choices?: { message?: { content?: string } }[] };
    const raw = json.choices?.[0]?.message?.content?.trim() ?? "";
    const ended = /\[END_OF_INTERVIEW\]/i.test(raw);
    const text = raw.replace(/\[END_OF_INTERVIEW\]/gi, "").trim();

    const nextIndex = (session.current_question_index ?? 0) + 1;

    const { error: ie } = await sb.from("messages").insert({
      session_id: session.id, role: "ai", text, question_index: nextIndex,
    });
    if (ie) throw new Error(ie.message);

    if (ended) {
      await sb.from("sessions").update({
        current_question_index: nextIndex,
        status: "completed",
        completed_at: new Date().toISOString(),
      }).eq("id", session.id);
    } else {
      await sb.from("sessions").update({ current_question_index: nextIndex }).eq("id", session.id);
    }

    return { text, ended, question_index: nextIndex };
  });
