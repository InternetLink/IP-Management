-- CreateTable
CREATE TABLE `address_space_locks` (
    `key` VARCHAR(191) NOT NULL,

    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- SeedRootLocks
INSERT INTO `address_space_locks` (`key`) VALUES
    ('root:v4'),
    ('root:v6');
