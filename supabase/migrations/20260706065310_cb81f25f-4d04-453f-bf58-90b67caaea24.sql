ALTER TABLE public.studies
  ADD COLUMN IF NOT EXISTS survey_items jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.studies.survey_items IS
  'Ordered array of hybrid survey/interview items. Each item: {id, kind: "survey"|"probe", prompt, question_type?, options?, scale_min?, scale_max?, scale_min_label?, scale_max_label?}';