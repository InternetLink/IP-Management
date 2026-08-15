-- CreateTable
CREATE TABLE `users` (
    `id` VARCHAR(191) NOT NULL,
    `username` VARCHAR(50) NOT NULL,
    `email` VARCHAR(255) NULL,
    `passwordHash` VARCHAR(255) NOT NULL,
    `role` VARCHAR(20) NOT NULL DEFAULT 'admin',
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `lastLoginAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `users_username_key`(`username`),
    UNIQUE INDEX `users_email_key`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `prefixes` (
    `id` VARCHAR(191) NOT NULL,
    `cidr` VARCHAR(50) NOT NULL,
    `version` INTEGER NOT NULL,
    `parentId` VARCHAR(191) NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'Active',
    `rir` VARCHAR(10) NULL,
    `vlan` INTEGER NULL,
    `gateway` VARCHAR(191) NULL,
    `assignedTo` VARCHAR(191) NULL,
    `totalIPs` DOUBLE NOT NULL,
    `usedIPs` DOUBLE NOT NULL DEFAULT 0,
    `isPool` BOOLEAN NOT NULL DEFAULT false,
    `depth` INTEGER NOT NULL DEFAULT 0,
    `description` VARCHAR(191) NOT NULL DEFAULT '',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `prefixes_cidr_key`(`cidr`),
    INDEX `prefixes_parentId_idx`(`parentId`),
    INDEX `prefixes_version_parentId_idx`(`version`, `parentId`),
    INDEX `prefixes_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `allocations` (
    `id` VARCHAR(191) NOT NULL,
    `prefixId` VARCHAR(191) NOT NULL,
    `ipAddress` VARCHAR(50) NOT NULL,
    `assignee` VARCHAR(100) NOT NULL DEFAULT '',
    `purpose` VARCHAR(20) NOT NULL DEFAULT 'Server',
    `status` VARCHAR(20) NOT NULL DEFAULT 'Available',
    `assignedDate` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expiryDate` DATETIME(3) NULL,
    `notes` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `allocations_prefixId_status_idx`(`prefixId`, `status`),
    UNIQUE INDEX `allocations_prefixId_ipAddress_key`(`prefixId`, `ipAddress`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `geofeed_entries` (
    `id` VARCHAR(191) NOT NULL,
    `prefix` VARCHAR(50) NOT NULL,
    `countryCode` VARCHAR(5) NOT NULL,
    `region` VARCHAR(20) NULL,
    `city` VARCHAR(100) NULL,
    `postalCode` VARCHAR(191) NULL,
    `validation` VARCHAR(10) NOT NULL DEFAULT 'valid',
    `validationMessage` VARCHAR(255) NULL,
    `lastUpdated` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `prefixId` VARCHAR(191) NULL,

    UNIQUE INDEX `geofeed_entries_prefix_key`(`prefix`),
    INDEX `geofeed_entries_prefixId_idx`(`prefixId`),
    INDEX `geofeed_entries_validation_idx`(`validation`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `audit_logs` (
    `id` VARCHAR(191) NOT NULL,
    `timestamp` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `action` VARCHAR(20) NOT NULL,
    `resourceType` VARCHAR(20) NOT NULL,
    `resourceId` VARCHAR(50) NOT NULL,
    `resourceLabel` VARCHAR(255) NOT NULL,
    `changes` JSON NULL,
    `user` VARCHAR(50) NOT NULL DEFAULT 'admin',
    `userId` VARCHAR(50) NULL,
    `prefixId` VARCHAR(191) NULL,

    INDEX `audit_logs_timestamp_idx`(`timestamp` DESC),
    INDEX `audit_logs_resourceType_action_idx`(`resourceType`, `action`),
    INDEX `audit_logs_prefixId_idx`(`prefixId`),
    INDEX `audit_logs_userId_timestamp_idx`(`userId`, `timestamp`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `app_settings` (
    `id` VARCHAR(191) NOT NULL DEFAULT 'default',
    `organizationName` VARCHAR(191) NOT NULL DEFAULT 'NetOps Inc.',
    `asn` VARCHAR(191) NOT NULL DEFAULT '',
    `contactEmail` VARCHAR(191) NOT NULL DEFAULT '',
    `defaultRIR` VARCHAR(191) NOT NULL DEFAULT 'APNIC',
    `geofeedHeader` VARCHAR(191) NOT NULL DEFAULT '',
    `geofeedAutoASN` BOOLEAN NOT NULL DEFAULT true,
    `defaultCountryCode` VARCHAR(191) NOT NULL DEFAULT 'TW',
    `geofeedPublicUrl` VARCHAR(191) NULL,
    `expiryWarningDays` INTEGER NOT NULL DEFAULT 30,
    `utilizationThreshold` INTEGER NOT NULL DEFAULT 85,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `prefixes` ADD CONSTRAINT `prefixes_parentId_fkey` FOREIGN KEY (`parentId`) REFERENCES `prefixes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `allocations` ADD CONSTRAINT `allocations_prefixId_fkey` FOREIGN KEY (`prefixId`) REFERENCES `prefixes`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `geofeed_entries` ADD CONSTRAINT `geofeed_entries_prefixId_fkey` FOREIGN KEY (`prefixId`) REFERENCES `prefixes`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_prefixId_fkey` FOREIGN KEY (`prefixId`) REFERENCES `prefixes`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

