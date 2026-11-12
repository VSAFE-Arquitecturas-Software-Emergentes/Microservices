CREATE EXTENSION IF NOT EXISTS postgis;
CREATE TABLE incidents(id uuid PRIMARY KEY,owner_ref text,category text NOT NULL,location geography(Point,4326) NOT NULL,observed_at timestamptz NOT NULL,valid_until timestamptz NOT NULL,description text NOT NULL DEFAULT '',status text NOT NULL CHECK(status IN ('PUBLISHED','DUPLICATE','EXPIRED')),duplicate_of uuid REFERENCES incidents(id),version integer NOT NULL DEFAULT 1,demo boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX incidents_spatial ON incidents USING gist(location);
CREATE INDEX incidents_owner ON incidents(owner_ref);
CREATE TABLE idempotency(owner_ref text NOT NULL,key text NOT NULL,request_hash text NOT NULL,result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(owner_ref,key));
CREATE TABLE audit_records(id uuid PRIMARY KEY,incident_id uuid NOT NULL REFERENCES incidents(id),version integer NOT NULL,salt text NOT NULL,reference text NOT NULL UNIQUE,commitment text NOT NULL,payload jsonb NOT NULL,tx_hash text,chain_instance text,anchored_at timestamptz,attempts integer NOT NULL DEFAULT 0,UNIQUE(incident_id,version));
