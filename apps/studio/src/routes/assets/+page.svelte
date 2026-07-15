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
        {#if asset.thumbnail_r2_key}
          <img src="/media/{asset.thumbnail_r2_key}" alt={asset.title ?? asset.kind} />
        {:else}
          <div class="asset-placeholder">Processing&hellip;</div>
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
</style>
