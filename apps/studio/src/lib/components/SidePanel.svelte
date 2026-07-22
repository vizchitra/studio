<script lang="ts">
  export let canReprocess = false;
  export let canUpload = false;
  export let canManageRoles = false;
</script>

<nav class="side-panel" aria-label="Primary">
  <ul>
    <li><a href="/assets">Assets</a></li>
    {#if canUpload}
      <li><a href="/admin/bulk-import">Bulk Import</a></li>
    {/if}
    {#if canReprocess}
      <li><a href="/admin/pipeline-validation">Pipeline Validation</a></li>
    {/if}
    {#if canManageRoles}
      <li><a href="/people">People</a></li>
    {/if}
  </ul>
</nav>

<style>
  .side-panel {
    width: 200px;
    flex-shrink: 0;
    border-right: 1px solid var(--color-border);
    padding: 1rem 0.75rem;
    overflow: hidden;
    transition: width 0.15s ease;
  }

  .side-panel ul {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .side-panel a {
    display: block;
    padding: 0.35rem 0.5rem;
    border-radius: 0.25rem;
    white-space: nowrap;
    font-size: 0.9rem;
  }

  .side-panel a:hover {
    background: var(--color-muted);
  }
</style>
