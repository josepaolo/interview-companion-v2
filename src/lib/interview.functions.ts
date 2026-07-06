import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

const Input = z.object({
  session_id: z.string().uuid(),
  session_token: z.string().uuid(),
  mode: z.enum(["text", "audio", "voice"]).optional(),
});

type SurveyItem = {
  id: string;
  kind: "survey" | "probe";
  prompt: string;
  question_type?: "open" | "single" | "multi" | "scale" | "boolean";
  options?: string[];
  scale_min?: number; scale_max?: number;
  scale_min_label?: string; scale_max_label?: string;
};

type StudyRow = {
  id: string; title: string; description: string | null;
  research_questions: string | null; interview_guide: string | null;
  structure_type: string; persona_name: string; persona_tone: string;
  persona_background: string | null; max_questions: number;
  status: string; share_active: boolean;
  survey_items: SurveyItem[] | null;
};


type MsgRow = { role: string; text: string; question_index: number | null };
type SessRow = { id: string; study_id: string; current_question_index: number; status: string };

function serverSupabase(sessionToken: string) {
  return createClient<Database>(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_PUBLISHABLE_KEY!,
    {
      auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
      global: { headers: { "x-session-token": sessionToken } },
    }
  );
}

function buildSystemPrompt(study: StudyRow, mode: "text" | "audio" | "voice" = "text") {
  const structureRule = study.structure_type === "structured"
    ? "Ask the guide questions verbatim, in order, with minimal deviation. Do not add follow-ups unless the participant is unclear."
    : study.structure_type === "unstructured"
    ? "Explore the research questions conversationally. No fixed script. Follow the participant's lead."
    : "Follow the interview guide as a loose sequence. Ask adaptive follow-up probes when answers are shallow or intriguing.";

  const voiceRule = mode === "voice"
    ? [
        `Delivery: this interview is happening OUT LOUD, spoken back and forth in real time. Write for the ear, not the page.`,
        `- Keep each turn short: 1-2 sentences, ideally under 30 words. Never monologue.`,
        `- Use natural spoken English: contractions, everyday words, light hedges ("hmm", "okay", "got it", "that makes sense").`,
        `- Vary sentence rhythm. Occasionally begin with a short acknowledgement ("Interesting.", "Thanks for sharing that.") before the next question.`,
        `- Never say numbers, bullets, headings, or "question one", "next question". Just ask.`,
        `- No emoji, no markdown, no parentheses, no stage directions.`,
        `- Pronounceable punctuation only: commas, periods, question marks. Avoid semicolons and em-dashes.`,
      ].join("\n")
    : "";


  return [
    `You are ${study.persona_name}, an AI research interviewer.`,
    `Tone and manner: ${study.persona_tone}.`,
    study.persona_background ? `Background: ${study.persona_background}` : "",
    `You are conducting a qualitative research interview titled "${study.title}".`,
    study.description ? `Study context: ${study.description}` : "",
    study.research_questions ? `Underlying research questions:\n${study.research_questions}` : "",
    study.interview_guide ? `Interview guide:\n${study.interview_guide}` : "",
    `Interview style: ${structureRule}`,
    voiceRule,
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
    const sb = serverSupabase(data.session_token);

    const { data: sess, error: se } = await sb.from("sessions")
      .select("id, study_id, current_question_index, status")
      .eq("id", data.session_id).single();
    if (se || !sess) throw new Error("Session not found");
    const session = sess as SessRow;

    const { data: study, error: st } = await sb.from("studies")
      .select("id, title, description, research_questions, interview_guide, structure_type, persona_name, persona_tone, persona_background, max_questions, status, share_active, survey_items")
      .eq("id", session.study_id).single();
    if (st || !study) throw new Error("Study not found");
    if (study.status !== "live" || !study.share_active) throw new Error("Study is not accepting responses");

    const { data: msgs, error: me } = await sb.from("messages")
      .select("role, text, question_index").eq("session_id", session.id)
      .order("created_at", { ascending: true });
    if (me) throw new Error(me.message);

    const askedSoFar = (msgs as MsgRow[]).filter((m) => m.role === "ai").length;
    const studyRow = study as StudyRow;

    // ---- Hybrid survey-interview mode ----
    if (studyRow.structure_type === "hybrid_survey") {
      const items = Array.isArray(studyRow.survey_items) ? studyRow.survey_items : [];
      if (items.length === 0) throw new Error("Hybrid survey has no items configured");

      const CLOSING_TEXT = "Before we wrap up — is there anything else you'd like to share that we haven't touched on?";
      const FINAL_THANKS = "Thank you so much for your thoughtful answers — that's everything from my side. I really appreciate your time.";

      // Sequence: items[0..n-1] → closing question (index n+1) → final thanks (index n+2, ends).
      if (askedSoFar >= items.length + 1) {
        const idx = askedSoFar + 1;
        await sb.from("messages").insert({
          session_id: session.id, role: "ai", text: FINAL_THANKS, question_index: idx,
        });
        await sb.from("sessions").update({
          current_question_index: idx,
          status: "completed",
          completed_at: new Date().toISOString(),
        }).eq("id", session.id);
        return { text: FINAL_THANKS, ended: true, question_index: idx };
      }

      if (askedSoFar === items.length) {
        const idx = items.length + 1;
        await sb.from("messages").insert({
          session_id: session.id, role: "ai", text: CLOSING_TEXT, question_index: idx,
        });
        await sb.from("sessions").update({ current_question_index: idx }).eq("id", session.id);
        return { text: CLOSING_TEXT, ended: false, question_index: idx };
      }


      const nextItem = items[askedSoFar];
      const itemIndex = askedSoFar + 1;
      let text = "";

      if (nextItem.kind === "survey") {
        // Ask verbatim, no LLM call. Append options hint for structured types.
        text = renderSurveyPrompt(nextItem);
      } else {
        // Probe: ask ONE adaptive question exploring the topic, informed by prior transcript.
        const history = (msgs as MsgRow[]).map((m) => ({
          role: m.role === "ai" ? ("assistant" as const)
              : m.role === "participant" ? ("user" as const)
              : ("system" as const),
          content: m.text,
        }));
        const sys = [
          buildSystemPrompt(studyRow, data.mode ?? "text"),
          `You are running a HYBRID survey-interview. The next moment in the guide is a semi-structured probe on the following topic:`,
          `"${nextItem.prompt}"`,
          `Ask exactly ONE open, conversational question that opens this topic. Reference the participant's earlier answers only if it feels natural. Do NOT number the question, do NOT reveal you are following a script. Do NOT end the interview; there are more items to come. Do NOT output [END_OF_INTERVIEW].`,
        ].join("\n");
        const messages = [
          { role: "system" as const, content: sys },
          ...history,
        ];
        const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model: "google/gemini-3-flash-preview", messages }),
        });
        if (!res.ok) {
          const t = await res.text().catch(() => "");
          if (res.status === 429) throw new Error("Rate limit reached, please retry in a moment.");
          if (res.status === 402) throw new Error("AI credits exhausted for this workspace.");
          throw new Error(`AI gateway error ${res.status}: ${t}`);
        }
        const json = await res.json() as { choices?: { message?: { content?: string } }[] };
        text = (json.choices?.[0]?.message?.content ?? "").replace(/\[END_OF_INTERVIEW\]/gi, "").trim();
        if (!text) text = nextItem.prompt;
      }

      const { error: ie } = await sb.from("messages").insert({
        session_id: session.id, role: "ai", text, question_index: itemIndex,
      });
      if (ie) throw new Error(ie.message);
      await sb.from("sessions").update({ current_question_index: itemIndex }).eq("id", session.id);
      return { text, ended: false, question_index: itemIndex };
    }

    // ---- Standard modes (structured / semi-structured / unstructured) ----
    const history = (msgs as MsgRow[]).map((m) => ({
      role: m.role === "ai" ? "assistant" : m.role === "participant" ? "user" : "system",
      content: m.text,
    }));

    const messages = [
      { role: "system" as const, content: buildSystemPrompt(studyRow, data.mode ?? "text") },
      ...history,
    ];

    if (askedSoFar >= studyRow.max_questions) {
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

function renderSurveyPrompt(item: SurveyItem): string {
  const p = item.prompt.trim();
  const t = item.question_type;
  if (t === "single" && item.options?.length) {
    return `${p}\n\nPlease choose one:\n${item.options.map((o, i) => `${i + 1}. ${o}`).join("\n")}`;
  }
  if (t === "multi" && item.options?.length) {
    return `${p}\n\nSelect all that apply:\n${item.options.map((o, i) => `${i + 1}. ${o}`).join("\n")}`;
  }
  if (t === "scale") {
    const lo = item.scale_min ?? 1;
    const hi = item.scale_max ?? 5;
    const lol = item.scale_min_label ? ` (${item.scale_min_label})` : "";
    const hil = item.scale_max_label ? ` (${item.scale_max_label})` : "";
    return `${p}\n\nOn a scale from ${lo}${lol} to ${hi}${hil}, what would you say?`;
  }
  if (t === "boolean") {
    return `${p}\n\n(Yes or No — feel free to add a sentence of context.)`;
  }
  return p;
}

