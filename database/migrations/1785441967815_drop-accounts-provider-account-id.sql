-- Up Migration

ALTER TABLE accounts DROP CONSTRAINT uq_accounts_provider_account;
ALTER TABLE accounts DROP COLUMN provider_account_id;

-- Down Migration

ALTER TABLE accounts ADD COLUMN provider_account_id TEXT;
ALTER TABLE accounts ADD CONSTRAINT uq_accounts_provider_account UNIQUE (provider, provider_account_id);
