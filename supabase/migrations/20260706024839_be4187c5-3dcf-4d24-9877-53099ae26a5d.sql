
-- Public (anon + authenticated) may upload to the interview-audio bucket
CREATE POLICY "Anyone can upload interview audio"
ON storage.objects FOR INSERT TO anon, authenticated
WITH CHECK (bucket_id = 'interview-audio');

-- Public (anon + authenticated) may read interview audio (files are keyed by uuid, unguessable)
CREATE POLICY "Anyone can read interview audio"
ON storage.objects FOR SELECT TO anon, authenticated
USING (bucket_id = 'interview-audio');
