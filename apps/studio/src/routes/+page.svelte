<script lang="ts">
  import type { PageData, ActionData } from "./$types";
  export let data: PageData;
  export let form: ActionData;
</script>

<div class="content-container">
  <h1 class="font-display">VizChitra Studio</h1>
  <p class="content-text">Signed in as {data.user?.email ?? "unknown"}</p>

  <h2 class="font-display">Upload an asset</h2>
  <form method="POST" action="?/upload" enctype="multipart/form-data">
    <input type="file" name="file" required />
    <button type="submit">Upload</button>
  </form>

  {#if form?.error}
    <div class="content-notice notice-error">{form.error}</div>
  {/if}
  {#if form?.success}
    <div class="content-notice notice-success">
      Uploaded. Asset ID: {form.assetId}, Version ID: {form.versionId}
    </div>
  {/if}

  <p class="content-text"><a href="/assets">View all assets &rarr;</a></p>
</div>
