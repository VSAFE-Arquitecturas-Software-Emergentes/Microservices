CREATE EXTENSION IF NOT EXISTS postgis;
CREATE TABLE route_options(id uuid PRIMARY KEY,owner_ref text NOT NULL,data jsonb NOT NULL,expires_at timestamptz NOT NULL);
CREATE INDEX route_options_owner ON route_options(owner_ref);
CREATE TABLE journeys(id uuid PRIMARY KEY,owner_ref text NOT NULL,version integer NOT NULL DEFAULT 1,status text NOT NULL CHECK(status IN ('ACTIVE','CLOSED')),route jsonb,geometry geography(LineString,4326),progress jsonb,expires_at timestamptz NOT NULL,purge_at timestamptz,created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX journeys_owner ON journeys(owner_ref);
CREATE TABLE idempotency(owner_ref text NOT NULL,key text NOT NULL,request_hash text NOT NULL,result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(owner_ref,key));
