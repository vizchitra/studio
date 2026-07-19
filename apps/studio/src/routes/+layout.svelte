<script lang="ts">
  import "../app.css";
  import { Nav, SidePanel } from "$lib/components";
  import type { LayoutData } from "./$types";

  export let data: LayoutData;
</script>

<div class="app-shell">
  <Nav user={data.user} />
  <div class="app-body">
    <SidePanel canReprocess={data.canReprocess} canUpload={data.canUpload} />
    <main class="app-main">
      <slot />
    </main>
  </div>
</div>

<style>
  .app-shell {
    display: flex;
    flex-direction: column;
    min-height: 100vh;
  }

  .app-body {
    display: flex;
    flex: 1;
    min-height: 0;
  }

  .app-main {
    flex: 1;
    min-width: 0;
    padding: var(--space-flow-0) 0;
  }

  /* Pure-CSS collapse: no JS needed, matches the progressive-enhancement
     principle. See Nav.svelte for why the checkbox lives there. Fully
     :global because the checkbox (Nav.svelte) and .side-panel
     (SidePanel.svelte) are both rendered by child components, outside this
     file's own scoping hash. */
  :global(#sidepanel-toggle:checked ~ .app-body .side-panel) {
    width: 0;
    padding: 0;
    border-right: none;
  }
</style>
