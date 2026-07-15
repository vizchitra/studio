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
    <input type="file" name="file" required />
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
