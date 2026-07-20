<script lang="ts">
  import { Badge, Button, Container, Notice, Table } from "$lib/components";
  import type { ActionData, PageData } from "./$types";
  export let data: PageData;
  export let form: ActionData;

  function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function formatOutput(output: Record<string, unknown> | null): string {
    if (!output) return "";
    if (output.skipped) return `skipped — ${String(output.reason ?? "")}`;
    return JSON.stringify(output);
  }
</script>

<Container wide>
  <p class="content-text"><a href="/assets">&larr; Back to assets</a></p>

  <h1 class="font-display">{data.asset.title ?? "(untitled)"}</h1>
  <Badge kind="editorial" value={data.asset.status} />

  {#if form?.error}
    <Notice kind="error">{form.error}</Notice>
  {/if}

  <div class="detail-layout">
    <div class="detail-image">
      {#if data.displayVersion}
        <img src="/media/{data.displayVersion.r2_key}" alt={data.asset.title ?? data.asset.kind} />
      {:else}
        <div class="asset-placeholder">Processing&hellip;</div>
      {/if}
    </div>

    <div class="detail-meta">
      <div>
        <span class="meta-label">Kind</span>
        <span>{data.asset.kind}</span>
      </div>
      <div>
        <span class="meta-label">Uploaded</span>
        <span>{data.asset.created_at}{data.asset.created_by_name ? ` by ${data.asset.created_by_name}` : ""}</span>
      </div>
      <div>
        <span class="meta-label">Captured by</span>
        <span>{data.capturedBy ?? "— missing attribution"}</span>
      </div>
      <div>
        <span class="meta-label">Tags</span>
        <span>{data.tags.length > 0 ? data.tags.join(", ") : "—"}</span>
      </div>
      {#if data.asset.quality_score !== null}
        <div>
          <span class="meta-label">Quality</span>
          <span>
            {data.asset.quality_score}/100
            {#if data.asset.qualityFlags.length > 0}
              &middot; {data.asset.qualityFlags.join(", ")}
            {/if}
          </span>
        </div>
      {/if}
      {#if data.exifSummary}
        <div>
          <span class="meta-label">EXIF</span>
          <span>{data.exifSummary}</span>
        </div>
      {/if}

      {#if data.asset.status === "draft" || data.asset.status === "review"}
        {#if data.canReviewAsset}
          <div class="action-row">
            <form method="POST" action="/assets?/approve">
              <input type="hidden" name="assetId" value={data.asset.id} />
              <input type="hidden" name="redirectTo" value="/assets/{data.asset.id}" />
              <Button variant="primary">Approve</Button>
            </form>
            <form method="POST" action="/assets?/reject">
              <input type="hidden" name="assetId" value={data.asset.id} />
              <input type="hidden" name="redirectTo" value="/assets/{data.asset.id}" />
              <Button variant="danger">Reject</Button>
            </form>
          </div>
        {/if}
      {/if}

      {#if data.canReprocessAsset}
        <form method="POST" action="/assets?/reprocess" class="action-row">
          <input type="hidden" name="assetId" value={data.asset.id} />
          <input type="hidden" name="redirectTo" value="/assets/{data.asset.id}" />
          <select name="step" aria-label="Pipeline step">
            {#each data.pipelineSteps as step (step)}
              <option value={step}>{step}</option>
            {/each}
          </select>
          <Button variant="tertiary">Reprocess</Button>
        </form>
      {/if}
    </div>
  </div>

  {#if data.canReviewAsset}
    <h2 class="font-display">Edit metadata</h2>
    <form method="POST" action="?/updateMetadata" class="edit-metadata-form">
      <div class="field">
        <label for="title">Title</label>
        <input type="text" id="title" name="title" value={data.asset.title ?? ""} />
      </div>

      <div class="field">
        <label for="tags">Tags (comma-separated)</label>
        <input type="text" id="tags" name="tags" list="tag-names" value={data.tags.join(", ")} />
        <datalist id="tag-names">
          {#each data.tagNames as name (name)}
            <option value={name}></option>
          {/each}
        </datalist>
      </div>

      <div class="field">
        <label for="capturedByName">Captured by</label>
        <input
          type="text"
          id="capturedByName"
          name="capturedByName"
          list="captured-by-options"
          value={data.capturedBy ?? ""}
          required
        />
        <datalist id="captured-by-options">
          {#if data.orgName}
            <option value={data.orgName}></option>
          {/if}
          {#each data.personNames as name (name)}
            <option value={name}></option>
          {/each}
        </datalist>
        <span class="field-hint">
          Type an existing name, or {data.orgName ?? "the VizChitra org"} for official/unattributed
          photos.
        </span>
      </div>

      <Button variant="primary">Save changes</Button>
    </form>
  {/if}

  <h2 class="font-display">Versions</h2>
  <div class="table-wrap">
    <Table>
      <thead>
        <tr>
          <th>Kind</th>
          <th>Mime type</th>
          <th>Dimensions</th>
          <th>Size</th>
          <th>Checksum</th>
          <th>Created</th>
        </tr>
      </thead>
      <tbody>
        {#each data.versions as version (version.id)}
          <tr>
            <td><a href="/media/{version.r2_key}">{version.kind}</a></td>
            <td>{version.mime_type}</td>
            <td>{version.width && version.height ? `${version.width}×${version.height}` : "—"}</td>
            <td>{formatBytes(version.size_bytes)}</td>
            <td class="checksum">{version.checksum}</td>
            <td>{version.created_at}</td>
          </tr>
        {/each}
      </tbody>
    </Table>
  </div>

  <h2 class="font-display">Pipeline run history</h2>
  <div class="table-wrap">
    <Table>
      <thead>
        <tr>
          <th>Step</th>
          <th>Status</th>
          <th>Output / error</th>
          <th>Started</th>
          <th>Finished</th>
        </tr>
      </thead>
      <tbody>
        {#each data.pipelineRuns as run (run.id)}
          <tr>
            <td>{run.step}</td>
            <td><Badge kind="pipeline" value={run.status} /></td>
            <td class="run-output">
              {#if run.status === "failed" && run.error}
                <span class="run-error">{run.error}</span>
              {:else}
                {formatOutput(run.output)}
              {/if}
            </td>
            <td>{run.started_at ?? "—"}</td>
            <td>{run.finished_at ?? "—"}</td>
          </tr>
        {/each}
        {#if data.pipelineRuns.length === 0}
          <tr>
            <td colspan="5">No pipeline runs yet.</td>
          </tr>
        {/if}
      </tbody>
    </Table>
  </div>
</Container>

<style>
  .detail-layout {
    display: flex;
    gap: var(--space-flow-0);
    margin-top: var(--space-flow-0);
    flex-wrap: wrap;
  }

  .detail-image {
    flex: 1 1 400px;
    max-width: 640px;
  }

  .detail-image img {
    width: 100%;
    display: block;
    border-radius: 0.25rem;
  }

  .asset-placeholder {
    width: 100%;
    aspect-ratio: 4 / 3;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--color-muted);
    color: var(--color-text-tertiary);
  }

  .detail-meta {
    flex: 1 1 280px;
    display: flex;
    flex-direction: column;
    gap: var(--space-flow--1);
  }

  .meta-label {
    display: block;
    font-size: 0.75rem;
    text-transform: uppercase;
    color: var(--color-text-tertiary);
  }

  .action-row {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    margin-top: 0.5rem;
  }

  .action-row select {
    flex: 1;
    min-width: 0;
  }

  .edit-metadata-form {
    max-width: 32rem;
    margin-top: var(--space-flow--1);
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    margin-bottom: 0.75rem;
  }

  .field label {
    font-size: 0.85rem;
    color: var(--color-text-secondary);
  }

  .field-hint {
    font-size: 0.75rem;
    color: var(--color-text-tertiary);
  }

  .table-wrap {
    margin-top: var(--space-flow-0);
    margin-bottom: var(--space-flow-0);
  }

  .checksum {
    font-family: var(--font-mono);
    font-size: 0.7rem;
    word-break: break-all;
    max-width: 200px;
  }

  .run-output {
    font-size: 0.75rem;
    word-break: break-word;
    max-width: 320px;
  }

  .run-error {
    color: #900;
  }
</style>
