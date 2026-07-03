import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { BookOpen, MessageSquareQuote, Sparkles } from "lucide-react";

export const Route = createFileRoute("/")({
  component: Landing,
});

function Landing() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border/60">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
          <Link to="/" className="flex items-center gap-2">
            <span className="font-serif text-xl font-semibold tracking-tight">
              Interview Companion
            </span>
          </Link>
          <nav className="flex items-center gap-2">
            <Button asChild variant="ghost">
              <Link to="/auth">Sign in</Link>
            </Button>
            <Button asChild>
              <Link to="/auth" search={{ mode: "signup" }}>
                Get started
              </Link>
            </Button>
          </nav>
        </div>
      </header>

      <main>
        <section className="mx-auto max-w-4xl px-6 pt-24 pb-16 text-center">
          <p className="text-xs uppercase tracking-[0.28em] text-muted-foreground">
            For researchers &amp; social scientists
          </p>
          <h1 className="mt-5 font-serif text-5xl leading-[1.05] tracking-tight text-foreground md:text-6xl">
            AI-assisted qualitative interviews,
            <br />
            <span className="text-primary italic">at the scale of a survey.</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground">
            Design an interview guide, choose a persona and structure, and share a single
            link. Participants speak with a thoughtful AI interviewer. You get clean,
            searchable transcripts — ready for coding and analysis.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Button asChild size="lg">
              <Link to="/auth" search={{ mode: "signup" }}>
                Start a study
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link to="/auth">I have an account</Link>
            </Button>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-6 pb-24">
          <div className="grid gap-6 md:grid-cols-3">
            {[
              { icon: BookOpen, title: "Guided or open", body: "Structured, semi-structured, or unstructured — the AI follows your intent." },
              { icon: MessageSquareQuote, title: "Adaptive probing", body: "Context-aware follow-ups that reach past first answers, without leading." },
              { icon: Sparkles, title: "Configurable persona", body: "Choose a warm clinician, neutral academic, or your own tailored voice." },
            ].map((f) => (
              <div key={f.title} className="rounded-lg border border-border bg-card p-6">
                <f.icon className="h-6 w-6 text-primary" />
                <h3 className="mt-4 font-serif text-xl">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{f.body}</p>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t border-border/60">
        <div className="mx-auto max-w-6xl px-6 py-6 text-center text-xs text-muted-foreground">
          Built for academic research. Consent, ethics, and withdrawal built in.
        </div>
      </footer>
    </div>
  );
}
