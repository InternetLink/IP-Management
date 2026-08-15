-- Release E: expand the schema while old and dual-write application versions
-- remain compatible with the legacy Float columns.
ALTER TABLE `prefixes`
    ADD COLUMN `totalIPsExact` DECIMAL(65,0) NULL,
    ADD COLUMN `usedIPsExact` DECIMAL(65,0) NULL;

CREATE TABLE `migration_states` (
    `id` VARCHAR(32) NOT NULL DEFAULT 'capacity-v1',
    `stage` VARCHAR(20) NOT NULL DEFAULT 'EXPANDED',
    `targetVersion` VARCHAR(32) NOT NULL DEFAULT 'decimal-65-0',
    `batchCursor` VARCHAR(191) NULL,
    `expectedRowCount` BIGINT UNSIGNED NOT NULL DEFAULT 0,
    `processedRowCount` BIGINT UNSIGNED NOT NULL DEFAULT 0,
    `checksum` CHAR(64) NOT NULL DEFAULT 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    `startedAt` DATETIME(3) NULL,
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `completedAt` DATETIME(3) NULL,
    `failureCode` VARCHAR(64) NULL,
    `leaseOwner` VARCHAR(191) NULL,
    `leaseExpiresAt` DATETIME(3) NULL,

    CONSTRAINT `migration_states_id_check`
        CHECK (`id` = 'capacity-v1'),
    CONSTRAINT `migration_states_stage_check`
        CHECK (`stage` IN ('EXPANDED', 'BACKFILLING', 'BACKFILLED', 'CONTRACTED', 'FAILED')),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `migration_states`
    (`id`, `stage`, `targetVersion`, `checksum`, `updatedAt`)
VALUES
    ('capacity-v1', 'EXPANDED', 'decimal-65-0',
     'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
     CURRENT_TIMESTAMP(3));
