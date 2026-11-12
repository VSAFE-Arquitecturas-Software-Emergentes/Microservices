CREATE EXTENSION IF NOT EXISTS postgis;
CREATE TABLE incident_projection(id uuid PRIMARY KEY,category text NOT NULL,location geography(Point,4326) NOT NULL,observed_at timestamptz NOT NULL,valid_until timestamptz NOT NULL,version integer NOT NULL,demo boolean NOT NULL DEFAULT false);
CREATE INDEX alert_incidents_spatial ON incident_projection USING gist(location);
CREATE TABLE active_journeys(id uuid PRIMARY KEY,owner_ref text NOT NULL,version integer NOT NULL,geometry geography(LineString,4326) NOT NULL,lease_until timestamptz NOT NULL,progress_observed_at timestamptz NOT NULL);
CREATE INDEX active_journeys_spatial ON active_journeys USING gist(geometry);
CREATE TABLE alerts(sequence bigserial PRIMARY KEY,id uuid NOT NULL UNIQUE,journey_id uuid NOT NULL,incident_id uuid NOT NULL,route_version integer NOT NULL,owner_ref text NOT NULL,category text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),valid_until timestamptz NOT NULL,acknowledged_at timestamptz,UNIQUE(journey_id,incident_id,route_version));
