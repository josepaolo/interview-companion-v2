
-- Per-session access token so participants can only read/update THEIR session
ALTER TABLE public.sessions
  ADD COLUMN IF NOT EXISTS access_token uuid NOT NULL DEFAULT gen_random_uuid();

CREATE INDEX IF NOT EXISTS sessions_access_token_idx ON public.sessions(access_token);

-- Helper: read the x-session-token header sent by the participant client
CREATE OR REPLACE FUNCTION public.session_token_header()
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT NULLIF(
    (NULLIF(current_setting('request.headers', true), '')::json ->> 'x-session-token'),
    ''
  )::uuid
$$;

-- Sessions: replace study-wide anon read/update with token-scoped policies
DROP POLICY IF EXISTS "Public read session by id" ON public.sessions;
DROP POLICY IF EXISTS "Public update own in-progress session" ON public.sessions;
DROP POLICY IF EXISTS "Public update own in-progress session auth" ON public.sessions;

CREATE POLICY "Participant read own session"
  ON public.sessions FOR SELECT
  TO anon, authenticated
  USING (
    public.session_token_header() IS NOT NULL
    AND access_token = public.session_token_header()
  );

CREATE POLICY "Participant update own session"
  ON public.sessions FOR UPDATE
  TO anon, authenticated
  USING (
    public.session_token_header() IS NOT NULL
    AND access_token = public.session_token_header()
    AND study_is_open(study_id)
  )
  WITH CHECK (
    access_token = public.session_token_header()
    AND study_is_open(study_id)
  );

-- Messages: replace study-wide anon read/insert with token-scoped policies
DROP POLICY IF EXISTS "Public read messages of open study" ON public.messages;
DROP POLICY IF EXISTS "Public read messages of open study auth" ON public.messages;
DROP POLICY IF EXISTS "Public insert messages open study" ON public.messages;
DROP POLICY IF EXISTS "Public insert messages open study auth" ON public.messages;

CREATE POLICY "Participant read own session messages"
  ON public.messages FOR SELECT
  TO anon, authenticated
  USING (
    public.session_token_header() IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.sessions se
      WHERE se.id = messages.session_id
        AND se.access_token = public.session_token_header()
    )
  );

CREATE POLICY "Participant insert own session messages"
  ON public.messages FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.sessions se
      WHERE se.id = messages.session_id
        AND se.access_token = public.session_token_header()
        AND study_is_open(se.study_id)
    )
  );

-- Storage: lock down interview-audio bucket to owning session + study owner
DROP POLICY IF EXISTS "Anyone can read interview audio" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can upload interview audio" ON storage.objects;

CREATE POLICY "Participant read own session audio"
  ON storage.objects FOR SELECT
  TO anon, authenticated
  USING (
    bucket_id = 'interview-audio'
    AND public.session_token_header() IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.sessions se
      WHERE se.id::text = (storage.foldername(name))[1]
        AND se.access_token = public.session_token_header()
    )
  );

CREATE POLICY "Study owner read session audio"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'interview-audio'
    AND EXISTS (
      SELECT 1 FROM public.sessions se
      JOIN public.studies s ON s.id = se.study_id
      WHERE se.id::text = (storage.foldername(name))[1]
        AND s.owner_id = auth.uid()
    )
  );

CREATE POLICY "Participant upload own session audio"
  ON storage.objects FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    bucket_id = 'interview-audio'
    AND EXISTS (
      SELECT 1 FROM public.sessions se
      WHERE se.id::text = (storage.foldername(name))[1]
        AND se.access_token = public.session_token_header()
        AND study_is_open(se.study_id)
    )
  );

CREATE POLICY "Study owner update session audio"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'interview-audio'
    AND EXISTS (
      SELECT 1 FROM public.sessions se
      JOIN public.studies s ON s.id = se.study_id
      WHERE se.id::text = (storage.foldername(name))[1]
        AND s.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    bucket_id = 'interview-audio'
    AND EXISTS (
      SELECT 1 FROM public.sessions se
      JOIN public.studies s ON s.id = se.study_id
      WHERE se.id::text = (storage.foldername(name))[1]
        AND s.owner_id = auth.uid()
    )
  );

CREATE POLICY "Study owner delete session audio"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'interview-audio'
    AND EXISTS (
      SELECT 1 FROM public.sessions se
      JOIN public.studies s ON s.id = se.study_id
      WHERE se.id::text = (storage.foldername(name))[1]
        AND s.owner_id = auth.uid()
    )
  );
