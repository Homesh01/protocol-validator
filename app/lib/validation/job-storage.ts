import type { JobState } from "./types";

const PREFIX = "jobs/";

export function protocolObjectKey(jobId: string): string {
	return `${PREFIX}${jobId}/protocol.pdf`;
}

export function labObjectKey(jobId: string): string {
	return `${PREFIX}${jobId}/lab.pdf`;
}

export function stateObjectKey(jobId: string): string {
	return `${PREFIX}${jobId}/state.json`;
}

export async function putJobState(
	bucket: R2Bucket,
	state: JobState
): Promise<void> {
	await bucket.put(stateObjectKey(state.id), JSON.stringify(state), {
		httpMetadata: { contentType: "application/json" },
	});
}

export async function getJobState(
	bucket: R2Bucket,
	jobId: string
): Promise<JobState | null> {
	const obj = await bucket.get(stateObjectKey(jobId));
	if (!obj) return null;
	try {
		return JSON.parse(await obj.text()) as JobState;
	} catch {
		return null;
	}
}

export async function putPdf(
	bucket: R2Bucket,
	key: string,
	body: ArrayBuffer,
	contentType: string
): Promise<void> {
	await bucket.put(key, body, {
		httpMetadata: { contentType },
	});
}
