import { readFile } from "node:fs/promises";

const SHA = /^[0-9a-f]{64}$/;
const IMAGE_ID = /^sha256:[0-9a-f]{64}$/;
export const REPOSITORY_DIGEST =
	/^(?<repository>[a-z0-9.-]+(?::[0-9]+)?\/[a-z0-9._/-]+)@sha256:(?<digest>[0-9a-f]{64})$/;
const TOP_KEYS = [
	"contextShaAlgorithm",
	"dockerVerification",
	"images",
	"schemaVersion",
];
const IMAGE_KEYS = [
	"contextSha256",
	"dockerfile",
	"dockerfileSha256",
	"entrypoint",
	"entrypointArgv",
	"imageId",
	"imageName",
	"imageReference",
	"ports",
	"registryDigest",
	"runtimeUid",
	"secretRequired",
	"targetPlatform",
	"verification",
];
export const IMAGE_ORDER = ["ipam-backend", "ipam-frontend", "ipam-combined"];
const TOPOLOGY = {
	"ipam-backend": [
		"Dockerfile.backend",
		"sh scripts/start-prod.sh",
		["sh", "scripts/start-prod.sh"],
		[8080],
		[],
		false,
	],
	"ipam-frontend": [
		"Dockerfile.frontend",
		"node server.js",
		["node", "server.js"],
		[8080],
		[],
		true,
	],
	"ipam-combined": [
		"Dockerfile",
		"sh /app/scripts/start-combined.sh",
		["sh", "/app/scripts/start-combined.sh"],
		[3003],
		[3001],
		true,
	],
};

function record(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, expected, path, errors) {
	if (!record(value)) {
		errors.push(`${path} must be an object`);
		return false;
	}
	if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(expected)) {
		errors.push(`${path} keys must be exactly ${expected.join(",")}`);
		return false;
	}
	return true;
}

function exactArray(actual, expected) {
	return (
		Array.isArray(actual) && JSON.stringify(actual) === JSON.stringify(expected)
	);
}

function validateImage(image, index, errors, localMode) {
	const path = `images[${index}]`;
	if (!exactKeys(image, IMAGE_KEYS, path, errors)) return;
	const topology = TOPOLOGY[image.imageName];
	if (!topology) {
		errors.push(`${path}.imageName is invalid`);
		return;
	}
	const [
		dockerfile,
		entrypoint,
		argv,
		publicPorts,
		internalPorts,
		secretRequired,
	] = topology;
	const checks = [
		[image.dockerfile === dockerfile, "dockerfile"],
		[image.entrypoint === entrypoint, "entrypoint"],
		[exactArray(image.entrypointArgv, argv), "entrypointArgv"],
		[image.secretRequired === secretRequired, "secretRequired"],
		[image.runtimeUid === 1000, "runtimeUid"],
		[image.targetPlatform === "linux/amd64", "targetPlatform"],
		[image.verification === "verified", "verification"],
		[SHA.test(image.dockerfileSha256), "dockerfileSha256"],
		[SHA.test(image.contextSha256), "contextSha256"],
		[IMAGE_ID.test(image.imageId), "imageId"],
	];
	for (const [valid, field] of checks)
		if (!valid) errors.push(`${path}.${field} is invalid`);
	if (exactKeys(image.ports, ["internal", "public"], `${path}.ports`, errors)) {
		if (!exactArray(image.ports.public, publicPorts))
			errors.push(`${path}.ports.public is invalid`);
		if (!exactArray(image.ports.internal, internalPorts))
			errors.push(`${path}.ports.internal is invalid`);
	}
	if (localMode) {
		if (image.registryDigest !== null)
			errors.push(`${path}.registryDigest must be null before push`);
		if (
			typeof image.imageReference !== "string" ||
			image.imageReference.includes("@") ||
			!/:[^/]+$/.test(image.imageReference)
		)
			errors.push(
				`${path}.imageReference must be a mutable local tag before push`,
			);
		return;
	}
	const match =
		typeof image.registryDigest === "string"
			? image.registryDigest.match(REPOSITORY_DIGEST)
			: null;
	if (!match) {
		errors.push(`${path}.registryDigest is invalid`);
		return;
	}
	if (image.imageReference !== image.registryDigest)
		errors.push(`${path}.imageReference must equal registryDigest`);
	if (!match.groups.repository.endsWith(`/${image.imageName}`))
		errors.push(`${path}.registryDigest repository does not match imageName`);
}

export function validateManifest(value, localMode = false) {
	const errors = [];
	if (!exactKeys(value, TOP_KEYS, "manifest", errors)) return errors;
	if (value.schemaVersion !== 1) errors.push("schemaVersion must equal 1");
	if (value.contextShaAlgorithm !== "canonical-tar-v1")
		errors.push("contextShaAlgorithm must equal canonical-tar-v1");
	if (
		exactKeys(
			value.dockerVerification,
			["status"],
			"dockerVerification",
			errors,
		) &&
		value.dockerVerification.status !== "VERIFIED"
	)
		errors.push("dockerVerification.status must equal VERIFIED");
	if (!Array.isArray(value.images)) {
		errors.push("images must be an array");
		return errors;
	}
	if (
		!exactArray(
			value.images.map((image) => image?.imageName),
			IMAGE_ORDER,
		)
	)
		errors.push(`image order must equal ${IMAGE_ORDER.join(",")}`);
	value.images.forEach((image, index) => {
		validateImage(image, index, errors, localMode);
	});
	if (!localMode) {
		const hashes = value.images
			.map(
				(image) =>
					image?.registryDigest?.match(REPOSITORY_DIGEST)?.groups?.digest,
			)
			.filter(Boolean);
		if (new Set(hashes).size !== IMAGE_ORDER.length)
			errors.push("registry digest hashes must be distinct");
	}
	return errors;
}

export function validateReleaseManifest(value) {
	return validateManifest(value);
}

export function formatValidationErrors(errors) {
	return errors.join("; ");
}

export class ManifestContractError extends Error {
	name = "ManifestContractError";
}

export async function validateReleaseManifestFile(path) {
	let manifest;
	try {
		manifest = JSON.parse(await readFile(path, "utf8"));
	} catch {
		throw new ManifestContractError("manifest JSON is invalid");
	}
	const errors = validateReleaseManifest(manifest);
	if (errors.length > 0)
		throw new ManifestContractError(formatValidationErrors(errors));
	return new Map(
		manifest.images.map((image) => [image.imageName, image.registryDigest]),
	);
}
