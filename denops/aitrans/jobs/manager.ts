import type { JobRecord, JobStatus } from "./types.ts";

const jobs = new Map<string, JobRecord>();

/**
 * Register a new job
 */
export function registerJob(id: string): JobRecord {
  const record: JobRecord = {
    id,
    status: "pending",
    controller: new AbortController(),
  };
  jobs.set(id, record);
  return record;
}

/**
 * Get a job by ID
 */
export function getJob(id: string): JobRecord | undefined {
  return jobs.get(id);
}

/**
 * Update job status
 */
export function updateJobStatus(id: string, status: JobStatus): boolean {
  const job = jobs.get(id);
  if (!job) {
    return false;
  }
  job.status = status;
  jobs.set(id, job);
  return true;
}

/**
 * Stop a job by aborting its controller
 */
export function stopJob(id: string): boolean {
  const job = jobs.get(id);
  if (!job) {
    return false;
  }
  job.controller.abort();
  job.status = "stopped";
  jobs.set(id, job);
  return true;
}

/**
 * Finalize a job (currently immediate deletion, Option A)
 * Future: could implement 5-minute retention or LRU cache
 */
export function finalizeJob(id: string): void {
  jobs.delete(id);
}

/**
 * Get all jobs (for debugging)
 */
export function getAllJobs(): Map<string, JobRecord> {
  return jobs;
}
