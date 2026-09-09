CREATE TABLE app.demo_account (
 entity_id text PRIMARY KEY,
 role text NOT NULL CHECK(role IN ('EMPLOYER','PARTNER')),
 password_hash text,
 invite_hash text UNIQUE,
 invite_expires_at timestamptz,
 activated_at timestamptz,
 failed_attempts integer NOT NULL DEFAULT 0,
 locked_until timestamptz,
 version integer NOT NULL DEFAULT 0
);
