CREATE UNIQUE INDEX book_search_jobs_index_scope_unique
  ON book_search_jobs (index_id, job_type)
  WHERE analysis_chunk_id IS NULL;

CREATE TABLE book_graph_nodes (
  index_id UUID NOT NULL REFERENCES book_search_indexes(id) ON DELETE CASCADE,
  node_key TEXT NOT NULL,
  node_type TEXT NOT NULL CHECK (node_type IN ('character', 'event', 'location')),
  canonical_name TEXT NOT NULL,
  first_evidence_offset BIGINT CHECK (first_evidence_offset IS NULL OR first_evidence_offset >= 0),
  last_evidence_offset BIGINT CHECK (last_evidence_offset IS NULL OR last_evidence_offset > 0),
  data JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(data) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (index_id, node_key),
  CHECK (
    (first_evidence_offset IS NULL AND last_evidence_offset IS NULL) OR
    (first_evidence_offset IS NOT NULL AND last_evidence_offset IS NOT NULL
      AND first_evidence_offset < last_evidence_offset)
  )
);

CREATE INDEX book_graph_nodes_type_offset
  ON book_graph_nodes (index_id, node_type, first_evidence_offset);

CREATE TABLE book_graph_edges (
  index_id UUID NOT NULL REFERENCES book_search_indexes(id) ON DELETE CASCADE,
  edge_key TEXT NOT NULL,
  edge_type TEXT NOT NULL CHECK (
    edge_type IN ('relationship', 'event_participant', 'event_location')
  ),
  source_node_key TEXT NOT NULL,
  target_node_key TEXT NOT NULL,
  label TEXT NOT NULL,
  evidence_start_offset BIGINT CHECK (
    evidence_start_offset IS NULL OR evidence_start_offset >= 0
  ),
  evidence_end_offset BIGINT CHECK (
    evidence_end_offset IS NULL OR evidence_end_offset > 0
  ),
  evidence_ids JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (
    jsonb_typeof(evidence_ids) = 'array'
  ),
  data JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(data) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (index_id, edge_key),
  FOREIGN KEY (index_id, source_node_key)
    REFERENCES book_graph_nodes(index_id, node_key) ON DELETE CASCADE,
  FOREIGN KEY (index_id, target_node_key)
    REFERENCES book_graph_nodes(index_id, node_key) ON DELETE CASCADE,
  CHECK (source_node_key <> target_node_key),
  CHECK (
    (evidence_start_offset IS NULL AND evidence_end_offset IS NULL) OR
    (evidence_start_offset IS NOT NULL AND evidence_end_offset IS NOT NULL
      AND evidence_start_offset < evidence_end_offset)
  )
);

CREATE INDEX book_graph_edges_source
  ON book_graph_edges (index_id, source_node_key, evidence_end_offset);

CREATE INDEX book_graph_edges_target
  ON book_graph_edges (index_id, target_node_key, evidence_end_offset);

CREATE TABLE book_story_arcs (
  index_id UUID NOT NULL REFERENCES book_search_indexes(id) ON DELETE CASCADE,
  arc_key TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  event_keys JSONB NOT NULL CHECK (jsonb_typeof(event_keys) = 'array'),
  participant_character_keys JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (
    jsonb_typeof(participant_character_keys) = 'array'
  ),
  evidence_start_offset BIGINT NOT NULL CHECK (evidence_start_offset >= 0),
  evidence_end_offset BIGINT NOT NULL CHECK (evidence_end_offset > evidence_start_offset),
  evidence_ids JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (
    jsonb_typeof(evidence_ids) = 'array'
  ),
  data JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(data) = 'object'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (index_id, arc_key)
);

CREATE INDEX book_story_arcs_spoiler_boundary
  ON book_story_arcs (index_id, evidence_end_offset);
