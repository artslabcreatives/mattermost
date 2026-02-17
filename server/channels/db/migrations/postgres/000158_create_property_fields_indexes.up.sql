-- morph:nontransactional

-- Legacy uniqueness for properties without ObjectType (PSAv1)
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_propertyfields_unique_legacy
    ON PropertyFields (GroupID, TargetID, Name)
    WHERE DeleteAt = 0 AND ObjectType = '';

-- Typed uniqueness for properties with ObjectType (hierarchical model, PSAv2)
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_propertyfields_unique_typed
    ON PropertyFields (ObjectType, GroupID, TargetType, TargetID, Name)
    WHERE DeleteAt = 0 AND ObjectType != '';
