CREATE EXTENSION IF NOT EXISTS postgis;
CREATE TABLE evidence_incidents(id uuid PRIMARY KEY,category text NOT NULL,location geography(Point,4326) NOT NULL,observed_at timestamptz NOT NULL,valid_until timestamptz NOT NULL,version integer NOT NULL,demo boolean NOT NULL DEFAULT false);
CREATE INDEX evidence_spatial ON evidence_incidents USING gist(location);
CREATE TABLE assessment_metadata(id uuid PRIMARY KEY,method_version text NOT NULL,levels jsonb NOT NULL,causes jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
