-- Release C: contract only after the backfill worker has proven completion.
-- This directory is intentionally outside prisma/migrations: the current
-- E/D/X artifact must remain deployable while legacy consumers are draining.

-- A missing singleton is also a failed precondition. The singleton CHECK makes
-- this insert fail without performing any schema DDL.
INSERT INTO `migration_states`
    (`id`, `stage`, `targetVersion`, `checksum`, `updatedAt`)
SELECT
    'capacity-v1-contract-guard', 'EXPANDED', 'decimal-65-0',
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    CURRENT_TIMESTAMP(3)
WHERE NOT EXISTS (
    SELECT 1 FROM `migration_states` WHERE `id` = 'capacity-v1'
);

-- The stage CHECK turns an unsafe contract attempt into a durable migration
-- failure before any ALTER TABLE statement runs.
UPDATE `migration_states` AS state
SET
    `stage` = IF(
        state.`stage` = 'BACKFILLED'
        AND state.`expectedRowCount` = state.`processedRowCount`
        AND state.`completedAt` IS NOT NULL
        AND CHAR_LENGTH(state.`checksum`) = 64
        AND (SELECT COUNT(*) FROM `prefixes`) = state.`expectedRowCount`
        AND (SELECT COUNT(*) FROM `prefixes`
             WHERE `totalIPsExact` IS NULL OR `usedIPsExact` IS NULL) = 0,
        state.`stage`,
        'CONTRACT_BLOCKED'
    )
WHERE state.`id` = 'capacity-v1';

ALTER TABLE `prefixes`
    MODIFY COLUMN `totalIPsExact` DECIMAL(65,0) NOT NULL,
    MODIFY COLUMN `usedIPsExact` DECIMAL(65,0) NOT NULL,
    DROP COLUMN `totalIPs`,
    DROP COLUMN `usedIPs`;

UPDATE `migration_states`
SET
    `stage` = 'CONTRACTED',
    `updatedAt` = CURRENT_TIMESTAMP(3),
    `completedAt` = COALESCE(`completedAt`, CURRENT_TIMESTAMP(3)),
    `leaseOwner` = NULL,
    `leaseExpiresAt` = NULL
WHERE `id` = 'capacity-v1';
