<script lang="ts">
  import { Button, Container, Notice, Table } from "$lib/components";
  import type { ActionData } from "./$types";
  export let form: ActionData;

  const DEFAULT_TEMPLATE = "{date}_{code}_{n}";
</script>

<Container wide>
  <h1 class="font-display">Bulk Import</h1>
  <p class="content-text">
    Upload a .zip preserving folder structure. Each top-level folder becomes a tag; filenames are
    matched against the template below to derive a date (EXIF fallback) and a photographer code
    (looked up in <code>services/media/photographer-codes.json</code>). Files that don't match
    still import — they just need attribution fixed by hand in <a href="/assets">Assets</a> before
    they can be approved.
  </p>

  <form method="POST" action="?/bulkImport" enctype="multipart/form-data">
    <div class="field">
      <label for="file">Zip file</label>
      <input type="file" id="file" name="file" accept=".zip" required />
    </div>

    <div class="field">
      <label for="mode">Import mode</label>
      <select id="mode" name="mode" required>
        <option value="review">Review — normal editorial review before publish</option>
        <option value="historical">Historical — final assets, skip review</option>
      </select>
    </div>

    <div class="field">
      <label for="template">Filename template</label>
      <input type="text" id="template" name="template" value={DEFAULT_TEMPLATE} />
      <span class="field-hint">Recognized tokens: {"{date}"}, {"{code}"}, {"{n}"}</span>
    </div>

    <Button variant="primary">Import</Button>
  </form>

  {#if form?.error}
    <Notice kind="error">{form.error}</Notice>
  {/if}

  {#if form?.success}
    <Notice kind="success">
      Batch {form.batchId} ({form.mode}) — {form.imported.length} file(s) imported.
    </Notice>

    <div class="results-wrap">
      <Table>
        <thead>
          <tr>
            <th>Path</th>
            <th>Folder tag</th>
            <th>Date</th>
            <th>Code</th>
            <th>Attribution</th>
          </tr>
        </thead>
        <tbody>
          {#each form.imported as entry (entry.assetId)}
            <tr>
              <td>{entry.path}</td>
              <td>{entry.folderTag ?? "—"}</td>
              <td>{entry.date ?? "—"}</td>
              <td>{entry.code ?? "—"}</td>
              <td>
                {#if entry.capturedBy === "none"}
                  <span class="needs-attribution">needs attribution</span>
                {:else}
                  {entry.capturedBy}
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </Table>
    </div>
  {/if}
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

  .field-hint {
    font-size: 0.75rem;
    color: var(--color-text-tertiary);
  }

  .results-wrap {
    margin-top: var(--space-flow-0);
  }

  .needs-attribution {
    color: var(--color-error);
    font-size: 0.85rem;
  }
</style>
