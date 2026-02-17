-- morph:nontransactional

-- Drop the new indexes
DROP INDEX CONCURRENTLY IF EXISTS idx_propertyfields_unique_typed;
DROP INDEX CONCURRENTLY IF EXISTS idx_propertyfields_unique_legacy;

-- Restore the original unique index
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_propertyfields_unique
    ON PropertyFields (GroupID, TargetID, Name)
    WHERE DeleteAt = 0;
