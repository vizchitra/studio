<script lang="ts">
  import { Button, Container, Notice } from "$lib/components";
  import type { PageData, ActionData } from "./$types";
  export let data: PageData;
  export let form: ActionData;
</script>

<Container>
  <h1 class="font-display">VizChitra Studio</h1>
  <p class="content-text">Signed in as {data.user?.email ?? "unknown"}</p>

  <h2 class="font-display">Upload an asset</h2>
  <form method="POST" action="?/upload" enctype="multipart/form-data">
    <div class="field">
      <label for="file">File</label>
      <input type="file" id="file" name="file" required />
    </div>

    <div class="field">
      <label for="photographerName">Who took this photo?</label>
      <input
        type="text"
        id="photographerName"
        name="photographerName"
        list="person-names"
        value={data.attributionSuggestion ?? ""}
        required
      />
      <datalist id="person-names">
        {#each data.personNames ?? [] as name (name)}
          <option value={name}></option>
        {/each}
      </datalist>
    </div>

    <div class="field">
      <label for="contextTag">Context tag (venue/session, optional)</label>
      <input type="text" id="contextTag" name="contextTag" list="tag-names" />
      <datalist id="tag-names">
        {#each data.tagNames ?? [] as name (name)}
          <option value={name}></option>
        {/each}
      </datalist>
    </div>

    <Button variant="primary">Upload</Button>
  </form>

  {#if form?.error}
    <Notice kind="error">{form.error}</Notice>
  {/if}
  {#if form?.success}
    <Notice kind="success">
      Uploaded. Asset ID: {form.assetId}, Version ID: {form.versionId}
    </Notice>
  {/if}

  <p class="content-text"><a href="/assets">View all assets &rarr;</a></p>
</Container>

<style>
  .field {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    margin-bottom: 0.75rem;
    max-width: 32rem;
  }

  .field label {
    font-size: 0.85rem;
    color: var(--color-text-secondary);
  }
</style>
