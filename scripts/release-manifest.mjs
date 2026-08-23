import { randomBytes } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	IMAGE_ORDER,
	REPOSITORY_DIGEST,
	formatValidationErrors,
	validateManifest,
	validateReleaseManifest,
} from "./release-manifest-contract.mjs";

export {
	ManifestContractError,
	formatValidationErrors,
	validateReleaseManifest,
	validateReleaseManifestFile,
} from "./release-manifest-contract.mjs";

const IMAGE_ID = /^sha256:[0-9a-f]{64}$/;
const BINDING_KEYS = ["images", "schemaVersion"];
const BINDING_IMAGE_KEYS = ["imageId", "name", "repositoryDigest"];

function isRecord(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value, expected, path, errors) {
	if (!isRecord(value)) {
		errors.push(`${path} must be an object`);
		return false;
	}
	if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(expected)) {
		errors.push(`${path} keys must be exactly ${expected.join(",")}`);
		return false;
	}
	return true;
}

function validateBindings(value) {
	const errors = [];
	if (!exactKeys(value, BINDING_KEYS, "bindings", errors)) return errors;
	if (value.schemaVersion !== 1)
		errors.push("bindings.schemaVersion must equal 1");
	if (
		!Array.isArray(value.images) ||
		value.images.length !== IMAGE_ORDER.length
	) {
		errors.push("bindings.images must contain exactly three images");
		return errors;
	}
	value.images.forEach((image, index) => {
		const path = `bindings.images[${index}]`;
		if (!exactKeys(image, BINDING_IMAGE_KEYS, path, errors)) return;
		if (!IMAGE_ORDER.includes(image.name))
			errors.push(`${path}.name is invalid`);
		if (!IMAGE_ID.test(image.imageId))
			errors.push(`${path}.imageId is invalid`);
		if (!REPOSITORY_DIGEST.test(image.repositoryDigest))
			errors.push(`${path}.repositoryDigest is invalid`);
	});
	if (
		new Set(value.images.map((image) => image?.name)).size !==
		IMAGE_ORDER.length
	)
		errors.push("bindings image names must be distinct");
	return errors;
}

async function atomicWriteJson(path, value) {
	const directory = dirname(path);
	const temporaryPath = join(
		directory,
		`.${basename(path)}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`,
	);
	let handle;
	try {
		await mkdir(directory, { recursive: true });
		handle = await open(
			temporaryPath,
			fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY,
			0o600,
		);
		await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
		await handle.sync();
		await handle.close();
		handle = undefined;
		await rename(temporaryPath, path);
		const directoryHandle = await open(directory, fsConstants.O_RDONLY);
		try {
			await directoryHandle.sync();
		} finally {
			await directoryHandle.close();
		}
	} catch (error) {
		await handle?.close().catch(() => {});
		await rm(temporaryPath, { force: true }).catch(() => {});
		throw error;
	}
}

export async function createReleaseManifest(
	localPath,
	bindingsPath,
	outputPath,
) {
	const local = JSON.parse(await readFile(localPath, "utf8"));
	const bindings = JSON.parse(await readFile(bindingsPath, "utf8"));
	const errors = [
		...validateManifest(local, true),
		...validateBindings(bindings),
	];
	if (errors.length > 0) throw new Error(formatValidationErrors(errors));

	const bindingByName = new Map(
		bindings.images.map((binding) => [binding.name, binding]),
	);
	const images = local.images.map((image) => {
		const binding = bindingByName.get(image.imageName);
		if (binding.imageId !== image.imageId)
			throw new Error(`imageId mismatch for ${image.imageName}`);
		const localRepository = image.imageReference.slice(
			0,
			image.imageReference.lastIndexOf(":"),
		);
		const bindingRepository = binding.repositoryDigest.slice(
			0,
			binding.repositoryDigest.indexOf("@"),
		);
		if (localRepository !== bindingRepository)
			throw new Error(`repository mismatch for ${image.imageName}`);
		return {
			...image,
			imageReference: binding.repositoryDigest,
			registryDigest: binding.repositoryDigest,
		};
	});
	const manifest = { ...local, images };
	const outputErrors = validateReleaseManifest(manifest);
	if (outputErrors.length > 0)
		throw new Error(formatValidationErrors(outputErrors));
	await atomicWriteJson(outputPath, manifest);
	return manifest;
}

async function main() {
	const argumentsList = process.argv.slice(2);
	if (argumentsList.length === 1) {
		const manifest = JSON.parse(await readFile(argumentsList[0], "utf8"));
		const errors = validateReleaseManifest(manifest);
		if (errors.length > 0) throw new Error(formatValidationErrors(errors));
		process.stdout.write("RELEASE_MANIFEST_VALID\n");
		return;
	}
	const [localPath, bindingsPath, outputPath] = argumentsList;
	if (
		!localPath ||
		!bindingsPath ||
		!outputPath ||
		argumentsList.length !== 3
	) {
		throw new Error(
			"Usage: node scripts/release-manifest.mjs LOCAL_MANIFEST PUSH_BINDINGS OUTPUT_MANIFEST",
		);
	}
	await createReleaseManifest(localPath, bindingsPath, outputPath);
	process.stdout.write(`RELEASE_MANIFEST_OK output=${outputPath}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
	main().catch((error) => {
		process.stderr.write(`RELEASE_MANIFEST_FAILED reason=${error.message}\n`);
		process.exit(1);
	});
}
