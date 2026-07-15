<script lang="ts">
  import type { ActionData, PageData } from "./$types";
  export let data: PageData;
  export let form: ActionData;
</script>

<div class="content-container">
  <h1 class="font-display">Assets</h1>
  <p class="content-text"><a href="/">&larr; Back to upload</a></p>

  {#if form?.error}
    <p class="notice-error">{form.error}</p>
  {/if}

  {#if data.assets.length === 0}
    <p class="content-text">No assets uploaded yet.</p>
  {/if}

  <div class="asset-grid">
    {#each data.assets as asset (asset.id)}
      <div class="asset-card">
        <div class="asset-image-wrap">
          {#if asset.thumbnail_r2_key}
            <img src="/media/{asset.thumbnail_r2_key}" alt={asset.title ?? asset.kind} />
          {:else}
            <div class="asset-placeholder">Processing&hellip;</div>
          {/if}
          {#each asset.faces as face (face.id)}
            <div
              class="face-box"
              style="left: {face.x_min * 100}%; top: {face.y_min * 100}%; width: {(face.x_max -
                face.x_min) *
                100}%; height: {(face.y_max - face.y_min) * 100}%;"
            >
              {#if face.person_name}
                <span class="face-label">{face.person_name}</span>
              {/if}
            </div>
          {/each}
        </div>

        {#if asset.faces.some((f) => !f.person_name)}
          <div class="face-confirm-list">
            {#each asset.faces.filter((f) => !f.person_name) as face (face.id)}
              <form method="POST" action="?/confirmFace" class="face-confirm">
                <input type="hidden" name="faceId" value={face.id} />
                <input type="text" name="personName" placeholder="Who is this?" required />
                <button type="submit">Confirm</button>
              </form>
            {/each}
          </div>
        {/if}

        <div class="asset-meta">
          <strong>{asset.title ?? "(untitled)"}</strong>
          <span class="asset-status status-{asset.status}">{asset.status}</span>
          <span class="asset-detail">{asset.kind}</span>
          {#if asset.exifSummary}
            <span class="asset-detail">{asset.exifSummary}</span>
          {/if}
          {#if asset.quality_score !== null}
            <span class="asset-detail">
              Quality: {asset.quality_score}/100
              {#if asset.qualityFlags.length > 0}
                &middot; {asset.qualityFlags.join(", ")}
              {/if}
            </span>
          {/if}
          {#if asset.created_by_name}
            <span class="asset-detail">Uploaded by {asset.created_by_name}</span>
          {/if}
        </div>

        {#if asset.status === "draft" || asset.status === "review"}
          <div class="asset-actions">
            <form method="POST" action="?/approve">
              <input type="hidden" name="assetId" value={asset.id} />
              <button type="submit">Approve</button>
            </form>
            <form method="POST" action="?/reject">
              <input type="hidden" name="assetId" value={asset.id} />
              <button type="submit">Reject</button>
            </form>
          </div>
        {/if}

        {#if data.reprocessEnabled}
          <form method="POST" action="?/reprocess" class="asset-reprocess">
            <input type="hidden" name="assetId" value={asset.id} />
            <select name="step" aria-label="Pipeline step">
              {#each data.pipelineSteps as step (step)}
                <option value={step}>{step}</option>
              {/each}
            </select>
            <button type="submit">Reprocess</button>
          </form>
        {/if}
      </div>
    {/each}
  </div>
</div>

<style>
  .asset-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: var(--space-flow-0);
    margin-top: var(--space-flow-0);
  }

  .asset-card {
    border: 1px solid var(--color-border);
    border-radius: 0.5rem;
    overflow: hidden;
    background: var(--color-surface);
    display: flex;
    flex-direction: column;
  }

  .asset-card img {
    width: 100%;
    aspect-ratio: 4 / 3;
    object-fit: cover;
  }

  .asset-image-wrap {
    position: relative;
  }

  .face-box {
    position: absolute;
    border: 2px solid var(--color-viz-teal-dark, #0a7);
    border-radius: 0.15rem;
    pointer-events: none;
  }

  .face-label {
    position: absolute;
    bottom: 100%;
    left: 0;
    font-size: 0.7rem;
    line-height: 1.4;
    padding: 0 0.25rem;
    background: var(--color-viz-teal-dark, #0a7);
    color: white;
    white-space: nowrap;
  }

  .face-confirm-list {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    padding: 0 0.75rem 0.75rem;
  }

  .face-confirm {
    display: flex;
    gap: 0.5rem;
  }

  .face-confirm input[type="text"] {
    flex: 1;
    min-width: 0;
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

  .asset-meta {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    padding: 0.75rem;
  }

  .asset-detail {
    font-size: 0.85rem;
    color: var(--color-text-secondary);
  }

  .asset-status {
    display: inline-block;
    width: fit-content;
    font-size: 0.75rem;
    text-transform: uppercase;
    padding: 0.1rem 0.5rem;
    border-radius: 999px;
    background: var(--color-muted);
  }

  .status-approved {
    background: var(--color-viz-teal-subtle);
    color: var(--color-viz-teal-dark);
  }

  .status-archived {
    background: var(--color-neutral-100);
    color: var(--color-text-tertiary);
  }

  .asset-actions {
    display: flex;
    gap: 0.5rem;
    padding: 0 0.75rem 0.75rem;
  }

  .asset-reprocess {
    display: flex;
    gap: 0.5rem;
    padding: 0 0.75rem 0.75rem;
    border-top: 1px dashed var(--color-border);
    padding-top: 0.5rem;
  }

  .asset-reprocess select {
    flex: 1;
    min-width: 0;
  }
</style>
