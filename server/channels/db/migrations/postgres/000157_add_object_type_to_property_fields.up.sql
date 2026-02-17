ALTER TABLE PropertyFields ADD COLUMN IF NOT EXISTS ObjectType varchar(255) NOT NULL DEFAULT '';

-- Drop the old unique index that doesn't account for ObjectType
DROP INDEX IF EXISTS idx_propertyfields_unique;
