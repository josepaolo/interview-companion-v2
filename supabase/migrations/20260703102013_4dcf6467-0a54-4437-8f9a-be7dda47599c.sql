
-- study_is_open doesn't actually need SECURITY DEFINER — studies has a public read policy for live studies
CREATE OR REPLACE FUNCTION public.study_is_open(_study_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT EXISTS(SELECT 1 FROM public.studies WHERE id = _study_id AND status = 'live' AND share_active = true);
$$;
REVOKE EXECUTE ON FUNCTION public.study_is_open(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.study_is_open(uuid) TO anon, authenticated;

-- handle_new_user is only used by the auth trigger; block direct API calls
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
