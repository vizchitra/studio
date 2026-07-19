<script lang="ts">
  import { Badge, Button, Card, Container, Grid, Notice } from "$lib/components";
  import type { ActionData, PageData } from "./$types";
  export let data: PageData;
  export let form: ActionData;
</script>

<Container>
  <h1 class="font-display">Assets</h1>
  <p class="content-text">
    <a href="/">&larr; Back to upload</a>
    {#if data.reprocessEnabled}
      &middot; <a href="/admin/pipeline-validation">Pipeline validation</a>
    {/if}
  </p>

  {#if form?.error}
    <Notice kind="error">{form.error}</Notice>
  {/if}

  {#if data.assets.length === 0}
    <p class="content-text">No assets uploaded yet.</p>
  {/if}

  <Grid gap="var(--space-flow-0)">
    {#each data.assets as asset (asset.id)}
      <Card>
        <a class="asset-image-wrap" href="/assets/{asset.id}">
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
        </a>

        {#if asset.faces.some((f) => !f.person_name)}
          <div class="face-confirm-list">
            {#each asset.faces.filter((f) => !f.person_name) as face (face.id)}
              <form method="POST" action="?/confirmFace" class="face-confirm">
                <input type="hidden" name="faceId" value={face.id} />
                <input type="text" name="personName" placeholder="Who is this?" required />
                <Button variant="tertiary">Confirm</Button>
              </form>
            {/each}
          </div>
        {/if}

        <div class="asset-meta">
          <a class="asset-title" href="/assets/{asset.id}">{asset.title ?? "(untitled)"}</a>
          <Badge kind="editorial" value={asset.status} />
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
      </Card>
    {/each}
  </Grid>
</Container>

<style>
  :global(.ui-grid) {
    margin-top: var(--space-flow-0);
  }

  .asset-image-wrap {
    position: relative;
    display: block;
  }

  .asset-image-wrap img {
    width: 100%;
    aspect-ratio: 4 / 3;
    object-fit: cover;
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

  .asset-title {
    font-weight: 600;
    color: var(--color-ink);
  }
</style>
