<script lang="ts">
  export let user: { email: string } | null;
</script>

<!--
  The hidden checkbox lives here (not in SidePanel) so a pure-CSS sibling
  selector — `#sidepanel-toggle:checked ~ .app-body .side-panel` in
  +layout.svelte — can collapse the panel without any JS, matching the
  "progressive enhancement, not a client-side app" principle. It resets on
  a full page reload (every action here is a plain form POST), same as any
  other unpersisted UI state in this app today.
-->
<input type="checkbox" id="sidepanel-toggle" class="sidepanel-toggle-input visually-hidden" />

<header class="app-nav">
  <label for="sidepanel-toggle" class="sidepanel-toggle-btn" aria-label="Toggle navigation">
    &#9776;
  </label>
  <a href="/" class="app-nav__brand font-display">VizChitra Studio</a>
  {#if user}
    <span class="app-nav__user">{user.email}</span>
  {/if}
</header>

<style>
  .app-nav {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 0.75rem 1rem;
    border-bottom: 1px solid var(--color-border);
    background: var(--color-surface);
  }

  .sidepanel-toggle-btn {
    cursor: pointer;
    font-size: 1.1rem;
    line-height: 1;
    padding: 0.25rem 0.5rem;
    border-radius: 0.25rem;
  }

  .sidepanel-toggle-btn:hover {
    background: var(--color-muted);
  }

  .app-nav__brand {
    font-weight: 700;
    font-size: 1.1rem;
  }

  .app-nav__user {
    margin-left: auto;
    font-size: 0.85rem;
    color: var(--color-text-secondary);
  }
</style>
