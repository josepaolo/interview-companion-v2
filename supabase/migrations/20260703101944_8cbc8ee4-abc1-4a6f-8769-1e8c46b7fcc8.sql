
-- profiles
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read own profile" ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);
CREATE POLICY "Users update own profile" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
CREATE POLICY "Users insert own profile" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);

-- studies
CREATE TABLE public.studies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'Untitled study',
  description TEXT DEFAULT '',
  research_questions TEXT DEFAULT '',
  interview_guide TEXT DEFAULT '',
  structure_type TEXT NOT NULL DEFAULT 'semi_structured', -- structured | semi_structured | unstructured
  persona_name TEXT NOT NULL DEFAULT 'Dr. Alex',
  persona_tone TEXT NOT NULL DEFAULT 'warm empathetic clinician',
  persona_background TEXT DEFAULT '',
  participant_modes TEXT[] NOT NULL DEFAULT ARRAY['text']::text[], -- text, audio
  consent_enabled BOOLEAN NOT NULL DEFAULT true,
  consent_text TEXT NOT NULL DEFAULT 'By continuing you agree to take part in this research interview. Your responses will be recorded and analyzed for research purposes. You may withdraw at any time.',
  collect_identity BOOLEAN NOT NULL DEFAULT false,
  data_use_notice BOOLEAN NOT NULL DEFAULT true,
  allow_withdrawal BOOLEAN NOT NULL DEFAULT true,
  max_questions INT NOT NULL DEFAULT 12,
  max_duration_minutes INT NOT NULL DEFAULT 30,
  target_sample_size INT NOT NULL DEFAULT 100,
  share_token TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(12), 'hex'),
  share_active BOOLEAN NOT NULL DEFAULT true,
  status TEXT NOT NULL DEFAULT 'draft', -- draft | live | closed
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.studies TO authenticated;
GRANT SELECT ON public.studies TO anon;
GRANT ALL ON public.studies TO service_role;
ALTER TABLE public.studies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners manage their studies" ON public.studies FOR ALL TO authenticated
  USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
-- Public can read a live study via its share_token (client filters by token; policy allows read of live+active rows)
CREATE POLICY "Public read live studies" ON public.studies FOR SELECT TO anon
  USING (status = 'live' AND share_active = true);
CREATE POLICY "Public read live studies auth" ON public.studies FOR SELECT TO authenticated
  USING (status = 'live' AND share_active = true);

-- sessions
CREATE TABLE public.sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  study_id UUID NOT NULL REFERENCES public.studies(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'in_progress', -- in_progress | completed | withdrawn | abandoned
  mode TEXT NOT NULL DEFAULT 'text', -- text | audio
  participant_name TEXT,
  participant_email TEXT,
  consent_given BOOLEAN NOT NULL DEFAULT false,
  consent_text_snapshot TEXT,
  withdrawn BOOLEAN NOT NULL DEFAULT false,
  current_question_index INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sessions TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.sessions TO anon;
GRANT ALL ON public.sessions TO service_role;
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;

-- helper: study is live and share active
CREATE OR REPLACE FUNCTION public.study_is_open(_study_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS(SELECT 1 FROM public.studies WHERE id = _study_id AND status = 'live' AND share_active = true);
$$;

CREATE POLICY "Owners read sessions of own studies" ON public.sessions FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.studies s WHERE s.id = study_id AND s.owner_id = auth.uid()));
CREATE POLICY "Owners delete sessions of own studies" ON public.sessions FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.studies s WHERE s.id = study_id AND s.owner_id = auth.uid()));

CREATE POLICY "Public create session on live study" ON public.sessions FOR INSERT TO anon
  WITH CHECK (public.study_is_open(study_id));
CREATE POLICY "Public create session on live study auth" ON public.sessions FOR INSERT TO authenticated
  WITH CHECK (public.study_is_open(study_id));

CREATE POLICY "Public update own in-progress session" ON public.sessions FOR UPDATE TO anon
  USING (public.study_is_open(study_id))
  WITH CHECK (public.study_is_open(study_id));
CREATE POLICY "Public update own in-progress session auth" ON public.sessions FOR UPDATE TO authenticated
  USING (public.study_is_open(study_id))
  WITH CHECK (public.study_is_open(study_id));

CREATE POLICY "Public read session by id" ON public.sessions FOR SELECT TO anon
  USING (public.study_is_open(study_id));

-- messages
CREATE TABLE public.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL, -- ai | participant | system
  text TEXT NOT NULL DEFAULT '',
  audio_url TEXT,
  question_index INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.messages TO authenticated;
GRANT SELECT, INSERT ON public.messages TO anon;
GRANT ALL ON public.messages TO service_role;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners read messages of own studies" ON public.messages FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.sessions se JOIN public.studies s ON s.id = se.study_id
    WHERE se.id = session_id AND s.owner_id = auth.uid()
  ));

CREATE POLICY "Public read messages of open study" ON public.messages FOR SELECT TO anon
  USING (EXISTS (
    SELECT 1 FROM public.sessions se WHERE se.id = session_id AND public.study_is_open(se.study_id)
  ));
CREATE POLICY "Public read messages of open study auth" ON public.messages FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.sessions se WHERE se.id = session_id AND public.study_is_open(se.study_id)
  ));

CREATE POLICY "Public insert messages open study" ON public.messages FOR INSERT TO anon
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.sessions se WHERE se.id = session_id AND public.study_is_open(se.study_id)
  ));
CREATE POLICY "Public insert messages open study auth" ON public.messages FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.sessions se WHERE se.id = session_id AND public.study_is_open(se.study_id)
  ));

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.touch_updated_at() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER studies_touch BEFORE UPDATE ON public.studies FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER sessions_touch BEFORE UPDATE ON public.sessions FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER profiles_touch BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- profile auto-create on signup
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, display_name)
  VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)))
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END; $$;

CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE INDEX ON public.studies(owner_id);
CREATE INDEX ON public.sessions(study_id);
CREATE INDEX ON public.messages(session_id);
