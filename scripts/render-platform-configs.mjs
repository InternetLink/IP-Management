#!/usr/bin/env node
import { constants as fsConstants } from "node:fs";
import { mkdir, mkdtemp, open, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ManifestContractError,
  validateReleaseManifestFile,
} from "./release-manifest.mjs";

const LEGACY_CONFIGS = [
  "railway.json",
  "zeabur.yaml",
  "zbpack.backend.json",
  "backend/zbpack.json",
];

class PlatformConfigError extends Error {
  name = "PlatformConfigError";

  constructor(code) {
    super(`PLATFORM_CONFIG_INVALID code=${code}`);
    this.code = code;
  }
}

function fail(code) {
  throw new PlatformConfigError(code);
}

async function assertLegacyConfigsAbsent(repositoryRoot) {
  for (const relativePath of LEGACY_CONFIGS) {
    try {
      await stat(path.join(repositoryRoot, relativePath));
      fail(`legacy-config-${relativePath.replaceAll("/", "-")}`);
    } catch (error) {
      if (error instanceof ManifestContractError) throw error;
      if (!(error instanceof Error) || !Reflect.has(error, "code") || error.code !== "ENOENT") {
        throw error;
      }
    }
  }
}

function railwayConfig(combinedDigest) {
  return `import { defineRailway, image, project, service } from "railway/iac";

export default defineRailway(() => {
  const app = service("ipam-combined", {
    source: image("${combinedDigest}"),
    healthcheck: "/api/health/ready",
    healthcheckTimeout: 300,
  });

  return project("ipam", { resources: [app] });
});
`;
}

function zeaburConfig(backendDigest, frontendDigest) {
  return `# yaml-language-server: $schema=https://schema.zeabur.app/template.json
apiVersion: zeabur.com/v1
kind: Template
metadata:
  name: IPAM / Geofeed
spec:
  description: Immutable IPAM application images with an external MySQL 8 database.
  variables:
    - key: DATABASE_URL
      type: STRING
      name: External MySQL 8 connection URL
    - key: FRONTEND_DOMAIN
      type: DOMAIN
      name: Frontend domain
    - key: BACKEND_DOMAIN
      type: DOMAIN
      name: Backend domain
    - key: AUTH_SECRET
      type: PASSWORD
      name: API auth signing secret
  services:
    - name: backend
      template: PREBUILT_V2
      domainKey: BACKEND_DOMAIN
      spec:
        source:
          image: ${backendDigest}
        ports:
          - id: web
            port: 8080
            type: HTTP
        healthCheck:
          type: HTTP
          port: web
          http:
            path: /api/health/ready
        env:
          DATABASE_URL:
            default: \${DATABASE_URL}
          CORS_ORIGINS:
            default: https://\${FRONTEND_DOMAIN}
          AUTH_SECRET:
            default: \${AUTH_SECRET}
          AUTH_TOKEN_TTL_HOURS:
            default: "720"
    - name: frontend
      template: PREBUILT_V2
      dependencies:
        - backend
      domainKey: FRONTEND_DOMAIN
      spec:
        source:
          image: ${frontendDigest}
        ports:
          - id: web
            port: 8080
            type: HTTP
        healthCheck:
          type: HTTP
          port: web
          http:
            path: /
        env:
          NEXT_PUBLIC_API_URL:
            default: /api
          API_PROXY_TARGET:
            default: http://\${BACKEND_HOST}:8080
          APP_ORIGIN:
            default: https://\${FRONTEND_DOMAIN}
`;
}

async function syncPath(target) {
  const handle = await open(target, fsConstants.O_RDONLY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function commitPlatformConfigs(outputDirectory, configs, writeOutput = writeFile) {
  const resolvedOutput = path.resolve(outputDirectory);
  const parent = path.dirname(resolvedOutput);
  const temporaryPrefix = path.join(parent, `.${path.basename(resolvedOutput)}.`);
  let temporaryDirectory;

  await mkdir(parent, { recursive: true });
  try {
    await stat(resolvedOutput);
    fail("output-already-exists");
  } catch (error) {
    if (error instanceof PlatformConfigError) throw error;
    if (!(error instanceof Error) || !Reflect.has(error, "code") || error.code !== "ENOENT") throw error;
  }

  try {
    temporaryDirectory = await mkdtemp(temporaryPrefix);
    const railwayPath = path.join(temporaryDirectory, "railway.ts");
    const zeaburPath = path.join(temporaryDirectory, "zeabur.yaml");
    await writeOutput(railwayPath, configs.railway, { encoding: "utf8", mode: 0o600 });
    await syncPath(railwayPath);
    await writeOutput(zeaburPath, configs.zeabur, { encoding: "utf8", mode: 0o600 });
    await syncPath(zeaburPath);
    await syncPath(temporaryDirectory);
    await rename(temporaryDirectory, resolvedOutput);
    temporaryDirectory = undefined;
    await syncPath(parent);
  } catch (error) {
    if (temporaryDirectory !== undefined) await rm(temporaryDirectory, { recursive: true, force: true });
    throw error;
  }
}

async function main() {
  const [manifestPath, outputDirectory, repositoryRoot] = process.argv.slice(2);
  if (manifestPath === undefined || outputDirectory === undefined || process.argv.length > 5) {
    process.stderr.write(
      "Usage: node scripts/render-platform-configs.mjs <manifest> <output-directory> [repository-root]\n",
    );
    process.exitCode = 2;
    return;
  }

  const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  await assertLegacyConfigsAbsent(path.resolve(repositoryRoot ?? defaultRoot));
  const digests = await validateReleaseManifestFile(path.resolve(manifestPath));
  const backendDigest = digests.get("ipam-backend");
  const frontendDigest = digests.get("ipam-frontend");
  const combinedDigest = digests.get("ipam-combined");
  if (backendDigest === undefined || frontendDigest === undefined || combinedDigest === undefined) {
    fail("image-topology");
  }

  const resolvedOutput = path.resolve(outputDirectory);
  await commitPlatformConfigs(resolvedOutput, {
    railway: railwayConfig(combinedDigest),
    zeabur: zeaburConfig(backendDigest, frontendDigest),
  });
  process.stdout.write(`PLATFORM_CONFIGS_OK output=${resolvedOutput}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    if (error instanceof ManifestContractError || error instanceof PlatformConfigError) {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
      return;
    }
    throw error;
  });
}
