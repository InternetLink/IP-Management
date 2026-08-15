-- AddTokenVersion
ALTER TABLE `users` ADD COLUMN `tokenVersion` INTEGER NOT NULL DEFAULT 0;

-- CreateBootstrapState
CREATE TABLE `bootstrap_states` (
    `id` VARCHAR(191) NOT NULL DEFAULT 'bootstrap',
    `completedAt` DATETIME(3) NULL,
    `completedByUserId` VARCHAR(191) NULL,

    CONSTRAINT `bootstrap_states_id_check` CHECK (`id` = 'bootstrap'),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- SeedBootstrapState
INSERT INTO `bootstrap_states` (`id`, `completedAt`, `completedByUserId`)
VALUES ('bootstrap', NULL, NULL);
